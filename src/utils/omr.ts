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

function findTimingMarks(imageData: ImageData): Point[] {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;
  
  // Piksel parlaklığını hızlıca oku
  const getBrightness = (x: number, y: number): number => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || ix >= width || iy < 0 || iy >= height) return 255;
    const idx = (iy * width + ix) * 4;
    return (data[idx] + data[idx+1] + data[idx+2]) / 3;
  };
  
  // ─── ADIM 1: Kağıdın sol kenarındaki hizalama çizgisinin kaba X konumunu
  //             3 farklı Y bölgesinde (üst, orta, alt) bul. ───
  //             Böylece kağıdın eğimini (skew) hesaplayabiliriz.
  const searchWidth = Math.floor(width * 0.3);
  const zones = [
    { yStart: Math.floor(height * 0.15), yEnd: Math.floor(height * 0.35) },  // üst
    { yStart: Math.floor(height * 0.40), yEnd: Math.floor(height * 0.60) },  // orta
    { yStart: Math.floor(height * 0.65), yEnd: Math.floor(height * 0.85) },  // alt
  ];
  
  const zoneBestX: number[] = [];
  const zoneBestY: number[] = []; // her zonun dikey ortası
  
  for (const zone of zones) {
    const scores = new Int32Array(searchWidth);
    for (let x = 0; x < searchWidth; x++) {
      let transitions = 0;
      let wasDark = false;
      for (let y = zone.yStart; y < zone.yEnd; y += 3) {
        const isDark = getBrightness(x, y) < 120;
        if (isDark !== wasDark) { transitions++; wasDark = isDark; }
      }
      scores[x] = transitions;
    }
    let best = 0, bestScore = 0;
    for (let x = 0; x < searchWidth; x++) {
      if (scores[x] > bestScore) { bestScore = scores[x]; best = x; }
    }
    zoneBestX.push(best);
    zoneBestY.push(Math.floor((zone.yStart + zone.yEnd) / 2));
  }
  
  // ─── ADIM 2: Sol kenar çizgisinin eğimini hesapla (dx/dy) ───
  // Üst bölge X=50, alt bölge X=65 ise → kağıt sağa doğru yatmış demek
  // skewSlope = (X_alt - X_üst) / (Y_alt - Y_üst)
  const dxTotal = zoneBestX[2] - zoneBestX[0];
  const dyTotal = zoneBestY[2] - zoneBestY[0];
  const skewSlope = dyTotal !== 0 ? dxTotal / dyTotal : 0; // dx/dy
  
  // Orta bölgenin X'ini referans noktası olarak kullan
  const refX = zoneBestX[1];
  const refY = zoneBestY[1];
  
  // ─── ADIM 3: Eğimi takip ederek her Y satırı için doğru X'te tara ───
  // Her Y koordinatı için çizginin olması gereken X: refX + (y - refY) * skewSlope
  const stripHalfWidth = Math.floor(width * 0.025);
  
  const verticalProfile = new Float32Array(height);
  for (let y = 0; y < height; y++) {
    const expectedX = refX + (y - refY) * skewSlope;
    const sX = Math.max(0, Math.floor(expectedX - stripHalfWidth));
    const eX = Math.min(width - 1, Math.floor(expectedX + stripHalfWidth));
    let darkCount = 0;
    for (let x = sX; x <= eX; x++) {
      if (getBrightness(x, y) < 120) darkCount++;
    }
    verticalProfile[y] = darkCount;
  }
  
  // ─── ADIM 4: Profildeki zirveleri (siyah çizgileri) bul ───
  const marks: Point[] = [];
  const threshold = (stripHalfWidth * 2) * 0.3;
  let inPeak = false;
  let peakStartY = 0;
  
  for (let y = 0; y < height; y++) {
    if (verticalProfile[y] > threshold && !inPeak) {
      inPeak = true;
      peakStartY = y;
    } else if (verticalProfile[y] <= threshold && inPeak) {
      inPeak = false;
      const peakEndY = y;
      const markHeight = peakEndY - peakStartY;
      if (markHeight >= 2 && markHeight < height * 0.05) {
        const centerY = Math.floor((peakStartY + peakEndY) / 2);
        
        // Bu çizginin gerçek X merkezini piksel piksel hesapla
        const expectedX = refX + (centerY - refY) * skewSlope;
        const sX = Math.max(0, Math.floor(expectedX - stripHalfWidth));
        const eX = Math.min(width - 1, Math.floor(expectedX + stripHalfWidth));
        
        let sumX = 0, countX = 0;
        for (let my = peakStartY; my <= peakEndY; my++) {
          for (let mx = sX; mx <= eX; mx++) {
            if (getBrightness(mx, my) < 120) { sumX += mx; countX++; }
          }
        }
        const actualX = countX > 0 ? sumX / countX : expectedX;
        marks.push({ x: actualX, y: centerY });
      }
    }
  }
  
  return marks;
}

function getAverageDarkness(imageData: ImageData, startX: number, startY: number, width: number, height: number): number {
  let totalDarkness = 0;
  let count = 0;
  
  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      const px = Math.floor(startX + dx);
      const py = Math.floor(startY + dy);
      
      if (px >= 0 && px < imageData.width && py >= 0 && py < imageData.height) {
        const idx = (py * imageData.width + px) * 4;
        const r = imageData.data[idx];
        const g = imageData.data[idx + 1];
        const b = imageData.data[idx + 2];
        const darkness = 255 - (0.299 * r + 0.587 * g + 0.114 * b);
        
        totalDarkness += darkness;
        count++;
      }
    }
  }
  
  return count > 0 ? totalDarkness / count : 0;
}

    // Removed snapToDarkestX

// Linear Regression: y = mx + b (but here we map Y to X to predict X based on Y)
function calculateLinearRegression(points: Point[]): { slope: number, intercept: number } {
  let sumY = 0, sumX = 0, sumYY = 0, sumYX = 0;
  const n = points.length;
  if (n === 0) return { slope: 0, intercept: 0 };
  
  for (const p of points) {
    sumY += p.y;
    sumX += p.x;
    sumYY += p.y * p.y;
    sumYX += p.y * p.x;
  }
  
  const slope = (n * sumYX - sumY * sumX) / (n * sumYY - sumY * sumY);
  const intercept = (sumX - slope * sumY) / n;
  
  return { slope, intercept };
}

export async function processOMRImage(base64Data: string, layout: LayoutMap): Promise<OMRProcessingResult> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        return reject(new Error("Canvas context could not be created"));
      }
      ctx.drawImage(img, 0, 0);
      
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const results: OMRResult[] = [];
      const options = ['A', 'B', 'C', 'D', 'E'] as const;
      
      // 1. TIMING MARK DETECTION
      // Bu adım sayesinde LLM'in dikey koordinat uydurmasına gerek kalmadı.
      const rawMarks = findTimingMarks(imageData);
      
      // Gürültüyü (header yazıları vb.) temizleyip, eşit aralıklı gerçek soru satırlarını bulalım
      const markGaps: number[] = [];
      for (let i = 1; i < rawMarks.length; i++) {
          markGaps.push(rawMarks[i].y - rawMarks[i-1].y);
      }
      // En çok tekrar eden boşluk (median/mode) rowHeightPx'dir
      markGaps.sort((a,b) => a - b);
      // Kağıtta genelde 30-40 soru olur, yani medianGap en fazla img.height / 20 olabilir. Aşırı büyükse cap'le.
      let medianGap = markGaps[Math.floor(markGaps.length / 2)] || 20;
      medianGap = Math.min(medianGap, img.height / 10);
      
      let timingMarks = rawMarks.filter((m, i, arr) => {
          if (arr.length < 2) return true;
          if (i === 0) return Math.abs(arr[1].y - m.y - medianGap) < medianGap * 0.3;
          return Math.abs(m.y - arr[i-1].y - medianGap) < medianGap * 0.3;
      });

      if (timingMarks.length < 5) {
          console.warn("Yeterli Timing Mark bulunamadı, fallback (yapay ızgara) devreye giriyor.");
          timingMarks = [];
          const fakeGap = img.height / 35; 
          for (let i = 0; i < 40; i++) {
              timingMarks.push({ x: img.width * 0.05, y: (img.height * 0.1) + (i * fakeGap) });
          }
          medianGap = fakeGap;
      }

       // Eksik referans çizgilerini aşağıya doğru tamamla (kağıdın altı kesilmişse diye)
      if (timingMarks.length > 5) {
          const lastMark = timingMarks[timingMarks.length - 1];
          // Eğim bilgisiyle X'i de doğru konumda tamamla
          const skew = calculateLinearRegression(timingMarks);
          let currentY = lastMark.y + medianGap;
          while (currentY < img.height - (medianGap * 0.5)) {
              const extraX = skew.intercept + skew.slope * currentY;
              timingMarks.push({ x: extraX, y: currentY });
              currentY += medianGap;
          }
      }

      const globalSkew = calculateLinearRegression(timingMarks);

      // Parabolik/eğri kağıt bükülmelerini düzeltmek için düz çizgi (Linear Regression) yerine
      // "Moving Average" (Hareketli Ortalama) kullanarak çizgiyi kağıdın şekline göre kıvırıyoruz.
      const smoothedMarks = timingMarks.map((m, i, arr) => {
          let sumX = 0;
          let count = 0;
          for (let j = Math.max(0, i - 2); j <= Math.min(arr.length - 1, i + 2); j++) {
              sumX += arr[j].x;
              count++;
          }
          return { x: sumX / count, y: m.y };
      });
      
      // ─── DEBUG ÇİZİMLERİ ───
      const horizontalSlope = -globalSkew.slope;
      
      // 1. Mavi noktalar (referans çizgileri)
      ctx.fillStyle = 'blue';
      for (let i = 0; i < smoothedMarks.length; i++) {
          const m = smoothedMarks[i];
          ctx.beginPath(); ctx.arc(m.x, m.y, 5, 0, 2*Math.PI); ctx.fill();
          // İndeks numarasını yaz
          ctx.fillStyle = 'yellow';
          ctx.font = '10px monospace';
          ctx.fillText(`${i}`, m.x + 8, m.y + 3);
          ctx.fillStyle = 'blue';
      }
      
      // 2. Yeşil çizgi: Timing marklarının eğimli yolunu göster
      if (smoothedMarks.length >= 2) {
          ctx.strokeStyle = 'lime';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(smoothedMarks[0].x, smoothedMarks[0].y);
          for (let i = 1; i < smoothedMarks.length; i++) {
              ctx.lineTo(smoothedMarks[i].x, smoothedMarks[i].y);
          }
          ctx.stroke();
      }
      
      // 3. Her referans çizgisi için soldan sağa eğimli yatay rehber çizgisi (turuncu, ince)
      ctx.strokeStyle = 'rgba(255, 165, 0, 0.3)';
      ctx.lineWidth = 1;
      for (const m of smoothedMarks) {
          ctx.beginPath();
          const leftY = m.y + (0 - m.x) * horizontalSlope;
          const rightY = m.y + (img.width - m.x) * horizontalSlope;
          ctx.moveTo(0, leftY);
          ctx.lineTo(img.width, rightY);
          ctx.stroke();
      }

      ctx.strokeStyle = 'red';
      ctx.lineWidth = 2;
      
      for (const category of layout.categories) {
        const catResult: OMRResult = {
          categoryName: category.categoryName,
          questions: []
        };
        
        for (const block of category.blocks) {
          const numRows = block.endQuestion - block.startQuestion + 1;
          const roughCenterX = (block.columnXCenter / 1000) * img.width;
          const nominalBubbleSize = Math.min(medianGap * 0.7, img.width * 0.03);
          
          let startIdxGuess = 0;
          const align = block.verticalAlignment || "bottom";
          if (align === "bottom") {
              startIdxGuess = Math.max(0, smoothedMarks.length - numRows);
          } else if (align === "top") {
              startIdxGuess = 0;
          } else {
              startIdxGuess = Math.max(0, Math.floor((smoothedMarks.length - numRows) / 2));
          }

          // 2D Comb Filter (Tarak Filtresi) ile 5 şıklı (A-E) ızgaranın TAM Merkezini (X ve Y) buluyoruz.
          // Sadece 1 siyah noktaya atlamasını (snap) engelleyip, 5 basılı çemberin 'desenini' arıyoruz!
          let bestScore = -999999;
          let bestStartIdx = startIdxGuess;
          let bestCenterX = roughCenterX;
          
          // Y ekseninde LLM tahmininin biraz altı/üstü (eksik marklar olabilir diye +- 4 satır arıyoruz)
          const searchYRange = 4; 
          for (let testIdx = Math.max(0, startIdxGuess - searchYRange); testIdx <= Math.min(smoothedMarks.length - numRows, startIdxGuess + searchYRange); testIdx++) {
              let maxRowScore = -999999;
              let bestXForThisIdx = roughCenterX;
              
              // X ekseninde LLM tahmininin biraz sağı/solu (kağıt genişliğinin %5'i kadar)
              const searchRad = Math.floor(img.width * 0.05);
              for (let xOffset = -searchRad; xOffset <= searchRad; xOffset += 2) {
                  const testCenterX = roughCenterX + xOffset;
                  let hypothesisScore = 0;
                  
                  // Skoru hesaplamak için sadece bloğun ilk 3 satırına bakıyoruz (hız için)
                  const rowsToTest = Math.min(3, numRows);
                  for (let r = 0; r < rowsToTest; r++) {
                      const mark = smoothedMarks[testIdx + r];
                      if (!mark) continue;
                      const rowY = mark.y + (testCenterX - mark.x) * horizontalSlope;
                      
                      // 5 şıkkın (A, B, C, D, E) karanlığını topla (Comb Filter)
                      // A şıkkı: merkezden -2 gap, B: -1 gap, C: 0, D: +1 gap, E: +2 gap
                      for (let col = -2; col <= 2; col++) {
                          const bX = testCenterX + col * medianGap - (nominalBubbleSize / 2);
                          const bY = rowY - (nominalBubbleSize / 2);
                          hypothesisScore += getAverageDarkness(imageData, bX, bY, nominalBubbleSize, nominalBubbleSize);
                      }
                  }
                  
                  // Uzaklık cezası: LLM'den çok uzaklaşmasını engelle
                  hypothesisScore -= Math.abs(xOffset) * 1.5; 
                  
                  if (hypothesisScore > maxRowScore) {
                      maxRowScore = hypothesisScore;
                      bestXForThisIdx = testCenterX;
                  }
              }
              
              // Bu 'startIndex' varsayımı diğer 'startIndex' varsayımlarından daha mı iyi?
              // Y ekseninde LLM'in (veya matematiksel hesabın) tahmininden uzaklaştıkça ceza uygula
              const yPenalty = Math.abs(testIdx - startIdxGuess) * 50; 
              if (maxRowScore - yPenalty > bestScore) {
                  bestScore = maxRowScore - yPenalty;
                  bestStartIdx = testIdx;
                  bestCenterX = bestXForThisIdx;
              }
          }
          
          const trueCenterX = bestCenterX;
          const trueStartIndex = bestStartIdx;
          
          // Izgarayı çiz
          for (let row = 0; row < numRows; row++) {
            const markIdx = trueStartIndex + row;
            if (markIdx >= smoothedMarks.length) break;
            
            const questionNum = block.startQuestion + row;
            const currentMark = smoothedMarks[markIdx];
            // Merkez (C şıkkı) ile referans çizgisi arasındaki yatay mesafe
            const dxCenterFromMark = trueCenterX - currentMark.x; 
            const centerCellY = currentMark.y + (dxCenterFromMark * horizontalSlope);
            
            const darknessScores = [];
            
            for (let col = 0; col < 5; col++) {
              // C şıkkı (col = 2) merkezdir. col=0 -> -2 gap, col=4 -> +2 gap
              const cellXCenter = trueCenterX + (col - 2) * medianGap;
              // X ekseninde sağa-sola gittikçe kağıt eğimine göre Y ekseninde kaydır
              const cellYCenter = centerCellY + ((col - 2) * medianGap * horizontalSlope);
              
              const boxX = cellXCenter - (nominalBubbleSize / 2);
              const boxY = cellYCenter - (nominalBubbleSize / 2);
              
              ctx.strokeRect(boxX, boxY, nominalBubbleSize, nominalBubbleSize);
              
              const darkness = getAverageDarkness(imageData, boxX, boxY, nominalBubbleSize, nominalBubbleSize);
              darknessScores.push({ option: options[col], score: darkness });
            }
            
            // Analyze the scores
            const sorted = [...darknessScores].sort((a, b) => b.score - a.score);
            const darkest = sorted[0];
            const secondDarkest = sorted[1];
            
            let sumOthers = 0;
            for (let i = 1; i < 5; i++) {
              sumOthers += sorted[i].score;
            }
            const avgOther = sumOthers / 4;
            
            let selectedOption = null;
            if (darkest.score > 25 && darkest.score > avgOther * 1.6) {
              if (secondDarkest.score > darkest.score * 0.8 && secondDarkest.score > 35) {
                  selectedOption = 'X';
              } else {
                  selectedOption = darkest.option;
              }
            }
            
            catResult.questions.push({
              questionNumber: questionNum,
              answer: selectedOption
            });
          }
        }
        
        // Sort questions by number just in case blocks were out of order
        catResult.questions.sort((a, b) => a.questionNumber - b.questionNumber);
        results.push(catResult);
      }
      
      const debugImageBase64 = canvas.toDataURL('image/jpeg', 0.8);
      resolve({ data: results, debugImageBase64 });
    };
    
    img.onerror = (err) => reject(err);
    img.src = base64Data; // base64Data should include the data URI prefix (data:image/jpeg;base64,...)
  });
}

export function gradeOMR(answerKeyData: OMRResult[], studentData: OMRResult[]) {
  let totalCorrect = 0;
  let totalIncorrect = 0;
  let totalBlank = 0;
  const resultCategories = [];

  const akCategories = answerKeyData || [];
  const stCategories = studentData || [];

  for (let i = 0; i < akCategories.length; i++) {
    const akCategory = akCategories[i];
    const stCategory = stCategories[i] || { categoryName: '', questions: [] };
    
    let categoryCorrect = 0;
    let categoryIncorrect = 0;
    let categoryBlank = 0;
    const questionsResult = [];

    const stAnswersMap = new Map<number, string | null>();
    (stCategory.questions || []).forEach((q) => {
      stAnswersMap.set(q.questionNumber, q.answer);
    });

    for (const akQuestion of (akCategory.questions || [])) {
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
        correctAnswer: correctAns || '',
        status: status
      });
    }

    totalCorrect += categoryCorrect;
    totalIncorrect += categoryIncorrect;
    totalBlank += categoryBlank;

    resultCategories.push({
      categoryName: akCategory.categoryName || `Kategori ${i+1}`,
      categoryCorrect,
      categoryIncorrect,
      categoryBlank,
      questions: questionsResult
    });
  }

  return {
    totalCorrect,
    totalIncorrect,
    totalBlank,
    categories: resultCategories
  };
}
