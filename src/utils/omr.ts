export interface BlockMap {
  startQuestion: number;
  endQuestion: number;
  boundingBox: [number, number, number, number]; // ymin, xmin, ymax, xmax (0-1000)
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
  
  // Use a 15% margin to avoid edges and printed letters
  const marginX = Math.floor(width * 0.15);
  const marginY = Math.floor(height * 0.15);
  
  const x1 = startX + marginX;
  const x2 = startX + width - marginX;
  const y1 = startY + marginY;
  const y2 = startY + height - marginY;
  
  const data = imageData.data;
  const imgWidth = imageData.width;
  
  for (let y = y1; y < y2; y++) {
    for (let x = x1; x < x2; x++) {
      const idx = (y * imgWidth + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      
      // Calculate luminance (0 to 255, where 0 is black)
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      
      // We want darkness (0 to 255, where 255 is black)
      const darkness = 255 - luminance;
      totalDarkness += darkness;
      count++;
    }
  }
  
  return count > 0 ? totalDarkness / count : 0;
}

export async function processOMRImage(base64Data: string, layout: LayoutMap): Promise<OMRResult[]> {
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
      const options = ['A', 'B', 'C', 'D', 'E'];
      
      for (const category of layout.categories) {
        const catResult: OMRResult = {
          categoryName: category.categoryName,
          questions: []
        };
        
        for (const block of category.blocks) {
          const [ymin, xmin, ymax, xmax] = block.boundingBox;
          
          // Convert 0-1000 scale to actual pixels
          const pxYMin = Math.floor((ymin / 1000) * img.height);
          const pxXMin = Math.floor((xmin / 1000) * img.width);
          const pxYMax = Math.floor((ymax / 1000) * img.height);
          const pxXMax = Math.floor((xmax / 1000) * img.width);
          
          const blockWidth = pxXMax - pxXMin;
          const blockHeight = pxYMax - pxYMin;
          
          const numRows = block.endQuestion - block.startQuestion + 1;
          const numCols = 6; // 1 for Question Number, 5 for A,B,C,D,E
          
          const rowHeight = blockHeight / numRows;
          const colWidth = blockWidth / numCols;
          
          for (let row = 0; row < numRows; row++) {
            const questionNum = block.startQuestion + row;
            const rowY = pxYMin + (row * rowHeight);
            
            const darknessScores = [];
            
            // Check columns 1 to 5 (A, B, C, D, E)
            for (let col = 1; col <= 5; col++) {
              const cellX = pxXMin + (col * colWidth);
              const darkness = getAverageDarkness(imageData, Math.floor(cellX), Math.floor(rowY), Math.floor(colWidth), Math.floor(rowHeight));
              darknessScores.push({ option: options[col - 1], score: darkness });
            }
            
            // Analyze the scores
            // Sort by darkness descending
            darknessScores.sort((a, b) => b.score - a.score);
            
            const darkest = darknessScores[0];
            const secondDarkest = darknessScores[1];
            
            let sumOthers = 0;
            for (let i = 1; i < 5; i++) {
              sumOthers += darknessScores[i].score;
            }
            const avgOthers = sumOthers / 4;
            
            let markedOption = null;
            
            // Threshold logic (Relative):
            // 1. Must be at least 25% darker than the average of the empty bubbles.
            // 2. Must be at least 15 absolute units darker than average.
            // 3. Must be distinctly darker than the second darkest (prevents double marking issues).
            if (darkest.score > avgOthers * 1.25 && darkest.score > avgOthers + 15) {
              if (darkest.score > secondDarkest.score + 10) {
                markedOption = darkest.option;
              } else {
                // Double marked
                markedOption = null;
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
      
      resolve(results);
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
