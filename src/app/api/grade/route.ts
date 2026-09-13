import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

// Initialize the GenAI client
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || '',
});

export async function POST(request: Request) {
  try {
    const { answerKeyImage, studentImage } = await request.json();

    if (!answerKeyImage || !studentImage) {
      return NextResponse.json(
        { error: 'Eksik fotoğraf. Lütfen hem cevap anahtarını hem de öğrenci optiğini yükleyin.' },
        { status: 400 }
      );
    }

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: 'Gemini API anahtarı bulunamadı. Lütfen .env.local dosyasından kontrol edin.' },
        { status: 500 }
      );
    }

    // Convert base64 data URIs to raw base64
    const answerKeyB64 = answerKeyImage.split(',')[1];
    const studentB64 = studentImage.split(',')[1];

    const parsePrompt = `
    Aşağıda sana bir optik form görseli gönderiyorum. 
    Çok dikkatli bir inceleme yapmalısın. Optik formlarda (Türkçe, Matematik, Fen, Sosyal vb. veya Genel Kültür, Genel Yetenek gibi) ders/kategori isimleri bulunabilir. 
    
    Lütfen şu adımları harfiyen takip et:
    1. Optikte bulunan kategorileri/ders isimlerini tespit et. Eğer kategori yoksa hepsini "Tüm Sorular" adı altında topla.
    2. Her bir kategori için soruların işaretli şıklarını (A, B, C, D veya E) satır satır çok dikkatlice tespit et. Kaydırma veya yanlış okuma yapmamaya aşırı özen göster, sadece siyah/dolu yuvarlağı baz al.
    3. Hiçbir şık işaretlenmemişse veya birden fazla şık işaretlenmişse null döndür.
    
    Lütfen kesinlikle JSON formatında döndür. Hiçbir markdown kullanma, sadece saf JSON döndür.
    
    İstenilen JSON yapısı:
    {
      "categories": [
        {
          "categoryName": string,
          "questions": [
            {
              "questionNumber": number,
              "answer": string | null
            }
          ]
        }
      ]
    }
    `;

    const generateWithModel = async (modelName: string, imageB64: string) => {
      return await ai.models.generateContent({
        model: modelName,
        contents: [
          {
            role: 'user',
            parts: [
              { text: parsePrompt },
              { inlineData: { mimeType: 'image/jpeg', data: imageB64 } }
            ],
          }
        ],
        config: {
          responseMimeType: 'application/json',
          temperature: 0.1,
        }
      });
    };

    const runWithFallback = async (imageB64: string) => {
      try {
        return await generateWithModel('gemini-3.6-pro', imageB64);
      } catch (err: any) {
        if (err.message?.includes('not found') || err.status === 404 || err.status === 'NOT_FOUND') {
          console.log("3.6-pro bulunamadı, 3.6-flash'e düşülüyor...");
          return await generateWithModel('gemini-3.6-flash', imageB64);
        }
        throw err;
      }
    };

    // Run both models concurrently
    const [answerKeyRes, studentRes] = await Promise.all([
      runWithFallback(answerKeyB64),
      runWithFallback(studentB64)
    ]);

    const answerKeyText = answerKeyRes.text;
    const studentText = studentRes.text;

    if (!answerKeyText || !studentText) {
      throw new Error("Model yanıt vermedi.");
    }
    
    const answerKeyData = JSON.parse(answerKeyText);
    const studentData = JSON.parse(studentText);

    // Grading logic in JS
    let totalCorrect = 0;
    let totalIncorrect = 0;
    let totalBlank = 0;
    
    const resultCategories = [];

    // Assuming categories match by order. If names differ slightly, order is safer.
    const akCategories = answerKeyData.categories || [];
    const stCategories = studentData.categories || [];

    for (let i = 0; i < akCategories.length; i++) {
      const akCategory = akCategories[i];
      const stCategory = stCategories[i] || { questions: [] };
      
      let categoryCorrect = 0;
      let categoryIncorrect = 0;
      let categoryBlank = 0;
      const questionsResult = [];

      // Create a map for fast lookup of student answers by question number
      const stAnswersMap = new Map();
      (stCategory.questions || []).forEach((q: any) => {
        stAnswersMap.set(q.questionNumber, q.answer);
      });

      for (const akQuestion of (akCategory.questions || [])) {
        const qNum = akQuestion.questionNumber;
        const correctAns = akQuestion.answer;
        const studentAns = stAnswersMap.get(qNum) !== undefined ? stAnswersMap.get(qNum) : null;
        
        let status = "blank";
        if (studentAns === null) {
          status = "blank";
          categoryBlank++;
        } else if (studentAns.toUpperCase() === correctAns?.toUpperCase()) {
          status = "correct";
          categoryCorrect++;
        } else {
          status = "incorrect";
          categoryIncorrect++;
        }

        questionsResult.push({
          questionNumber: qNum,
          studentAnswer: studentAns,
          correctAnswer: correctAns,
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

    const finalResult = {
      totalCorrect,
      totalIncorrect,
      totalBlank,
      categories: resultCategories
    };

    return NextResponse.json(finalResult);
  } catch (error: any) {
    console.error('API Error:', error);
    const errorMessage = error.message || 'Bilinmeyen bir hata oluştu';
    return NextResponse.json(
      { error: `Gemini API Hatası: ${errorMessage}` },
      { status: 500 }
    );
  }
}
