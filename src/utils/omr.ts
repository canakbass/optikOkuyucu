export interface BlockMap {
  startQuestion: number;
  endQuestion: number;
  columnLeftX: number;
  columnRightX: number;
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
  
  // 1. Dikey geçişleri (aydınlıktan karanlığa) sayarak optik formun sol kenarındaki hizalama çizgisini bulalım.
  // Karanlık bir masa arka planı geçiş yaratmaz, sadece kağıt üzerindeki çizgiler geçiş yaratır.
  const searchWidth = Math.floor(width * 0.3);
  const transitionScores = new Int32Array(searchWidth);
  
  for (let x = 0; x < searchWidth; x++) {
      let transitions = 0;
      let wasDark = false;
      for (let y = Math.floor(height * 0.05); y < height * 0.95; y += 3) {
          const idx = (y * width + x) * 4;
          const r = imageData.data[idx];
          const g = imageData.data[idx+1];
          const b = imageData.data[idx+2];
          const brightness = (r + g + b) / 3;
          
          const isDark = brightness < 120;
          if (isDark !== wasDark) {
              transitions++;
              wasDark = isDark;
          }
      }
      transitionScores[x] = transitions;
  }
  
  // En çok geçiş (siyah-beyaz değişimi) olan X sütununu bulalım
  let bestX = 0;
  let maxScore = 0;
  for (let x = 0; x < searchWidth; x++) {
      if (transitionScores[x] > maxScore) {
          maxScore = transitionScores[x];
          bestX = x;
      }
  }
  
  if (maxScore < 10) return []; // Çizgi bulunamadı
  
  // 2. Bulduğumuz X sütununun etrafında dar bir şeritte tarama yapıp tam Y merkezlerini bulalım
  const stripWidth = Math.floor(width * 0.02);
  const startX = Math.max(0, bestX - stripWidth);
  const endX = Math.min(width, bestX + stripWidth);
  
  const verticalProfile = new Float32Array(height);
  for (let y = 0; y < height; y++) {
      let darkCount = 0;
      for (let x = startX; x <= endX; x++) {
          const idx = (y * width + x) * 4;
          const r = imageData.data[idx];
          const g = imageData.data[idx+1];
          const b = imageData.data[idx+2];
          if (((r + g + b) / 3) < 120) darkCount++;
      }
      verticalProfile[y] = darkCount;
  }
  
  const marks: Point[] = [];
  const threshold = (endX - startX) * 0.3; 
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
          // Çok ince gürültüleri veya çok kalın blokları (örn. masa kenarı) ele
          if (markHeight >= 2 && markHeight < height * 0.05) {
              const centerY = Math.floor((peakStartY + peakEndY) / 2);
              
              // Sadece bestX demek yerine, bu spesifik çizginin kendi X merkezini bulalım
              // Böylece kağıt bükülmüşse (sol kenar eğimliyse) çizgiler dimdik inmez, kağıdın kenarını kavisli takip eder!
              let sumX = 0;
              let countX = 0;
              for (let markY = peakStartY; markY <= peakEndY; markY++) {
                  for (let markX = startX; markX <= endX; markX++) {
                      const idx = (markY * width + markX) * 4;
                      const r = imageData.data[idx];
                      const g = imageData.data[idx+1];
                      const b = imageData.data[idx+2];
                      if (((r + g + b) / 3) < 120) {
                          sumX += markX;
                          countX++;
                      }
                  }
              }
              const actualX = countX > 0 ? (sumX / countX) : bestX;
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

// Helper to snap to the darkest horizontal center (X center) using the full bubble area
function snapToDarkestX(imageData: ImageData, guessX: number, yCenter: number, boxSize: number, searchRadius: number): number {
  let bestX = guessX;
  let maxScore = -999999; // Artık negatif skorlar olabilir
  
  for (let xOffset = -searchRadius; xOffset <= searchRadius; xOffset++) {
    const testX = Math.floor(guessX + xOffset);
    const boxX = testX - (boxSize / 2);
    const boxY = yCenter - (boxSize / 2);
    
    const darkness = getAverageDarkness(imageData, boxX, boxY, boxSize, boxSize);
    
    // Uzaklık cezası: LLM'in tahmininden ne kadar uzaklaşırsak, skor o kadar düşer.
    // Bu sayede yan sütuna veya yanlışlıkla karalanmış yoğun siyah şıkka atlamasını engelleriz.
    const distancePenalty = Math.abs(xOffset) * 2.0; // Her 1 piksel uzaklık 2.0 puan ceza
    const score = darkness - distancePenalty;
    
    if (score > maxScore) {
      maxScore = score;
      bestX = testX;
    }
  }
  return bestX;
}

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
      
      ctx.fillStyle = 'blue';
      for (const m of smoothedMarks) {
          ctx.beginPath(); ctx.arc(m.x, m.y, 5, 0, 2*Math.PI); ctx.fill();
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
          const roughLeftX = (block.columnLeftX / 1000) * img.width;
          const roughRightX = (block.columnRightX / 1000) * img.width;
          
          const horizontalSlope = -globalSkew.slope;
          let startIndex = 0;

          if (smoothedMarks.length >= numRows) {
              // 1. Her bir referans çizgisi için o satırın 'Soru Satırı' olma ihtimalini (koyuluk skoru) hesapla
              const rowScores = new Float32Array(smoothedMarks.length);
              
              const stripHeight = Math.max(2, Math.floor(medianGap * 0.4));
              const stepX = Math.max(1, Math.floor((roughRightX - roughLeftX) / 20)); // Hız için 20 noktada örneklem
              
              for (let i = 0; i < smoothedMarks.length; i++) {
                  const mark = smoothedMarks[i];
                  let totalDarkness = 0;
                  let samples = 0;
                  
                  for (let sx = roughLeftX; sx <= roughRightX; sx += stepX) {
                      const sy = mark.y + (sx - mark.x) * horizontalSlope;
                      const startY = Math.floor(sy - stripHeight/2);
                      const endY = Math.floor(sy + stripHeight/2);
                      
                      for (let y = startY; y <= endY; y += 2) {
                          const idx = (y * img.width + Math.floor(sx)) * 4;
                          const r = imageData.data[idx];
                          const g = imageData.data[idx+1];
                          const b = imageData.data[idx+2];
                          if (r !== undefined) {
                              const darkness = 255 - (0.299 * r + 0.587 * g + 0.114 * b);
                              totalDarkness += darkness;
                              samples++;
                          }
                      }
                  }
                  rowScores[i] = samples > 0 ? (totalDarkness / samples) : 0;
              }
              
              // 2. Kayan Pencere (Sliding Window) ile en yüksek skora sahip bloğu bul
              let bestScore = -1;
              for (let start = 0; start <= smoothedMarks.length - numRows; start++) {
                  let windowScore = 0;
                  for (let j = 0; j < numRows; j++) {
                      windowScore += rowScores[start + j];
                  }
                  if (windowScore > bestScore) {
                      bestScore = windowScore;
                      startIndex = start;
                  }
              }
          }
          
          const firstMark = smoothedMarks[startIndex] || { x: 0, y: 0 };
          const nominalBubbleSize = Math.min(medianGap * 0.7, img.width * 0.03);
          
          // LLM'in verdiği kaba kutuyu kullanarak ilk satırın Y kaymasını hesaplıyoruz
          const leftGuessY = firstMark.y + (roughLeftX - firstMark.x) * horizontalSlope;
          const rightGuessY = firstMark.y + (roughRightX - firstMark.x) * horizontalSlope;
          
          // LLM'in koordinatları %5-10 hatalı olabilir, searchRadius'u geniş tutuyoruz (kağıt genişliğinin %5'i kadar)
          const searchRad = Math.floor(img.width * 0.05); 
          
          const trueLeftX_row0 = snapToDarkestX(imageData, roughLeftX, leftGuessY, nominalBubbleSize, searchRad);
          const trueRightX_row0 = snapToDarkestX(imageData, roughRightX, rightGuessY, nominalBubbleSize, searchRad);
          
          // Sol kenardaki referans çizgimize olan uzaklık sabit kalmalıdır (kağıt bükülse bile!)
          const offsetLeft = trueLeftX_row0 - firstMark.x;
          const offsetRight = trueRightX_row0 - firstMark.x;

          for (let row = 0; row < numRows; row++) {
            const markIndex = startIndex + row;
            if (markIndex >= smoothedMarks.length) break;
            
            const questionNum = block.startQuestion + row;
            const currentMark = smoothedMarks[markIndex];
            
            // Satırın X merkezleri, referans çizgisinin o satırdaki bükülmüş konumuna offset eklenerek bulunur
            const rowLeftX = currentMark.x + offsetLeft;
            const rowRightX = currentMark.x + offsetRight;
            
            const darknessScores = [];
            
            for (let col = 0; col < 5; col++) {
              const cRatio = (col + 1) / 5;
              const cellXCenter = rowLeftX + (rowRightX - rowLeftX) * cRatio;
              
              // X ekseninde ne kadar sağa gittiysek, Y ekseninde o kadar eğimle inip çıkmalıyız!
              const dxFromMark = cellXCenter - currentMark.x;
              const cellYCenter = currentMark.y + (dxFromMark * horizontalSlope);
              
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
