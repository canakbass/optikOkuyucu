export interface BlockMap {
  startQuestion: number;
  endQuestion: number;
  columnXCenter: number;
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
  
  // We only care about the left 15% of the page
  const searchWidth = Math.floor(width * 0.15);
  
  // 1. Create a vertical profile of darkness
  const verticalProfile = new Float32Array(height);
  for (let y = 0; y < height; y++) {
      let maxDarkness = 0;
      for (let x = 0; x < searchWidth; x++) {
          const idx = (y * width + x) * 4;
          const r = imageData.data[idx];
          const g = imageData.data[idx + 1];
          const b = imageData.data[idx + 2];
          const darkness = 255 - (0.299 * r + 0.587 * g + 0.114 * b);
          
          if (darkness > maxDarkness) maxDarkness = darkness;
      }
      verticalProfile[y] = maxDarkness;
  }
  
  // Smooth the profile
  const smoothed = new Float32Array(height);
  for (let y = 2; y < height - 2; y++) {
      smoothed[y] = (verticalProfile[y-2] + verticalProfile[y-1]*2 + verticalProfile[y]*3 + verticalProfile[y+1]*2 + verticalProfile[y+2]) / 9;
  }
  
  // Find peaks
  const marks: Point[] = [];
  const threshold = 160; // out of 255
  let inPeak = false;
  let peakStartY = 0;
  
  for (let y = 0; y < height; y++) {
      if (smoothed[y] > threshold && !inPeak) {
          inPeak = true;
          peakStartY = y;
      } else if (smoothed[y] <= threshold && inPeak) {
          inPeak = false;
          const peakEndY = y;
          const center_Y = Math.floor((peakStartY + peakEndY) / 2);
          
          // Find X center
          let sumX = 0;
          let countX = 0;
          for (let x = 0; x < searchWidth; x++) {
              const idx = (center_Y * width + x) * 4;
              const r = imageData.data[idx];
              const g = imageData.data[idx + 1];
              const b = imageData.data[idx + 2];
              const darkness = 255 - (0.299 * r + 0.587 * g + 0.114 * b);
              if (darkness > threshold) {
                  sumX += x;
                  countX++;
              }
          }
          if (countX > 0) {
              marks.push({ x: sumX / countX, y: center_Y });
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
  let maxDarkness = -1;
  
  for (let xOffset = -searchRadius; xOffset <= searchRadius; xOffset++) {
    const testX = Math.floor(guessX + xOffset);
    const boxX = testX - (boxSize / 2);
    const boxY = yCenter - (boxSize / 2);
    const score = getAverageDarkness(imageData, boxX, boxY, boxSize, boxSize);
    
    if (score > maxDarkness) {
      maxDarkness = score;
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
          const fakeGap = img.height / 35; // Varsayılan 30-35 soru boşluğu
          for (let i = 0; i < 40; i++) {
              timingMarks.push({ x: img.width * 0.05, y: (img.height * 0.1) + (i * fakeGap) });
          }
          medianGap = fakeGap;
      }

      const globalSkew = calculateLinearRegression(timingMarks);
      
      ctx.fillStyle = 'blue';
      for (const m of timingMarks) {
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
          const roughCenterX = (block.columnXCenter / 1000) * img.width;
          
          // Sütunun tam genişliğini (Number'dan E'ye) ilk satırda bulalım
          const firstRowY = timingMarks[0]?.y || (img.height * 0.2);
          const nominalBubbleSize = Math.min(medianGap * 0.7, img.width * 0.03);
          
          // Rough centerX'den sola gidip soru numarasını, sağa gidip E şıkkını bul
          const trueLeftX = snapToDarkestX(imageData, roughCenterX - (medianGap * 2.5), firstRowY, nominalBubbleSize, 50);
          const trueRightX = snapToDarkestX(imageData, roughCenterX + (medianGap * 2.5), firstRowY, nominalBubbleSize, 50);
          
          const columnWidth = trueRightX - trueLeftX;

          for (let row = 0; row < numRows; row++) {
            if (row >= timingMarks.length) break; // Kağıtta yeterli satır yoksa dur
            
            const questionNum = block.startQuestion + row;
            const yCenter = timingMarks[row].y;
            
            // Timing mark'ın eğimine göre bu satırdaki X merkezleri
            const rowLeftX = globalSkew.slope * yCenter + trueLeftX - (globalSkew.slope * firstRowY);
            const rowRightX = rowLeftX + columnWidth;
            
            const darknessScores = [];
            
            for (let col = 0; col < 5; col++) {
              const cRatio = (col + 1) / 5;
              const cellXCenter = rowLeftX + (rowRightX - rowLeftX) * cRatio;
              
              const boxX = cellXCenter - (nominalBubbleSize / 2);
              const boxY = yCenter - (nominalBubbleSize / 2);
              
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
