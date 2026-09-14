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

function findMarksInRegion(
  imageData: ImageData,
  xStart: number,
  xEnd: number,
  knownGap: number | null = null,
  preferRightmost: boolean = false
): { bestX: number; marks: Point[]; medianGap: number; score: number } {
  const width = imageData.width;
  const height = imageData.height;

  const columnScores: { x: number; score: number; medGap: number }[] = [];

  for (let x = xStart; x < xEnd; x++) {
    const darkEntries: number[] = [];
    let wasDark = false;
    for (let y = Math.floor(height * 0.05); y < height * 0.95; y++) {
      const idx = (y * width + x) * 4;
      const brightness =
        (imageData.data[idx] + imageData.data[idx + 1] + imageData.data[idx + 2]) / 3;
      if (brightness < 120 && !wasDark) darkEntries.push(y);
      wasDark = brightness < 120;
    }

    if (darkEntries.length < 5) continue;

    const gaps: number[] = [];
    for (let i = 1; i < darkEntries.length; i++) {
      gaps.push(darkEntries[i] - darkEntries[i - 1]);
    }
    const sortedGaps = [...gaps].sort((a, b) => a - b);
    const medGap = sortedGaps[Math.floor(sortedGaps.length / 2)];

    if (medGap < height * 0.005) continue; // Tahta deseni gibi yüksek frekanslı gürültüyü reddet

    if (knownGap !== null && Math.abs(medGap - knownGap) > knownGap * 0.5) continue;

    const targetGap = knownGap || medGap;
    let periodicCount = 0;
    for (const g of gaps) {
      if (Math.abs(g - targetGap) < targetGap * 0.35) periodicCount++;
    }

    columnScores.push({ x, score: periodicCount, medGap });
  }

  if (columnScores.length === 0) {
    return { bestX: Math.floor((xStart + xEnd) / 2), marks: [], medianGap: 20, score: 0 };
  }

  // En iyi sütunu seç
  let bestEntry: (typeof columnScores)[0];
  if (preferRightmost) {
    const maxScore = Math.max(...columnScores.map((s) => s.score));
    const qualifying = columnScores.filter((s) => s.score >= maxScore * 0.5);
    bestEntry = qualifying.reduce((a, b) => (a.x > b.x ? a : b));
  } else {
    bestEntry = columnScores.reduce((a, b) => (a.score > b.score ? a : b));
  }

  const bestX = bestEntry.x;

  // bestX etrafında dar şeritle mark Y merkezlerini bul
  const stripW = Math.floor(width * 0.015);
  const sX = Math.max(0, bestX - stripW);
  const eX = Math.min(width - 1, bestX + stripW);

  const profile = new Float32Array(height);
  for (let y = 0; y < height; y++) {
    let dc = 0;
    for (let x = sX; x <= eX; x++) {
      const idx = (y * width + x) * 4;
      if ((imageData.data[idx] + imageData.data[idx + 1] + imageData.data[idx + 2]) / 3 < 120)
        dc++;
    }
    profile[y] = dc;
  }

  const marks: Point[] = [];
  const peakThr = Math.max(2, Math.floor(width * 0.004));
  let inPeak = false,
    peakSY = 0,
    prevMX = bestX;
  const trkR = Math.floor(width * 0.015);

  for (let y = 0; y < height; y++) {
    if (profile[y] > peakThr && !inPeak) {
      inPeak = true;
      peakSY = y;
    } else if (profile[y] <= peakThr && inPeak) {
      inPeak = false;
      const mH = y - peakSY;
      if (mH >= 2 && mH < height * 0.05) {
        const cY = Math.floor((peakSY + y) / 2);
        let sX2 = 0,
          cX2 = 0;
        for (let mx = prevMX - trkR; mx <= prevMX + trkR; mx++) {
          if (mx < 0 || mx >= width) continue;
          const idx = (cY * width + mx) * 4;
          if ((imageData.data[idx] + imageData.data[idx + 1] + imageData.data[idx + 2]) / 3 < 120) {
            sX2 += mx;
            cX2++;
          }
        }
        const aX = cX2 > 0 ? Math.floor(sX2 / cX2) : prevMX;
        marks.push({ x: aX, y: cY });
        prevMX = aX;
      }
    }
  }

  return { bestX, marks, medianGap: bestEntry.medGap, score: bestEntry.score };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ÇİFT ANCHOR: Sol + Sağ referans noktalarıyla satır çizgisi oluşturma
// ═══════════════════════════════════════════════════════════════════════════════

function findRowAnchors(imageData: ImageData): { anchors: RowAnchor[]; medianGap: number } {
  const width = imageData.width;
  const height = imageData.height;

  // 1. SOL timing markları
  const leftResult = findMarksInRegion(imageData, 0, Math.floor(width * 0.3));

  if (leftResult.marks.length < 5) {
    console.warn("Sol timing marklar bulunamadı — yapay ızgara.");
    const fg = height / 35;
    const anch: RowAnchor[] = [];
    for (let i = 0; i < 40; i++) {
      const y = height * 0.1 + i * fg;
      anch.push({ left: { x: width * 0.05, y }, right: { x: width * 0.5, y } });
    }
    return { anchors: anch, medianGap: fg };
  }

  // 2. Median gap hesapla ve sol markları filtrele
  const lGaps: number[] = [];
  for (let i = 1; i < leftResult.marks.length; i++) {
    lGaps.push(leftResult.marks[i].y - leftResult.marks[i - 1].y);
  }
  lGaps.sort((a, b) => a - b);
  let medianGap = lGaps[Math.floor(lGaps.length / 2)] || 20;
  medianGap = Math.min(medianGap, height / 10);

  const filteredLeft = leftResult.marks.filter((m, i, arr) => {
    if (arr.length < 2) return true;
    if (i === 0) return Math.abs(arr[1].y - m.y - medianGap) < medianGap * 0.35;
    return Math.abs(m.y - arr[i - 1].y - medianGap) < medianGap * 0.35;
  });

  const leftMarks = filteredLeft.length >= 5 ? filteredLeft : leftResult.marks;

  // 3. SAĞ referans çizgisi — aynı periyotta en sağdaki dikey yapı
  const rightResult = findMarksInRegion(
    imageData,
    Math.floor(width * 0.25),
    Math.floor(width * 0.9),
    medianGap,
    true
  );

  // 4. Sol-sağ eşleştirme
  const anchors: RowAnchor[] = [];
  for (const lm of leftMarks) {
    let bestRM: Point | null = null;
    let bestDist = Infinity;
    for (const rm of rightResult.marks) {
      const d = Math.abs(rm.y - lm.y);
      if (d < bestDist && d < medianGap * 0.5) {
        bestDist = d;
        bestRM = rm;
      }
    }
    anchors.push({
      left: lm,
      right: bestRM || { x: rightResult.bestX, y: lm.y },
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

      // LLM sütun tahminleri (cyan kesik çizgi)
      for (const cat of layout.categories) {
        for (const blk of cat.blocks) {
          const cx = (blk.columnXCenter / 1000) * img.width;
          ctx.strokeStyle = "cyan";
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(cx, 0);
          ctx.lineTo(cx, img.height);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = "cyan";
          ctx.font = "10px monospace";
          ctx.fillText(`Q${blk.startQuestion}-${blk.endQuestion}`, cx - 25, 78);
        }
      }

      // ──────────── 2. BUBBLE OKUMA (Row Line Interpolation) ────────────
      ctx.strokeStyle = "red";
      ctx.lineWidth = 2;

      // Ortalama satır uzunluğu (t hesapları için)
      const avgLX = rowAnchors.reduce((s, a) => s + a.left.x, 0) / rowAnchors.length;
      const avgRX = rowAnchors.reduce((s, a) => s + a.right.x, 0) / rowAnchors.length;
      const avgRowLen = Math.max(avgRX - avgLX, 1);
      const nominalBubbleSize = Math.min(medianGap * 0.7, img.width * 0.03);
      // Sütunlar arası mesafe (t cinsinden)
      const gapT = medianGap / avgRowLen;

      for (const category of layout.categories) {
        const catResult: OMRResult = { categoryName: category.categoryName, questions: [] };

        for (const block of category.blocks) {
          const numRows = block.endQuestion - block.startQuestion + 1;
          const maxStartIdx = rowAnchors.length - numRows;
          if (maxStartIdx < 0) continue;

          // LLM'in sütun tahmini → t değerine çevir
          const roughCX = (block.columnXCenter / 1000) * img.width;
          const roughCenterT = (roughCX - avgLX) / avgRowLen;

          // ──── 2D Comb Filter: t-uzayında sütun + satır arama ────
          let bestScore = -999999;
          let bestStartIdx = 0;
          let bestCenterT = roughCenterT;

          const searchRadT = 0.1; // ±%10 satır uzunluğu kadar ara
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
