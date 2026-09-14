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

interface Run {
  y: number;
  startX: number;
  endX: number;
}

interface MarkCluster {
  runs: Run[];
}

function findRowAnchors(imageData: ImageData): { anchors: RowAnchor[]; medianGap: number } {
  const width = imageData.width;
  const height = imageData.height;

  // 1. Yatay siyah çizgileri (run) bul (Sadece sol %25'i tara)
  const searchW = Math.floor(width * 0.25);
  const runs: Run[] = [];
  
  for (let y = 0; y < height; y++) {
    let inRun = false;
    let startX = 0;
    for (let x = 0; x < searchW; x++) {
      const idx = (y * width + x) * 4;
      const brightness = (imageData.data[idx] + imageData.data[idx + 1] + imageData.data[idx + 2]) / 3;
      const isDark = brightness < 120;
      
      if (isDark && !inRun) {
        inRun = true;
        startX = x;
      } else if (!isDark && inRun) {
        inRun = false;
        const runW = x - startX;
        // Dikey ince sınır çizgilerini yok say (genişlik sayfanın %1.2'si ile %10'u arasında olmalı)
        if (runW > width * 0.012 && runW < width * 0.1) {
          runs.push({ y, startX, endX: x });
        }
      }
    }
    if (inRun) {
      const runW = searchW - startX;
      if (runW > width * 0.012 && runW < width * 0.1) {
        runs.push({ y, startX, endX: searchW });
      }
    }
  }

  // 2. Run'ları birleştirerek Timing Mark kümeleri oluştur
  const marks: MarkCluster[] = [];
  let currentMark: MarkCluster | null = null;

  for (const r of runs) {
    if (!currentMark) {
      currentMark = { runs: [r] };
    } else {
      const lastRun = currentMark.runs[currentMark.runs.length - 1];
      // Y ekseninde en fazla 2 piksel atlayabilir, X ekseninde ciddi oranda örtüşmeli
      if (r.y - lastRun.y <= 2) {
        const overlap = Math.max(0, Math.min(r.endX, lastRun.endX) - Math.max(r.startX, lastRun.startX));
        if (overlap > (r.endX - r.startX) * 0.4) {
          currentMark.runs.push(r);
          continue;
        }
      }
      marks.push(currentMark);
      currentMark = { runs: [r] };
    }
  }
  if (currentMark) marks.push(currentMark);

  // 3. Yüksekliğe göre filtrele (Sadece 2px ile sayfanın %3'ü yüksekliğindeki markları tut)
  let validMarks = marks.filter(m => {
    const h = m.runs[m.runs.length - 1].y - m.runs[0].y + 1;
    return h >= Math.max(2, height * 0.002) && h < height * 0.03;
  });

  if (validMarks.length < 5) {
    console.warn("Yeterli timing mark bulunamadı — fallback yapılıyor.");
    const fg = height / 35;
    const anch: RowAnchor[] = [];
    for (let i = 0; i < 40; i++) {
      const y = height * 0.1 + i * fg;
      anch.push({ left: { x: 0, y }, right: { x: width, y } });
    }
    return { anchors: anch, medianGap: fg };
  }

  // 4. Periyodisite (Median Gap) bul ve hatalı (aradaki) markları sil
  const yCenters = validMarks.map(m => m.runs.reduce((s, r) => s + r.y, 0) / m.runs.length);
  const gaps: number[] = [];
  for (let i = 1; i < yCenters.length; i++) gaps.push(yCenters[i] - yCenters[i - 1]);
  gaps.sort((a, b) => a - b);
  const medianGap = gaps[Math.floor(gaps.length / 2)] || 20;

  validMarks = validMarks.filter((m, i, arr) => {
    const yc = yCenters[i];
    const hasPrev = i > 0 && Math.abs(yc - yCenters[i - 1] - medianGap) < medianGap * 0.4;
    const hasNext = i < arr.length - 1 && Math.abs(yCenters[i + 1] - yc - medianGap) < medianGap * 0.4;
    return hasPrev || hasNext;
  });

  // 5. Her mark için SAĞ ve SOL yarımların ağırlık merkezini bul -> Eğim hesapla
  interface MarkStat { cx: number; cy: number; slope: number; }
  const stats: MarkStat[] = [];

  for (const m of validMarks) {
    let sumX = 0, sumY = 0, count = 0;
    for (const r of m.runs) {
      sumX += (r.startX + r.endX) / 2;
      sumY += r.y;
      count++;
    }
    const cx = sumX / count;
    const cy = sumY / count;

    let lX = 0, lY = 0, lC = 0;
    let rX = 0, rY = 0, rC = 0;
    for (const r of m.runs) {
      for (let x = r.startX; x <= r.endX; x++) {
        if (x < cx) { lX += x; lY += r.y; lC++; }
        else { rX += x; rY += r.y; rC++; }
      }
    }
    
    const leftX = lX / lC, leftY = lY / lC;
    const rightX = rX / rC, rightY = rY / rC;
    
    // Küçük çizginin kendi eğimi
    const dx = rightX - leftX;
    const slope = dx > 2 ? (rightY - leftY) / dx : 0;
    
    stats.push({ cx, cy, slope });
  }

  // 6. Eğimleri yumuşat (Kısa çizgiden sayfa sonuna uzatınca titreşimi önlemek için Moving Average)
  const smoothedSlopes: number[] = [];
  for (let i = 0; i < stats.length; i++) {
    let sumSlope = 0, c = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(stats.length - 1, i + 2); j++) {
      sumSlope += stats[j].slope;
      c++;
    }
    smoothedSlopes.push(sumSlope / c);
  }

  // 7. Satırı boydan boya çizebilmek için X=0 ve X=width noktalarına izdüşüm yap
  const anchors: RowAnchor[] = [];
  for (let i = 0; i < stats.length; i++) {
    const s = stats[i];
    const slope = smoothedSlopes[i];
    
    const yAt0 = s.cy - slope * s.cx;
    const yAtW = s.cy + slope * (width - s.cx);
    
    anchors.push({
      left: { x: 0, y: yAt0 },
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
          
          // Çizgi
          ctx.strokeStyle = "rgba(0, 255, 255, 0.8)";
          ctx.lineWidth = 3;
          ctx.setLineDash([8, 8]);
          ctx.beginPath();
          ctx.moveTo(cx, 0);
          ctx.lineTo(cx, img.height);
          ctx.stroke();
          ctx.setLineDash([]);
          
          // Etiket için kutu
          const text = `${cat.categoryName.substring(0, 15)} Q${blk.startQuestion}-${blk.endQuestion}`;
          ctx.font = "bold 14px monospace";
          const tw = ctx.measureText(text).width;
          const th = 20;
          const labelY = 80 + (idx * 25); // Alt alta binmesin diye kaydır
          
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
      const avgRowLen = img.width;
      const nominalBubbleSize = Math.min(medianGap * 0.7, img.width * 0.03);
      
      // Sütunlar arası mesafe (Balonlar arası yatay boşluk, dikey boşluğa yaklaşık eşittir)
      // T cinsinden ifade ediyoruz (0 ile 1 arası tam sayfa)
      const gapT = (medianGap * 1.0) / img.width;

      for (const category of layout.categories) {
        const catResult: OMRResult = { categoryName: category.categoryName, questions: [] };

        for (const block of category.blocks) {
          const numRows = block.endQuestion - block.startQuestion + 1;
          const maxStartIdx = rowAnchors.length - numRows;
          if (maxStartIdx < 0) continue;

          // LLM'in sütun tahmini → t değerine çevir (0-1000 arası gelen değeri 0-1 arası oran yap)
          const roughCenterT = block.columnXCenter / 1000;

          // ──── 2D Comb Filter: t-uzayında sütun + satır arama ────
          let bestScore = -999999;
          let bestStartIdx = 0;
          let bestCenterT = roughCenterT;

          // LLM'in kaba tahmini bazen çok sapabildiği için arama yarıçapını oldukça geniş tutuyoruz (Sayfanın ±%25'i)
          const searchRadT = 0.25; 
          const stepT = 0.005;

          for (let testIdx = 0; testIdx <= maxStartIdx; testIdx++) {
            for (let tOff = -searchRadT; tOff <= searchRadT; tOff += stepT) {
              const testCenterT = roughCenterT + tOff;
              let score = 0;

              // Hız için her 3. satırı test et
              for (let r = 0; r < numRows; r += 3) {
                const anch = rowAnchors[testIdx + r];
                if (!anch) continue;
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
                score += (testIdx / Math.max(1, maxStartIdx)) * 40;
              } else if (block.verticalAlignment === "top") {
                score += ((maxStartIdx - testIdx) / Math.max(1, maxStartIdx)) * 40;
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
            if (mIdx >= rowAnchors.length) break;

            const qNum = block.startQuestion + row;
            const anch = rowAnchors[mIdx];
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
