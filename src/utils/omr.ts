export interface BlockMap {
  startQuestion: number;
  endQuestion: number;
  columnXCenter: number;
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

      for (const category of layout.categories) {
        const catResult: OMRResult = { categoryName: category.categoryName, questions: [] };

        for (const block of category.blocks) {
          const numRows = block.endQuestion - block.startQuestion + 1;
          const minTestIdx = Math.min(0, rowAnchors.length - numRows);
          const maxTestIdx = Math.max(0, rowAnchors.length - Math.max(1, Math.floor(numRows * 0.5)));

          // LLM'in sütun tahmini → t değerine çevir
          const roughCX = (block.columnXCenter / 1000) * img.width;
          const roughCenterT = (roughCX - avgLX) / avgRowLen;

          // ──── 2D Comb Filter: t-uzayında sütun + satır arama ────
          let bestScore = -999999;
          let bestStartIdx = 0;
          let bestCenterT = roughCenterT;

          // LLM'in kaba tahmini bazen çok sapabildiği için arama yarıçapını oldukça geniş tutuyoruz (Sayfanın ±%25'i)
          const searchRadT = 0.25; 
          const stepT = 0.005;

          for (let testIdx = minTestIdx; testIdx <= maxTestIdx; testIdx++) {
            for (let tOff = -searchRadT; tOff <= searchRadT; tOff += stepT) {
              const testCenterT = roughCenterT + tOff;
              let score = 0;

              // Boş kağıtlarda rastgele yerlere gitmesini engellemek için 0. indekse hafif bir çekim kuvveti uyguluyoruz
              const baselinePenalty = Math.abs(testIdx) * 0.01;
              score -= baselinePenalty;

              // Hız için her 3. satırı test et
              for (let r = 0; r < numRows; r += 3) {
                const anch = getAnchor(testIdx + r);
                const L = anch.left;
                const R = anch.right;

                for (let col = -2; col <= 2; col++) {
                  const t = testCenterT + col * gapT;
                  const cx = L.x + t * (R.x - L.x);
                  const cy = L.y + t * (R.y - L.y);

                  score += getAverageDarkness(
                    imageData,
                    cx - nominalBubbleSize / 2,
                    cy - nominalBubbleSize / 2,
                    nominalBubbleSize,
                    nominalBubbleSize
                  );

                  // Şıklar arası boşluk beyaz olmalı
                  if (col < 2) {
                    const gt = testCenterT + (col + 0.5) * gapT;
                    const gx = L.x + gt * (R.x - L.x);
                    const gy = L.y + gt * (R.y - L.y);
                    const gs = nominalBubbleSize * 0.4;
                    score -=
                      getAverageDarkness(imageData, gx - gs / 2, gy - gs / 2, gs, gs) * 1.5;
                  }
                }
              }

              // LLM tahmininden çok uzaklaşmasın
              score -= Math.abs(tOff) * avgRowLen * 1.5;

              // Dikey hizalama tercihi (LLM ipucu)
              if (block.verticalAlignment === "bottom") {
                score += (testIdx / Math.max(1, maxTestIdx)) * 40;
              } else if (block.verticalAlignment === "top") {
                score += ((maxTestIdx - testIdx) / Math.max(1, maxTestIdx)) * 40;
              }

              if (score > bestScore) {
                bestScore = score;
                bestStartIdx = testIdx;
                bestCenterT = testCenterT;
              }
            }
          }

          // ──── Kutucukları çiz ve oku ────
          for (let row = 0; row < numRows; row++) {
            const mIdx = bestStartIdx + row;
            const qNum = block.startQuestion + row;
            const anch = getAnchor(mIdx);
            const L = anch.left;
            const R = anch.right;

            const darknessScores: { option: string; score: number }[] = [];

            for (let col = 0; col < 5; col++) {
              const t = bestCenterT + (col - 2) * gapT;
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
