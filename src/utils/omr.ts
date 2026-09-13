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

// Haar-like Vertical Line Detector
function detectVerticalLine(imageData: ImageData, yCenter: number, searchCenterX: number): number {
    const searchRadius = 50; // VERY small radius to avoid catching adjacent column lines
    const ySpan = 25; 
    let maxScore = -999999;
    let bestX = searchCenterX;
    
    for (let xOffset = -searchRadius; xOffset <= searchRadius; xOffset++) {
        const x = Math.floor(searchCenterX + xOffset);
        if (x < 2 || x >= imageData.width - 2) continue;
        
        let score = 0;
        for (let dy = -ySpan; dy <= ySpan; dy++) {
            const y = Math.floor(yCenter + dy);
            if (y < 0 || y >= imageData.height) continue;
            
            const idx = (y * imageData.width + x) * 4;
            const darkness = 255 - (0.299 * imageData.data[idx] + 0.587 * imageData.data[idx+1] + 0.114 * imageData.data[idx+2]);
            
            const leftIdx = (y * imageData.width + (x - 2)) * 4;
            const leftDarkness = 255 - (0.299 * imageData.data[leftIdx] + 0.587 * imageData.data[leftIdx+1] + 0.114 * imageData.data[leftIdx+2]);
            
            const rightIdx = (y * imageData.width + (x + 2)) * 4;
            const rightDarkness = 255 - (0.299 * imageData.data[rightIdx] + 0.587 * imageData.data[rightIdx+1] + 0.114 * imageData.data[rightIdx+2]);
            
            const lineContrast = darkness - ((leftDarkness + rightDarkness) / 2);
            score += lineContrast;
        }
        
        if (score > maxScore) {
            maxScore = score;
            bestX = x;
        }
    }
    return bestX;
}

// Solid Line Tracer: Prevents the line from jumping to another column
function traceVerticalLine(imageData: ImageData, startX: number, startY: number, endY: number): number {
    let currentX = startX;
    
    const stepY = 10; 
    for (let y = startY; y <= endY; y += stepY) {
        let maxContrast = -999999;
        let bestX = currentX;
        
        // Search very tightly around the current X (max 5 pixels deviation per 10 pixels height)
        for (let xOffset = -5; xOffset <= 5; xOffset++) {
            const x = Math.floor(currentX + xOffset);
            if (x < 2 || x >= imageData.width - 2) continue;
            
            let contrastSum = 0;
            for (let dy = 0; dy < stepY; dy++) {
                const subY = Math.floor(y + dy);
                if (subY >= imageData.height) continue;
                
                const idx = (subY * imageData.width + x) * 4;
                const darkness = 255 - (0.299 * imageData.data[idx] + 0.587 * imageData.data[idx+1] + 0.114 * imageData.data[idx+2]);
                
                const leftIdx = (subY * imageData.width + (x - 2)) * 4;
                const leftDarkness = 255 - (0.299 * imageData.data[leftIdx] + 0.587 * imageData.data[leftIdx+1] + 0.114 * imageData.data[leftIdx+2]);
                
                const rightIdx = (subY * imageData.width + (x + 2)) * 4;
                const rightDarkness = 255 - (0.299 * imageData.data[rightIdx] + 0.587 * imageData.data[rightIdx+1] + 0.114 * imageData.data[rightIdx+2]);
                
                contrastSum += darkness - ((leftDarkness + rightDarkness) / 2);
            }
            
            if (contrastSum > maxContrast) {
                maxContrast = contrastSum;
                bestX = x;
            }
        }
        currentX = bestX;
    }
    return currentX;
}

// Global Skew Detection and Boundary Line Finder
function findBlockBoundaries(imageData: ImageData, trueTopY: number, trueBottomY: number, roughLeftX: number, roughRightX: number) {
    // 1. Detect the Left Line precisely at the Top
    const leftLineTopX = detectVerticalLine(imageData, trueTopY, roughLeftX - 25);
    // TRACE it down to the bottom
    const leftLineBottomX = traceVerticalLine(imageData, leftLineTopX, trueTopY, trueBottomY);
    
    // 2. Detect the Right Line precisely at the Top
    const rightLineTopX = detectVerticalLine(imageData, trueTopY, roughRightX + 25);
    // TRACE it down to the bottom
    const rightLineBottomX = traceVerticalLine(imageData, rightLineTopX, trueTopY, trueBottomY);
    
    // 3. Calculate True Physical Skew
    const leftSkew = (leftLineBottomX - leftLineTopX) / (trueBottomY - trueTopY);
    const rightSkew = (rightLineBottomX - rightLineTopX) / (trueBottomY - trueTopY);
    
    // Average skew for maximum robustness
    const angle = Math.atan((leftSkew + rightSkew) / 2);
    
    // 4. Calculate Bubbles via Interpolation
    const topWidth = rightLineTopX - leftLineTopX;
    
    const trueTopLeftX = leftLineTopX + (topWidth * 0.14);
    const trueTopRightX = leftLineTopX + (topWidth * 0.86);
    
    return {
        angle: angle,
        trueTopLeftX: trueTopLeftX,
        trueTopRightX: trueTopRightX,
        leftLineX: leftLineTopX, 
        rightLineX: rightLineTopX 
    };
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
          
          // 1. Trust Gemini for the Y boundaries (User confirmed LLM height is PERFECT)
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
          
          // 3. Global Skew Projection Algorithm
          // This analyzes the entire block at once, finding the true physical skew angle and column centers!
          const result = findBlockBoundaries(imageData, trueTopY, trueBottomY, roughLeftXTop, roughRightXTop);
          
          const trueTopLeftX = result.trueTopLeftX;
          const trueTopRightX = result.trueTopRightX;
          
          // Calculate bottom corners perfectly using the global skew angle
          const skewShift = (trueBottomY - trueTopY) * Math.tan(result.angle);
          const trueBottomLeftX = trueTopLeftX + skewShift;
          const trueBottomRightX = trueTopRightX + skewShift;
          
          // DEBUG: Draw the detected boundary lines as YELLOW lines
          ctx.strokeStyle = 'yellow';
          ctx.lineWidth = 1;
          
          ctx.beginPath();
          ctx.moveTo(result.leftLineX, trueTopY);
          ctx.lineTo(result.leftLineX + skewShift, trueBottomY);
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(result.rightLineX, trueTopY);
          ctx.lineTo(result.rightLineX + skewShift, trueBottomY);
          ctx.stroke();
          
          // Restore red for the grid
          ctx.strokeStyle = 'red';
          ctx.lineWidth = 2;
          
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
