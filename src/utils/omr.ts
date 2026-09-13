export interface BlockMap {
  startQuestion: number;
  endQuestion: number;
  corners: {
    firstQuestionNumber: { x: number; y: number };
    firstQuestionOptionE: { x: number; y: number };
    lastQuestionNumber: { x: number; y: number };
    lastQuestionOptionE: { x: number; y: number };
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
          
          // 1. Get the 4 explicit corners from LLM
          const rawTopY = (block.corners.firstQuestionNumber.y / 1000) * img.height;
          const rawBottomY = (block.corners.lastQuestionNumber.y / 1000) * img.height;
          
          const rawTopLeftX = (block.corners.firstQuestionNumber.x / 1000) * img.width;
          const rawTopRightX = (block.corners.firstQuestionOptionE.x / 1000) * img.width;
          const rawBottomLeftX = (block.corners.lastQuestionNumber.x / 1000) * img.width;
          const rawBottomRightX = (block.corners.lastQuestionOptionE.x / 1000) * img.width;
          
          const nominalRowHeightPx = numRows > 1 ? (rawBottomY - rawTopY) / (numRows - 1) : 0;
          const bubbleSize = nominalRowHeightPx * 0.70;
          
          // 2. Micro-snap the 4 corners (LLM is close, we just center it perfectly on the ink)
          const snapRadius = 25; // Small radius to avoid jumping to adjacent options
          const trueTopLeftX = snapToDarkestX(imageData, rawTopLeftX, rawTopY, bubbleSize, snapRadius);
          const trueTopRightX = snapToDarkestX(imageData, rawTopRightX, rawTopY, bubbleSize, snapRadius);
          const trueBottomLeftX = snapToDarkestX(imageData, rawBottomLeftX, rawBottomY, bubbleSize, snapRadius);
          const trueBottomRightX = snapToDarkestX(imageData, rawBottomRightX, rawBottomY, bubbleSize, snapRadius);
          
          // Debug: Draw LLM (Gemini) Raw Corners as BLUE dots
          ctx.fillStyle = 'blue';
          const r = 8;
          ctx.beginPath(); ctx.arc(rawTopLeftX, rawTopY, r, 0, 2 * Math.PI); ctx.fill();
          ctx.beginPath(); ctx.arc(rawTopRightX, rawTopY, r, 0, 2 * Math.PI); ctx.fill();
          ctx.beginPath(); ctx.arc(rawBottomLeftX, rawBottomY, r, 0, 2 * Math.PI); ctx.fill();
          ctx.beginPath(); ctx.arc(rawBottomRightX, rawBottomY, r, 0, 2 * Math.PI); ctx.fill();
          
          // Debug: Draw Snapped (CV) Corners as GREEN dots
          ctx.fillStyle = 'green';
          ctx.beginPath(); ctx.arc(trueTopLeftX, rawTopY, r, 0, 2 * Math.PI); ctx.fill();
          ctx.beginPath(); ctx.arc(trueTopRightX, rawTopY, r, 0, 2 * Math.PI); ctx.fill();
          ctx.beginPath(); ctx.arc(trueBottomLeftX, rawBottomY, r, 0, 2 * Math.PI); ctx.fill();
          ctx.beginPath(); ctx.arc(trueBottomRightX, rawBottomY, r, 0, 2 * Math.PI); ctx.fill();
          
          // 3. Interpolate and parse every row using bilinear interpolation
          for (let row = 0; row < numRows; row++) {
            const questionNum = block.startQuestion + row;
            const progress = numRows > 1 ? row / (numRows - 1) : 0;
            const yCenter = rawTopY + progress * (rawBottomY - rawTopY);
            
            // Bilinear interpolation for X bounds
            const rowLeftX = trueTopLeftX + progress * (trueBottomLeftX - trueTopLeftX);
            const rowRightX = trueTopRightX + progress * (trueBottomRightX - trueTopRightX);
            
            const darknessScores = [];
            
            for (let col = 0; col < 5; col++) {
              const cRatio = (col + 1) / 5; // col 0 is A, 1/5th distance from Number to E
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
