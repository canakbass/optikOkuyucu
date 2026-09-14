export interface BlockMap {
  startQuestion: number;
  endQuestion: number;
  columnXCenter: number;
  startY?: number;
  endY?: number;
  verticalAlignment?: "top" | "bottom" | "middle";
}

export interface OMRProcessingResult {
  data: OMRResult[];
  debugImageBase64: string;
}

export interface CategoryMap {
  categoryName: string;
  blocks: BlockMap[];
}

export interface LayoutMap {
  categories: CategoryMap[];
}

export interface OMRResult {
  categoryName: string;
  questions: {
    questionNumber: number;
    answer: string | null;
  }[];
}

interface Point {
  x: number;
  y: number;
}

interface RowAnchor {
  left: Point;
  right: Point;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANA MOTOR: Periyodik dikey sütun bulma
// Sol timing markları da, sağ referans çizgileri de aynı mantıkla bulunur.
// ═══════════════════════════════════════════════════════════════════════════════

function findRowAnchors(imageData: ImageData): { anchors: RowAnchor[]; medianGap: number } {
  const width = imageData.width;
  const height = imageData.height;

  // 1. Dikey İzdüşüm (Column Profile) Taraması
  // Kağıdın en solundaki %2.5'lik kısmı atlıyoruz (Kesilme gölgelerini eledik).
  // Sadece %2.5 ile %15 arasına bakıyoruz. (Timing marklar genellikle %5 civarındadır).
  const minX = Math.floor(width * 0.025);
  const maxX = Math.floor(width * 0.15);
  
  const columnScores: { x: number; score: number; medGap: number; entries: number[] }[] = [];
  
  for (let x = minX; x < maxX; x++) {
    const darkEntries: number[] = [];
    let wasDark = false;
    
    for (let y = 0; y < height; y++) {
      const idx = (y * width + x) * 4;
      const brightness = (imageData.data[idx] + imageData.data[idx+1] + imageData.data[idx+2]) / 3;
      const isDark = brightness < 150; // Geniş tolerans
      
      if (isDark && !wasDark) {
        // Çizginin (run) dikey merkezini bul
        let yEnd = y;
        while(yEnd < height) {
          const idxEnd = (yEnd * width + x) * 4;
          const bEnd = (imageData.data[idxEnd] + imageData.data[idxEnd+1] + imageData.data[idxEnd+2]) / 3;
          if (bEnd >= 150) break;
          yEnd++;
        }
        darkEntries.push(Math.floor((y + yEnd - 1) / 2));
        wasDark = true;
      } else if (!isDark) {
        wasDark = false;
      }
    }

    if (darkEntries.length < 10) continue;

    const gaps: number[] = [];
    for (let i = 1; i < darkEntries.length; i++) gaps.push(darkEntries[i] - darkEntries[i - 1]);
    const sortedGaps = [...gaps].sort((a, b) => a - b);
    const medGap = sortedGaps[Math.floor(sortedGaps.length / 2)];

    if (medGap < height * 0.01) continue;

    let periodicCount = 0;
    for (const g of gaps) {
      if (Math.abs(g - medGap) < medGap * 0.35) periodicCount++;
    }

    columnScores.push({ x, score: periodicCount, medGap, entries: darkEntries });
  }

  if (columnScores.length === 0) {
    console.warn("Geçerli timing mark sütunu bulunamadı.");
    const fg = height / 35;
    const anch: RowAnchor[] = [];
    for (let i = 0; i < 40; i++) {
      const y = height * 0.1 + i * fg;
      // Görsel hata vermesin diye x: 0 yapmıyoruz
      anch.push({ left: { x: width * 0.05, y }, right: { x: width, y } });
    }
    return { anchors: anch, medianGap: fg };
  }

  // En iyi periyodik sütunu seç
  const bestEntry = columnScores.reduce((a, b) => (a.score > b.score ? a : b));
  const medianGap = bestEntry.medGap;
  const bestX = bestEntry.x;

  // 2. İşaretlerin yatay(X) ve dikey(Y) merkezlerini hassas olarak bul
  const rawMarks = bestEntry.entries.map(cY => {
    let sX = bestX;
    while(sX > 0) {
      const idx = (cY * width + sX - 1) * 4;
      if ((imageData.data[idx] + imageData.data[idx+1] + imageData.data[idx+2]) / 3 >= 150) break;
      sX--;
    }
    let eX = bestX;
    while(eX < width) {
      const idx = (cY * width + eX + 1) * 4;
      if ((imageData.data[idx] + imageData.data[idx+1] + imageData.data[idx+2]) / 3 >= 150) break;
      eX++;
    }
    return { x: (sX + eX) / 2, y: cY };
  });

  // Hatalı frekansları atla
  const leftMarks = rawMarks.filter((m, i, arr) => {
    if (arr.length < 2) return true;
    if (i === 0) return Math.abs(arr[1].y - m.y - medianGap) < medianGap * 0.35;
    return Math.abs(m.y - arr[i - 1].y - medianGap) < medianGap * 0.35;
  });

  // 3. EKSİK İŞARETLERİ TAMAMLA (Interpolation)
  // Eğer silik çıkmış/atlanan bir siyah çizgi varsa, aradaki boşluğu hesaplayıp sanal çizgi ekle!
  const interpolatedMarks: Point[] = [];
  if (leftMarks.length > 0) {
    interpolatedMarks.push(leftMarks[0]);
    for (let i = 1; i < leftMarks.length; i++) {
      const prev = interpolatedMarks[interpolatedMarks.length - 1];
      const curr = leftMarks[i];
      const gap = curr.y - prev.y;
      
      if (gap > medianGap * 1.5) {
        // Bu boşluğa kaç tane eksik satır sığar?
        const missingCount = Math.round(gap / medianGap) - 1;
        for (let j = 1; j <= missingCount; j++) {
          interpolatedMarks.push({
            x: prev.x + (curr.x - prev.x) * (j / (missingCount + 1)),
            y: prev.y + (gap * (j / (missingCount + 1)))
          });
        }
      }
      interpolatedMarks.push(curr);
    }
  }

  // 4. Doğrusal Regresyon (Linear Regression) ile Tüm Kağıdın Gerçek Eğimini Bul
  let sumY = 0, sumX = 0, sumYY = 0, sumYX = 0;
  const N = interpolatedMarks.length;
  for (const m of interpolatedMarks) {
    sumY += m.y;
    sumX += m.x;
    sumYY += m.y * m.y;
    sumYX += m.y * m.x;
  }
  
  const denominator = N * sumYY - sumY * sumY;
  const m = denominator === 0 ? 0 : (N * sumYX - sumY * sumX) / denominator;
  const rowSlope = -m; // Yatay satır eğimi, dikey eksene tam dik

  // 5. Anchor'ları oluştur
  const anchors: RowAnchor[] = [];
  for (const lm of interpolatedMarks) {
    // Görsel hata düzeltmesi: Blue dot (mavi nokta) tam lm.x'te çizilsin diye sol anchor'a lm veriyoruz!
    // Önceden left: { x: 0, y: ... } yaptığımız için noktalar ekranın sol sınırına yapışıyordu.
    const yAtW = lm.y + rowSlope * (width - lm.x);
    
    anchors.push({
      left: lm,
      right: { x: width, y: yAtW }
    });
  }

  return { anchors, medianGap };
}

// ═══════════════════════════════════════════════════════════════════════════════
// YARDIMCI: Bir alandaki ortalama karanlık değeri
// ═══════════════════════════════════════════════════════════════════════════════

function getAverageDarkness(
  imageData: ImageData,
  startX: number,
  startY: number,
  w: number,
  h: number
): number {
  let total = 0,
    count = 0;
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const px = Math.floor(startX + dx);
      const py = Math.floor(startY + dy);
      if (px >= 0 && px < imageData.width && py >= 0 && py < imageData.height) {
        const idx = (py * imageData.width + px) * 4;
        total += 255 - (0.299 * imageData.data[idx] + 0.587 * imageData.data[idx + 1] + 0.114 * imageData.data[idx + 2]);
        count++;
      }
    }
  }
  return count > 0 ? total / count : 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANA İŞLEM: Resim analizi + bubble okuma
// ═══════════════════════════════════════════════════════════════════════════════

export async function processOMRImage(
  base64Data: string,
  layout: LayoutMap
): Promise<OMRProcessingResult> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return reject(new Error("Canvas context oluşturulamadı"));
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const results: OMRResult[] = [];
      const options = ["A", "B", "C", "D", "E"] as const;

      // ──────────── 1. ÇİFT ANCHOR TESPİTİ ────────────
      const { anchors: rowAnchors, medianGap } = findRowAnchors(imageData);

      // ──────────── DEBUG ÇİZİMLERİ ────────────

      // Sol anchor (mavi) + sağ anchor (kırmızı) + bağlantı çizgisi (yeşil)
      for (let i = 0; i < rowAnchors.length; i++) {
        const a = rowAnchors[i];

        // Yeşil satır çizgisi
        ctx.strokeStyle = "rgba(0, 255, 0, 0.3)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(a.left.x, a.left.y);
        ctx.lineTo(a.right.x, a.right.y);
        ctx.stroke();

        // Sol anchor — mavi
        ctx.fillStyle = "blue";
        ctx.beginPath();
        ctx.arc(a.left.x, a.left.y, 4, 0, 2 * Math.PI);
        ctx.fill();

        // Sağ anchor — kırmızı
        ctx.fillStyle = "red";
        ctx.beginPath();
        ctx.arc(a.right.x, a.right.y, 4, 0, 2 * Math.PI);
        ctx.fill();

        // İndeks
        ctx.fillStyle = "yellow";
        ctx.font = "9px monospace";
        ctx.fillText(`${i}`, a.left.x + 7, a.left.y + 3);
      }

      // Debug bilgi kutusu
      ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
      ctx.fillRect(0, 0, 400, 65);
      ctx.fillStyle = "white";
      ctx.font = "11px monospace";
      ctx.fillText(`Rows: ${rowAnchors.length} | Gap: ${medianGap.toFixed(1)}px`, 10, 15);
      if (rowAnchors.length >= 2) {
        const f = rowAnchors[0], l = rowAnchors[rowAnchors.length - 1];
        ctx.fillText(
          `L drift: ${(l.left.x - f.left.x).toFixed(1)}px | R drift: ${(l.right.x - f.right.x).toFixed(1)}px`,
          10, 32
        );
        const rowLen = Math.hypot(f.right.x - f.left.x, f.right.y - f.left.y);
        ctx.fillText(`Row len: ${rowLen.toFixed(0)}px | Left X: ${f.left.x} Right X: ${f.right.x}`, 10, 49);
      }

      // LLM sütun tahminleri (cyan kalın kesik çizgi ve etiket)
      for (const cat of layout.categories) {
        for (let idx = 0; idx < cat.blocks.length; idx++) {
          const blk = cat.blocks[idx];
          const cx = (blk.columnXCenter / 1000) * img.width;
          
          ctx.strokeStyle = "rgba(0, 255, 255, 0.8)";
          ctx.lineWidth = 3;
          ctx.setLineDash([8, 8]);
          ctx.beginPath();
          ctx.moveTo(cx, 0);
          ctx.lineTo(cx, img.height);
          ctx.stroke();
          ctx.setLineDash([]);
          
          const text = `${cat.categoryName.substring(0, 15)} Q${blk.startQuestion}-${blk.endQuestion}`;
          ctx.font = "bold 14px monospace";
          const tw = ctx.measureText(text).width;
          const th = 20;
          const labelY = 80 + (idx * 25);
          
          ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
          ctx.fillRect(cx - tw / 2 - 5, labelY - 15, tw + 10, th);
          ctx.fillStyle = "cyan";
          ctx.fillText(text, cx - tw / 2, labelY);
        }
      }

      // ──────────── 2. BUBBLE OKUMA (Row Line Interpolation) ────────────
      ctx.strokeStyle = "red";
      ctx.lineWidth = 2;

      // Ortalama satır uzunluğu
      const avgLX = rowAnchors.reduce((s, a) => s + a.left.x, 0) / rowAnchors.length;
      const avgRX = rowAnchors.reduce((s, a) => s + a.right.x, 0) / rowAnchors.length;
      const avgRowLen = Math.max(avgRX - avgLX, 1);
      const nominalBubbleSize = Math.min(medianGap * 0.7, img.width * 0.03);
      
      // Sütunlar arası mesafe (Balonlar arası yatay boşluk dikey boşluğa yaklaşık eşittir)
      const gapT = (medianGap * 1.0) / avgRowLen;

      // Dinamik satır genişletici (Eksik satır bulunursa sanal olarak yukarı/aşağı uzatır)
      const getAnchor = (idx: number): RowAnchor => {
        if (rowAnchors.length === 0) return { left: {x:0, y:0}, right: {x:img.width, y:0} };
        if (idx >= 0 && idx < rowAnchors.length) return rowAnchors[idx];
        if (idx < 0) {
          const ref = rowAnchors[0];
          const diff = idx * medianGap;
          return { left: { x: ref.left.x, y: ref.left.y + diff }, right: { x: ref.right.x, y: ref.right.y + diff } };
        } else {
          const ref = rowAnchors[rowAnchors.length - 1];
          const diff = (idx - (rowAnchors.length - 1)) * medianGap;
          return { left: { x: ref.left.x, y: ref.left.y + diff }, right: { x: ref.right.x, y: ref.right.y + diff } };
        }
      };

      // ──── KÖKTEN ÇÖZÜM v2: KIRMIZI YUVARLAKLARI (REDNESS) BULMA ────
      // Kağıttaki boş şıklar (A, B, C, D, E) kırmızı/pembe mürekkeple basıldığı için, 
      // sadece KIRMIZI pikselleri arayarak siyah metinleri, barkodları ve kurşun kalem izlerini tamamen filtreleyebiliriz!
      const BINS = 1000;
      const redBins = new Float32Array(BINS);
      
      for (let r = 0; r < rowAnchors.length; r++) {
        const anch = rowAnchors[r];
        for (let i = 0; i < BINS; i++) {
          const t = i / BINS;
          const px = Math.floor(anch.left.x + t * (anch.right.x - anch.left.x));
          const py = Math.floor(anch.left.y + t * (anch.right.y - anch.left.y));
          
          if (px >= 0 && px < img.width && py >= 0 && py < img.height) {
            const idx = (py * img.width + px) * 4;
            const r_val = imageData.data[idx];
            const g_val = imageData.data[idx + 1];
            const b_val = imageData.data[idx + 2];
            
            // Kırmızılık formülü: Kırmızı kanalı, Yeşil ve Mavi'den ne kadar büyük?
            const redness = r_val - Math.max(g_val, b_val);
            if (redness > 20) {
              redBins[i] += redness;
            }
          }
        }
      }

      // Parazitleri temizlemek için çok hafif (sadece 2 birim) yumuşatıyoruz.
      // Bu sayede her sütun için tam 5 adet sivri kırmızı dağ (A, B, C, D, E) göreceğiz!
      const smoothedRed = new Float32Array(BINS);
      const blurRadius = 2; 
      let maxRedVal = 0;
      for (let i = 0; i < BINS; i++) {
        let sum = 0, count = 0;
        for (let j = Math.max(0, i - blurRadius); j <= Math.min(BINS - 1, i + blurRadius); j++) {
          sum += redBins[j];
          count++;
        }
        smoothedRed[i] = sum / count;
        if (smoothedRed[i] > maxRedVal) maxRedVal = smoothedRed[i];
      }

      // Debug: Kırmızı yuvarlakların haritasını ekrana çiz (kırmızı grafik olarak sayfanın en altına)
      ctx.fillStyle = "rgba(255, 0, 0, 0.7)";
      for (let i = 0; i < BINS; i++) {
        const x = img.width * (i / BINS);
        const h = (smoothedRed[i] / maxRedVal) * 150; // Max 150px yüksekliğinde grafik
        ctx.fillRect(x, img.height - h, img.width / BINS + 1, h);
      }

      for (const category of layout.categories) {
        const catResult: OMRResult = { categoryName: category.categoryName, questions: [] };

        for (const block of category.blocks) {
          const numRows = block.endQuestion - block.startQuestion + 1;

          // DİKEY YERLEŞİM: LLM'in dikey (Y) tahminine en yakın zamanlama çizgisini bul.
          // Mikro arama YAPMIYORUZ! LLM ne dediyse O.
          let bestStartIdx = 0;
          if (block.startY !== undefined) {
            const pixelStartY = (block.startY / 1000) * img.height;
            let minDist = 999999;
            const searchRange = Math.max(30, rowAnchors.length);
            for (let i = -searchRange; i < searchRange * 2; i++) {
              const anch = getAnchor(i);
              const dist = Math.abs(anch.left.y - pixelStartY);
              if (dist < minDist) {
                minDist = dist;
                bestStartIdx = i;
              }
            }
          } else {
            // Eski JSON formatı geldiyse varsayılan olarak başa hizala
            bestStartIdx = Math.min(0, rowAnchors.length - numRows);
          }

          // YATAY YERLEŞİM: KÖKTEN ÇÖZÜM (CV Histogramı)
          // YATAY YERLEŞİM: KIRMIZI YUVARLAK (REDNESS) TARAK FİLTRESİ
          const roughCX = (block.columnXCenter / 1000) * img.width;
          const roughCenterT = (roughCX - avgLX) / avgRowLen;
          
          let bestScore = -1;
          let bestCenterT = roughCenterT;
          let bestGapT = gapT;
          
          // Sadece kırmızı yuvarlakların izini taşıyan `smoothedRed` dizisinde, 
          // 5 dişli bir tarak (A, B, C, D, E) gezdiriyoruz. 
          // Metinler siyah olduğu için haritada YOKLAR, yani hata yapma ihtimali SIFIR!
          const searchRadT = 0.08; // ±%8 LLM kaba tahmini etrafında ara
          for(let tOff = -searchRadT; tOff <= searchRadT; tOff += 0.002) {
              const testCenterT = roughCenterT + tOff;
              // Optik formlarda şıklar arası boşluk (gapScale) genellikle satır aralığının %100 - %130'u kadardır
              for(let gapScale = 1.0; gapScale <= 1.35; gapScale += 0.02) {
                  const testGapT = gapT * gapScale;
                  let score = 0;
                  
                  // A, B, C, D, E şıklarının (col = -2'den +2'ye) kırmızı haritadaki toplam gücünü ölç
                  for(let col = -2; col <= 2; col++) {
                      const t = testCenterT + col * testGapT;
                      const bin = Math.max(0, Math.min(BINS - 1, Math.floor(t * BINS)));
                      score += smoothedRed[bin];
                  }
                  
                  // LLM'in gösterdiği kaba merkezden çok fazla uzaklaşmaması için çok hafif bir bağ
                  score -= Math.abs(tOff) * 100;
                  
                  if(score > bestScore) {
                      bestScore = score;
                      bestCenterT = testCenterT;
                      bestGapT = testGapT;
                  }
              }
          }

          // Debug: Bulunan 5 kırmızı yuvarlağın merkezini çiz (Mavi dikey çizgiler)
          ctx.fillStyle = "rgba(0, 0, 255, 0.5)";
          const dbgL = getAnchor(bestStartIdx).left;
          const dbgR = getAnchor(bestStartIdx).right;
          for(let col = -2; col <= 2; col++) {
             const t = bestCenterT + col * bestGapT;
             const dbgX = dbgL.x + t * (dbgR.x - dbgL.x);
             ctx.fillRect(dbgX - 1, 0, 2, img.height);
          }

          // ──── Kutucukları çiz ve oku ────
          const startIdx = bestStartIdx;

          for (let q = 0; q < numRows; q++) {
            const mIdx = startIdx + q;
            const qNum = block.startQuestion + q;
            const anch = getAnchor(mIdx);
            // Referans noktalarını kopyalayalım ki orjinal yapıyı bozmadan değiştirebilelim
            const L = { ...anch.left };
            const R = { ...anch.right };

            // ──── MİKRO-DİKEY HİZALAMA (PERSPECTIVE CORRECTION) ────
            // Telefon kamerasıyla çekilen fotoğraflarda kağıt yamulur (Perspektif bozulması).
            // Bu yüzden satırlar dümdüz yatay gitmez, yelpaze gibi açılır veya daralır.
            // Sadece bu satırdaki 5 şıkkın "Kırmızı Ağırlık Merkezini" bularak o satırı milimetrik ortalayacağız!
            let sumY = 0;
            let sumMass = 0;
            const winY = Math.floor(nominalBubbleSize); // ± Yarıçap kadar dikey arama
            for(let dy = -winY; dy <= winY; dy++) {
                const py = Math.floor(L.y) + dy;
                if (py < 0 || py >= img.height) continue;
                
                let rowRed = 0;
                for(let col = 0; col < 5; col++) {
                    const t = bestCenterT + (col - 2) * bestGapT;
                    const px = Math.floor(L.x + t * (R.x - L.x));
                    if (px < 0 || px >= img.width) continue;
                    
                    // Şıkkın merkezindeki ±3 piksellik alanı tara
                    for(let dx = -3; dx <= 3; dx++) {
                        const px_dx = px + dx;
                        if (px_dx < 0 || px_dx >= img.width) continue;
                        const idx = (py * img.width + px_dx) * 4;
                        const r_val = imageData.data[idx];
                        const g_val = imageData.data[idx+1];
                        const b_val = imageData.data[idx+2];
                        const redness = r_val - Math.max(g_val, b_val);
                        if (redness > 20) rowRed += redness;
                    }
                }
                sumY += dy * rowRed;
                sumMass += rowRed;
            }
            
            // Eğer bu satırda kırmızı mürekkep bulduysak (öğrenci hepsini karalamadıysa), ağırlık merkezine kay!
            if (sumMass > 150) {
                const yShift = sumY / sumMass;
                L.y += yShift;
                R.y += yShift;
            }
            // ──────────────────────────────────────────────────────────

            const darknessScores: { option: string; score: number }[] = [];

            for (let col = 0; col < 5; col++) {
              // 1D Kırmızı Tarak Filtresinden çıkan kesin X koordinatları
              const t = bestCenterT + (col - 2) * bestGapT;
              
              const cx = L.x + t * (R.x - L.x);
              const cy = L.y + t * (R.y - L.y);

              const bx = cx - nominalBubbleSize / 2;
              const by = cy - nominalBubbleSize / 2;

              ctx.strokeRect(bx, by, nominalBubbleSize, nominalBubbleSize);

              darknessScores.push({
                option: options[col],
                score: getAverageDarkness(imageData, bx, by, nominalBubbleSize, nominalBubbleSize),
              });
            }

            // Skor analizi
            const sorted = [...darknessScores].sort((a, b) => b.score - a.score);
            const darkest = sorted[0];
            const secondDarkest = sorted[1];
            let sumOthers = 0;
            for (let i = 1; i < 5; i++) sumOthers += sorted[i].score;
            const avgOther = sumOthers / 4;

            let selectedOption: string | null = null;
            if (darkest.score > 25 && darkest.score > avgOther * 1.6) {
              if (secondDarkest.score > darkest.score * 0.8 && secondDarkest.score > 35) {
                selectedOption = "X";
              } else {
                selectedOption = darkest.option;
              }
            }

            catResult.questions.push({ questionNumber: qNum, answer: selectedOption });
          }
        }

        catResult.questions.sort((a, b) => a.questionNumber - b.questionNumber);
        results.push(catResult);
      }

      resolve({ data: results, debugImageBase64: canvas.toDataURL("image/jpeg", 0.8) });
    };
    img.onerror = (err) => reject(err);
    img.src = base64Data;
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// NOT: Cevap Anahtarı ile Karşılaştırma
// ═══════════════════════════════════════════════════════════════════════════════

export function gradeOMR(answerKeyData: OMRResult[], studentData: OMRResult[]) {
  let totalCorrect = 0;
  let totalIncorrect = 0;
  let totalBlank = 0;
  const resultCategories = [];

  const akCategories = answerKeyData || [];
  const stCategories = studentData || [];

  for (let i = 0; i < akCategories.length; i++) {
    const akCategory = akCategories[i];
    const stCategory = stCategories[i] || { categoryName: "", questions: [] };

    let categoryCorrect = 0;
    let categoryIncorrect = 0;
    let categoryBlank = 0;
    const questionsResult = [];

    const stAnswersMap = new Map<number, string | null>();
    (stCategory.questions || []).forEach((q) => {
      stAnswersMap.set(q.questionNumber, q.answer);
    });

    for (const akQuestion of akCategory.questions || []) {
      const qNum = akQuestion.questionNumber;
      const correctAns = akQuestion.answer;
      const studentAns = stAnswersMap.has(qNum) ? stAnswersMap.get(qNum) ?? null : null;

      let status = "blank";
      if (studentAns === null) {
        status = "blank";
        categoryBlank++;
      } else if (correctAns !== null && studentAns.toUpperCase() === correctAns.toUpperCase()) {
        status = "correct";
        categoryCorrect++;
      } else {
        status = "incorrect";
        categoryIncorrect++;
      }

      questionsResult.push({
        questionNumber: qNum,
        studentAnswer: studentAns,
        correctAnswer: correctAns || "",
        status: status,
      });
    }

    totalCorrect += categoryCorrect;
    totalIncorrect += categoryIncorrect;
    totalBlank += categoryBlank;

    resultCategories.push({
      categoryName: akCategory.categoryName || `Kategori ${i + 1}`,
      categoryCorrect,
      categoryIncorrect,
      categoryBlank,
      questions: questionsResult,
    });
  }

  return { totalCorrect, totalIncorrect, totalBlank, categories: resultCategories };
}
