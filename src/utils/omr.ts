export interface OMRResult {
  categoryName: string;
  questions: { questionNumber: number; answer: string | null }[];
}

export interface GradedQuestion {
  questionNumber: number;
  studentAnswer: string | null;
  correctAnswer: string;
  status: 'correct' | 'incorrect' | 'blank';
}

export interface CategoryResult {
  categoryName: string;
  categoryCorrect: number;
  categoryIncorrect: number;
  categoryBlank: number;
  questions: GradedQuestion[];
}

export interface GradingResult {
  totalCorrect: number;
  totalIncorrect: number;
  totalBlank: number;
  categories: CategoryResult[];
}

export async function processOMRImageCV(base64Data: string, answerKeyCategories: OMRResult[]): Promise<{ data: OMRResult[], debugImageBase64: string }> {
  return new Promise((resolve, reject) => {
    // Wait for cv to be ready (it's loaded globally via Script tag)
    const checkCV = setInterval(() => {
      // @ts-ignore
      if (typeof cv !== 'undefined' && cv.Mat) {
        clearInterval(checkCV);
        runCVLogic();
      }
    }, 100);

    function runCVLogic() {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(img, 0, 0);

          // @ts-ignore
          let src = cv.imread(canvas);
          // @ts-ignore
          let gray = new cv.Mat();
          // @ts-ignore
          cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);

          // Step 1: Deskew & Flatten
          // ... (We will implement this below)

          // Mock return for now
          resolve({ data: answerKeyCategories, debugImageBase64: canvas.toDataURL() });

        } catch (e) {
          reject(e);
        }
      };
      img.onerror = reject;
      img.src = base64Data;
    }
  });
}

export function gradeOMR(answerKey: OMRResult[], student: OMRResult[]): GradingResult {
  let totalCorrect = 0, totalIncorrect = 0, totalBlank = 0;
  const categories: CategoryResult[] = [];

  for (let i = 0; i < answerKey.length; i++) {
    const akCat = answerKey[i];
    const stCat = student[i] || { categoryName: akCat.categoryName, questions: [] };

    let categoryCorrect = 0, categoryIncorrect = 0, categoryBlank = 0;
    const questions: GradedQuestion[] = [];

    for (let j = 0; j < akCat.questions.length; j++) {
      const akQ = akCat.questions[j];
      const stQ = stCat.questions.find(q => q.questionNumber === akQ.questionNumber);
      
      const stAns = stQ ? stQ.answer : null;
      let status: 'correct' | 'incorrect' | 'blank' = 'blank';

      if (!stAns) {
        status = 'blank';
        categoryBlank++;
      } else if (stAns === akQ.answer) {
        status = 'correct';
        categoryCorrect++;
      } else {
        status = 'incorrect';
        categoryIncorrect++;
      }

      questions.push({
        questionNumber: akQ.questionNumber,
        studentAnswer: stAns,
        correctAnswer: akQ.answer || '',
        status
      });
    }

    totalCorrect += categoryCorrect;
    totalIncorrect += categoryIncorrect;
    totalBlank += categoryBlank;
    
    categories.push({
      categoryName: akCat.categoryName,
      categoryCorrect,
      categoryIncorrect,
      categoryBlank,
      questions
    });
  }

  return { totalCorrect, totalIncorrect, totalBlank, categories };
}
