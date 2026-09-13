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
  
  const x1 = startX;
  const x2 = startX + width;
  const y1 = startY;
  const y2 = startY + height;
  
  const data = imageData.data;
  const imgWidth = imageData.width;
  
  for (let y = y1; y < y2; y++) {
    for (let x = x1; x < x2; x++) {
      if (x < 0 || x >= imgWidth || y < 0 || y >= imageData.height) continue;
      
      const idx = (y * imgWidth + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      totalDarkness += (255 - luminance);
      count++;
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
          
          // 1. Trust Gemini for the Y boundaries (Eliminates border-snapping vertical shifts)
          const roughTopY = (block.topRow.yCenter / 1000) * img.height;
          const roughBottomY = (block.bottomRow.yCenter / 1000) * img.height;
          const trueTopY = roughTopY;
          const trueBottomY = roughBottomY;
          
          const nominalRowHeightPx = numRows > 1 ? (trueBottomY - trueTopY) / (numRows - 1) : 0;
          const bubbleSize = nominalRowHeightPx * 0.70;
          
          // 2. Extract Gemini's X boundaries
          const roughLeftXTop = (block.topRow.numberXCenter / 1000) * img.width;
          const roughRightXTop = (block.topRow.optionEXCenter / 1000) * img.width;
          const roughLeftXBottom = (block.bottomRow.numberXCenter / 1000) * img.width;
          const roughRightXBottom = (block.bottomRow.optionEXCenter / 1000) * img.width;
          const colWidth = (roughRightXTop - roughLeftXTop) / 5;
          
          // 3. Trust Gemini for the Top X corners, just micro-snap to center perfectly on the ink
          const trueTopLeftX = snapToDarkestX(imageData, roughLeftXTop, trueTopY, bubbleSize, colWidth * 0.3);
          const trueTopRightX = snapToDarkestX(imageData, roughRightXTop, trueTopY, bubbleSize, colWidth * 0.3);
          
          // 4. PATHFINDER ALGORITHM: Track the X columns row-by-row to the bottom
          // This completely ignores Gemini's hallucinated bottom X coordinates and perfectly traces the physical skew!
          let currentLeftX = trueTopLeftX;
          let currentRightX = trueTopRightX;
          
          for (let row = 1; row < numRows; row++) {
            const y = trueTopY + row * nominalRowHeightPx;
            // Small search radius because the skew between a single row is tiny (1-2 pixels)
            // This guarantees we never derail into adjacent columns.
            const traceSearchRadius = Math.max(3, colWidth * 0.2); 
            
            currentLeftX = snapToDarkestX(imageData, currentLeftX, y, bubbleSize, traceSearchRadius);
            currentRightX = snapToDarkestX(imageData, currentRightX, y, bubbleSize, traceSearchRadius);
          }
          
          // We have reached the bottom! These are the flawless visual bottom corners.
          const trueBottomLeftX = currentLeftX;
          const trueBottomRightX = currentRightX;
          
          // Debug: Draw LLM (Gemini) Rough Corners as BLUE dots
          ctx.fillStyle = 'blue';
          const r = 8;
          ctx.beginPath(); ctx.arc(roughLeftXTop, roughTopY, r, 0, 2 * Math.PI); ctx.fill();
          ctx.beginPath(); ctx.arc(roughRightXTop, roughTopY, r, 0, 2 * Math.PI); ctx.fill();
          ctx.beginPath(); ctx.arc(roughLeftXBottom, roughBottomY, r, 0, 2 * Math.PI); ctx.fill();
          ctx.beginPath(); ctx.arc(roughRightXBottom, roughBottomY, r, 0, 2 * Math.PI); ctx.fill();

          // Debug: Draw CV Snapped True Corners as GREEN dots
          ctx.fillStyle = 'green';
          ctx.beginPath(); ctx.arc(trueTopLeftX, trueTopY, r, 0, 2 * Math.PI); ctx.fill();
          ctx.beginPath(); ctx.arc(trueTopRightX, trueTopY, r, 0, 2 * Math.PI); ctx.fill();
          ctx.beginPath(); ctx.arc(trueBottomLeftX, trueBottomY, r, 0, 2 * Math.PI); ctx.fill();
          ctx.beginPath(); ctx.arc(trueBottomRightX, trueBottomY, r, 0, 2 * Math.PI); ctx.fill();
          
          // Phase 3: Rigid Bilinear Interpolation (Absolutely NO mid-row snapping, NO S-curves)
          for (let row = 0; row < numRows; row++) {
            const questionNum = block.startQuestion + row;
            const rRatio = numRows > 1 ? row / (numRows - 1) : 0;
            
            // Perfect straight-line Y for this row
            const rowY = trueTopY + (trueBottomY - trueTopY) * rRatio;
            
            // Perfect straight-line X bounds for this row
            const leftX = trueTopLeftX + (trueBottomLeftX - trueTopLeftX) * rRatio;
            const rightX = trueTopRightX + (trueBottomRightX - trueTopRightX) * rRatio;
            
            const darknessScores = [];
            
            for (let col = 0; col < 5; col++) {
              const cRatio = (col + 1) / 5; // col 0 is A, 1/5th distance from Number to E
              const cellXCenter = leftX + (rightX - leftX) * cRatio;
              
              const boxX = cellXCenter - (bubbleSize / 2);
              const boxY = rowY - (bubbleSize / 2);
              
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
            const avgOthers = sumOthers / 4;
            
            let markedOption = null;
            
            // To be considered marked, the darkest bubble must be distinctly darker than the average of others
            if (darkest.score > avgOthers + 8) {
              // Check if it's distinctly the darkest (to catch double-marks where two are very dark)
              if (darkest.score > secondDarkest.score + 5) {
                markedOption = darkest.option;
              }
            }
            
            catResult.questions.push({
              questionNumber: questionNum,
              answer: markedOption
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
