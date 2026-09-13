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

// Helper to snap to the darkest horizontal row (Y center)
function snapToRowY(imageData: ImageData, startX: number, endX: number, guessY: number, searchRadius: number): number {
  let bestY = guessY;
  let maxDarkness = -1;
  const stripHeight = 3;
  
  for (let yOffset = -searchRadius; yOffset <= searchRadius; yOffset++) {
    const testY = Math.floor(guessY + yOffset);
    let stripDarkness = 0;
    
    for (let sy = 0; sy < stripHeight; sy++) {
      const currentY = testY + sy;
      if (currentY < 0 || currentY >= imageData.height) continue;
      
      for (let x = Math.floor(startX); x < Math.floor(endX); x++) {
        if (x < 0 || x >= imageData.width) continue;
        const idx = (currentY * imageData.width + x) * 4;
        const r = imageData.data[idx];
        const g = imageData.data[idx+1];
        const b = imageData.data[idx+2];
        stripDarkness += 255 - (0.299 * r + 0.587 * g + 0.114 * b);
      }
    }
    
    if (stripDarkness > maxDarkness) {
      maxDarkness = stripDarkness;
      bestY = testY + (stripHeight / 2);
    }
  }
  return bestY;
}

// Helper to snap to the darkest vertical column (X center)
function snapToDarkestX(imageData: ImageData, guessX: number, yCenter: number, height: number, searchRadius: number): number {
  let bestX = guessX;
  let maxDarkness = -1;
  const stripWidth = 4;
  
  for (let xOffset = -searchRadius; xOffset <= searchRadius; xOffset++) {
    const testX = Math.floor(guessX + xOffset);
    let colDarkness = 0;
    
    for (let sx = 0; sx < stripWidth; sx++) {
      const currentX = testX + sx;
      if (currentX < 0 || currentX >= imageData.width) continue;
      
      for (let y = Math.floor(yCenter - height/2); y <= Math.floor(yCenter + height/2); y++) {
        if (y < 0 || y >= imageData.height) continue;
        const idx = (y * imageData.width + currentX) * 4;
        const r = imageData.data[idx];
        const g = imageData.data[idx+1];
        const b = imageData.data[idx+2];
        colDarkness += 255 - (0.299 * r + 0.587 * g + 0.114 * b);
      }
    }
    
    if (colDarkness > maxDarkness) {
      maxDarkness = colDarkness;
      bestX = testX + (stripWidth / 2);
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
          
          const roughTopY = (block.topRow.yCenter / 1000) * img.height;
          const roughBottomY = (block.bottomRow.yCenter / 1000) * img.height;
          const roughLeftXTop = (block.topRow.numberXCenter / 1000) * img.width;
          const roughRightXTop = (block.topRow.optionEXCenter / 1000) * img.width;
          const roughLeftXBottom = (block.bottomRow.numberXCenter / 1000) * img.width;
          const roughRightXBottom = (block.bottomRow.optionEXCenter / 1000) * img.width;
          
          const totalYSpacePx = roughBottomY - roughTopY;
          const nominalRowHeightPx = numRows > 1 ? totalYSpacePx / (numRows - 1) : totalYSpacePx;
          const bubbleSize = nominalRowHeightPx * 0.70;
          
          // Phase 1: Find EXACT Top and Bottom Y centers by snapping ONLY the first and last rows
          // This eliminates LLM inaccuracy and fixes the "accumulating sag" without causing S-curves.
          const ySearchRadius = nominalRowHeightPx * 0.8; // Generous search to correct Gemini
          const boundsLeftXTop = roughLeftXTop - bubbleSize;
          const boundsRightXTop = roughRightXTop + bubbleSize;
          const boundsLeftXBottom = roughLeftXBottom - bubbleSize;
          const boundsRightXBottom = roughRightXBottom + bubbleSize;
          
          const trueTopY = snapToRowY(imageData, boundsLeftXTop, boundsRightXTop, roughTopY, ySearchRadius);
          const trueBottomY = snapToRowY(imageData, boundsLeftXBottom, boundsRightXBottom, roughBottomY, ySearchRadius);
          
          // Phase 2: Find EXACT Geometric X corners by snapping ONLY the 4 corners
          // This perfectly detects skew (yamukluk) while ignoring Gemini's orthogonal boxes.
          const colWidth = (roughRightXTop - roughLeftXTop) / 5;
          const xSearchRadius = colWidth * 0.5; // Allow shifting up to half a column to find the true peak
          
          const trueTopLeftX = snapToDarkestX(imageData, roughLeftXTop, trueTopY, bubbleSize, xSearchRadius);
          const trueTopRightX = snapToDarkestX(imageData, roughRightXTop, trueTopY, bubbleSize, xSearchRadius);
          const trueBottomLeftX = snapToDarkestX(imageData, roughLeftXBottom, trueBottomY, bubbleSize, xSearchRadius);
          const trueBottomRightX = snapToDarkestX(imageData, roughRightXBottom, trueBottomY, bubbleSize, xSearchRadius);
          
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
