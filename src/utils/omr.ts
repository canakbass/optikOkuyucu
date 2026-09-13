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
          
            // Estimate row height from the left edge
          const totalYSpacePx = ((block.bottomRow.yCenter - block.topRow.yCenter) / 1000) * img.height;
          const rowHeightPx = numRows > 1 ? totalYSpacePx / (numRows - 1) : totalYSpacePx;
          // We make the sampling bubble smaller than the full row to avoid overlaps and borders
          const bubbleSize = rowHeightPx * 0.75;
          
          for (let row = 0; row < numRows; row++) {
            const questionNum = block.startQuestion + row;
            const rRatio = numRows > 1 ? row / (numRows - 1) : 0;
            
            // Bilinear interpolation for the row's left and right anchors
            const leftY = block.topRow.yCenter + (block.bottomRow.yCenter - block.topRow.yCenter) * rRatio;
            const leftX = block.topRow.numberXCenter + (block.bottomRow.numberXCenter - block.topRow.numberXCenter) * rRatio;
            
            const rightY = block.topRow.yCenter + (block.bottomRow.yCenter - block.topRow.yCenter) * rRatio;
            const rightX = block.topRow.optionEXCenter + (block.bottomRow.optionEXCenter - block.topRow.optionEXCenter) * rRatio;
            
            const darknessScores = [];
            
            for (let col = 0; col < 5; col++) {
              // There are 5 intervals between the Number (col=0) and E (col=5).
              // A is col 1, B is 2, C is 3, D is 4, E is 5.
              const cRatio = (col + 1) / 5;
              
              const yCenterRatio = leftY + (rightY - leftY) * cRatio;
              const xCenterRatio = leftX + (rightX - leftX) * cRatio;
              
              const yCenterPx = (yCenterRatio / 1000) * img.height;
              const xCenterPx = (xCenterRatio / 1000) * img.width;
              
              // If Gemini is giving the top of the number instead of the exact center, we add a tiny offset to center it.
              // We'll trust the center but just use the exact math.
              const rowY = yCenterPx - (bubbleSize / 2);
              const cellX = xCenterPx - (bubbleSize / 2);
              
              // Draw debug box
              ctx.strokeRect(cellX, rowY, bubbleSize, bubbleSize);
              
              const darkness = getAverageDarkness(imageData, Math.floor(cellX), Math.floor(rowY), Math.floor(bubbleSize), Math.floor(bubbleSize));
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
