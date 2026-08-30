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

    const prompt = `
    Aşağıda sana iki adet görsel gönderiyorum. 
    1. görsel bir optik form CEVAP ANAHTARI (doğru cevapların olduğu usta optik).
    2. görsel ise bir ÖĞRENCİYE AİT optik formdur.
    
    Çok dikkatli bir inceleme yapmalısın. Optik formlarda (Türkçe, Matematik, Fen, Sosyal vb. veya Genel Kültür, Genel Yetenek gibi) ders/kategori isimleri bulunabilir. 
    
    Lütfen şu adımları harfiyen takip et:
    1. Her iki optikte de bulunan kategorileri/ders isimlerini tespit et. Eğer kategori yoksa hepsini "Tüm Sorular" adı altında topla.
    2. Cevap anahtarı optiğinden her bir kategori için soruların doğru cevaplarını (A, B, C, D veya E) satır satır çok dikkatlice tespit et. Kaydırma veya yanlış okuma yapmamaya aşırı özen göster, sadece siyah/dolu yuvarlağı baz al.
    3. Öğrenci optiğinden her bir soru için öğrencinin işaretlediği şıkkı tespit et. Hiçbir şık işaretlenmemişse null döndür. Karalanmış ama hangi şık olduğu anlaşılmıyorsa boş say.
    4. Öğrencinin cevabını doğru cevap ile karşılaştırarak sorunun "correct" (doğru), "incorrect" (yanlış) veya "blank" (boş) olduğuna karar ver.
    5. Her kategori için ve genel toplam için doğru, yanlış ve boş sayılarını topla.
    
    Lütfen kesinlikle JSON formatında döndür. Hiçbir markdown ( \`\`\`json vb.) kullanma, sadece saf JSON döndür.
    
    İstenilen JSON yapısı:
    {
      "totalCorrect": number,
      "totalIncorrect": number,
      "totalBlank": number,
      "categories": [
        {
          "categoryName": string,
          "categoryCorrect": number,
          "categoryIncorrect": number,
          "categoryBlank": number,
          "questions": [
            {
              "questionNumber": number,
              "studentAnswer": string | null,
              "correctAnswer": string,
              "status": "correct" | "incorrect" | "blank"
            }
          ]
        }
      ]
    }
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-1.5-pro',
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { inlineData: { mimeType: 'image/jpeg', data: answerKeyB64 } },
            { inlineData: { mimeType: 'image/jpeg', data: studentB64 } }
          ],
        }
      ],
      config: {
        responseMimeType: 'application/json',
      }
    });

    const textResponse = response.text;
    if (!textResponse) {
      throw new Error("Model yanıt vermedi.");
    }
    
    // Parse the JSON. (responseMimeType ensures it's JSON)
    const jsonResult = JSON.parse(textResponse);

    return NextResponse.json(jsonResult);
  } catch (error: any) {
    console.error('API Error:', error);
    const errorMessage = error.message || 'Bilinmeyen bir hata oluştu';
    return NextResponse.json(
      { error: `Gemini API Hatası: ${errorMessage}` },
      { status: 500 }
    );
  }
}
