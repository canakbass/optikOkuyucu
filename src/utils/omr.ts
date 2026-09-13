export interface BlockMap {
  startQuestion: number;
  endQuestion: number;
  topRow: {
    yCenter: number;
    numberXCenter: number;
    optionEXCenter: number;
  };
  bottomRow: {
    yCenter: number;
    numberXCenter: number;
    optionEXCenter: number;
  };
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

function getAverageDarkness(imageData: ImageData, startX: number, startY: number, width: number, height: number): number {
  let totalDarkness = 0;
  let count = 0;
  
  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      const px = startX + dx;
      const py = startY + dy;
      
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
    const score = getAverageDarkness(imageData, Math.floor(boxX), Math.floor(boxY), Math.floor(boxSize), Math.floor(boxSize));
    
    if (score > maxDarkness) {
      maxDarkness = score;
      bestX = testX;
    }
  }
  return bestX;
}

// Linear Regression: y = mx + b (but here we map Y to X to predict X based on Y)
function calculateLinearRegression(points: { x: number, y: number }[]): { slope: number, intercept: number } {
  let sumY = 0, sumX = 0, sumYY = 0, sumYX = 0;
  const n = points.length;
  
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
      
      ctx.strokeStyle = 'red';
      ctx.lineWidth = 2;
      
      for (const category of layout.categories) {
        const catResult: OMRResult = {
          categoryName: category.categoryName,
          questions: []
        };
        
        for (const block of category.blocks) {
          const numRows = block.endQuestion - block.startQuestion + 1;
          
          // 1. Get the rough boundaries from LLM
          const rawTopY = (block.topRow.yCenter / 1000) * img.height;
          const rawBottomY = (block.bottomRow.yCenter / 1000) * img.height;
          const rawTopLeftX = (block.topRow.numberXCenter / 1000) * img.width;
          const rawTopRightX = (block.topRow.optionEXCenter / 1000) * img.width;
          
          const nominalRowHeightPx = numRows > 1 ? (rawBottomY - rawTopY) / (numRows - 1) : 0;
          const bubbleSize = nominalRowHeightPx * 0.70;
          
          // 2. Snap the Top Row tightly
          const trueTopLeftX = snapToDarkestX(imageData, rawTopLeftX, rawTopY, bubbleSize, 30);
          const trueTopRightX = snapToDarkestX(imageData, rawTopRightX, rawTopY, bubbleSize, 30);
          
          // 3. Trace rows downwards to find the true skew line (Linear Regression)
          const leftPoints = [];
          const rightPoints = [];
          
          let currentLeftX = trueTopLeftX;
          let currentRightX = trueTopRightX;
          
          for (let row = 0; row < numRows; row++) {
            const progress = numRows > 1 ? row / (numRows - 1) : 0;
            const yCenter = rawTopY + progress * (rawBottomY - rawTopY);
            
            // Search strictly +/- 5 pixels from previous row to prevent jumping!
            currentLeftX = snapToDarkestX(imageData, currentLeftX, yCenter, bubbleSize, 5);
            currentRightX = snapToDarkestX(imageData, currentRightX, yCenter, bubbleSize, 5);
            
            leftPoints.push({ x: currentLeftX, y: yCenter });
            rightPoints.push({ x: currentRightX, y: yCenter });
          }
          
          // Fit straight line to eliminate S-curves
          const leftLine = calculateLinearRegression(leftPoints);
          const rightLine = calculateLinearRegression(rightPoints);
          
          // Calculate perfect bottom coordinates from the mathematical line
          const trueBottomLeftX = leftLine.slope * rawBottomY + leftLine.intercept;
          const trueBottomRightX = rightLine.slope * rawBottomY + rightLine.intercept;
          
          // Debug: Draw Mathematical Skew Lines
          ctx.strokeStyle = 'yellow';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(trueTopLeftX, rawTopY);
          ctx.lineTo(trueBottomLeftX, rawBottomY);
          ctx.stroke();
          
          ctx.beginPath();
          ctx.moveTo(trueTopRightX, rawTopY);
          ctx.lineTo(trueBottomRightX, rawBottomY);
          ctx.stroke();
          
          // Restore red for the grid
          ctx.strokeStyle = 'red';
          ctx.lineWidth = 2;
          
          // 4. Interpolate and parse every row
          for (let row = 0; row < numRows; row++) {
            const questionNum = block.startQuestion + row;
            const progress = numRows > 1 ? row / (numRows - 1) : 0;
            const yCenter = rawTopY + progress * (rawBottomY - rawTopY);
            
            // Use the perfectly straight regression line for X bounds
            const rowLeftX = leftLine.slope * yCenter + leftLine.intercept;
            const rowRightX = rightLine.slope * yCenter + rightLine.intercept;
            
            const darknessScores = [];
            
            for (let col = 0; col < 5; col++) {
              const cRatio = (col + 1) / 5;
              const cellXCenter = rowLeftX + (rowRightX - rowLeftX) * cRatio;
              
              const boxX = cellXCenter - (bubbleSize / 2);
              const boxY = yCenter - (bubbleSize / 2);
              
              ctx.strokeRect(boxX, boxY, bubbleSize, bubbleSize);
              
              const darkness = getAverageDarkness(imageData, Math.floor(boxX), Math.floor(boxY), Math.floor(bubbleSize), Math.floor(bubbleSize));
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
