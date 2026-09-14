import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || '',
});

interface AnswerKeyCategory {
  categoryName: string;
  questionCount: number;
  startQuestion: number;
  endQuestion: number;
}

export async function POST(request: Request) {
  try {
    const { image, answerKeyCategories } = await request.json();

    if (!image) {
      return NextResponse.json({ error: 'Eksik fotoğraf.' }, { status: 400 });
    }

    const imageB64 = image.split(',')[1];

    let sectionHint = '';
    if (answerKeyCategories && Array.isArray(answerKeyCategories) && answerKeyCategories.length > 0) {
      const cats = answerKeyCategories as AnswerKeyCategory[];
      sectionHint = `
    ÖNEMLİ: Cevap anahtarından aşağıdaki bölümler tespit edildi. 
    SADECE bu bölümleri ara! İsim, telefon, TC kimlik, branş, KOD vb. alanları YOKSAY.
    
    Bölümler:
${cats.map(c => `    - "${c.categoryName}": Soru ${c.startQuestion} → ${c.endQuestion} (${c.questionCount} soru)`).join('\n')}
`;
    }

    const prompt = `
    Aşağıda sana bir optik form görseli gönderiyorum.
    Bu formdaki SORU/CEVAP bloklarını (sütunlarını) bulmanı istiyorum.
    
    ÇOK ÖNEMLİ BİR KURAL: 
    Senden hiçbir şekilde orantı, boşluk hesabı veya matematiksel bir çıkarım yapmanı İSTEMİYORUM! 
    SADECE EKRANA BAKACAKSIN ve benden istenilen KÖŞE yuvarlakların (optik şık balonlarının) TAM MERKEZ NOKTASINI, ekranda gördüğün konuma göre [0-1000] oranında vereceksin. Bu kadar.

    ${sectionHint}
    DİKKAT (ÇOK ÖNEMLİ): 
    - SADECE soru/cevap balonlarının bulunduğu sütunları bul. İsim, TC kimlik, telefon gibi alanları KESİNLİKLE YOKSAY.
    - FİZİKSEL SÜTUNLARA DİKKAT ET: Sorular optik formda yan yana sütunlar halindeyse bunları ayrı "block" olarak döndür!

    Benden istenen JSON'daki her bir "block" için 4 FİZİKSEL YUVARLAĞIN merkezini vermelisin:
    - 'topLeft': Bu sütundaki İLK sorunun 'A' şıkkı yuvarlağının tam merkezi {x, y}
    - 'topRight': Bu sütundaki İLK sorunun EN SON şıkkı (örn 'E' şıkkı) yuvarlağının tam merkezi {x, y}
    - 'bottomLeft': Bu sütundaki SON sorunun 'A' şıkkı yuvarlağının tam merkezi {x, y}
    - 'bottomRight': Bu sütundaki SON sorunun EN SON şıkkı yuvarlağının tam merkezi {x, y}

    Koordinatlar resmin en solu 0, en sağı 1000; en üstü 0, en altı 1000 olacak şekildedir.

    İstenilen JSON yapısı:
    {
      "categories": [
        {
          "categoryName": "Kategori Adı",
          "blocks": [
            {
              "startQuestion": 1,
              "endQuestion": 30,
              "topLeft": { "x": 120, "y": 200 },
              "topRight": { "x": 250, "y": 200 },
              "bottomLeft": { "x": 110, "y": 800 },
              "bottomRight": { "x": 240, "y": 800 }
            }
          ]
        }
      ]
    }
    `;

    const runWithFallback = async (imageB64: string) => {
      try {
        return await ai.models.generateContent({
          model: 'gemini-3.5-flash-lite',
          contents: [
            { role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: 'image/jpeg', data: imageB64 } }] }
          ],
          config: { 
            responseMimeType: 'application/json',
            temperature: 0.1 
          }
        });
      } catch (err: any) {
        if (err.message?.includes('not found') || err.status === 404) {
          return await ai.models.generateContent({
            model: 'gemini-3.5-flash-lite',
            contents: [
              { role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: 'image/jpeg', data: imageB64 } }] }
            ],
            config: { 
              responseMimeType: 'application/json',
              temperature: 0.1 
            }
          });
        }
        throw err;
      }
    };

    const response = await runWithFallback(imageB64);
    let textResponse = response.text;
    if (!textResponse) {
      throw new Error("Model yanıt vermedi.");
    }
    
    // Strip markdown code blocks if the model mistakenly wraps the output
    textResponse = textResponse.replace(/^```json/m, '').replace(/^```/m, '').trim();
    if (textResponse.endsWith('```')) {
      textResponse = textResponse.slice(0, -3).trim();
    }
    
    const jsonResult = JSON.parse(textResponse);
    return NextResponse.json(jsonResult);
  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json(
      { error: `Gemini API Hatası: ${error.message}` },
      { status: 500 }
    );
  }
}
