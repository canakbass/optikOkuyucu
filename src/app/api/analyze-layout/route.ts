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
    Bu optik formdaki SADECE soru/cevap sütunlarının (blokların) MANTIKSAL yapısını ve kabaca yatay (X) konumlarını bulmanı istiyorum.
    
    Hassas hizalama bilgisayar görüsü ile yapılacaktır, bu yüzden senden Y koordinatı İSTEMİYORUM.
    ${sectionHint}
    DİKKAT (ÇOK ÖNEMLİ): 
    - SADECE soru/cevap balonlarının bulunduğu sütunları bul. İsim, TC kimlik, telefon gibi alanları KESİNLİKLE YOKSAY.
    - 'startQuestion' ve 'endQuestion' alanlarına o sütundaki ilk ve son sorunun numarasını yaz.
    - FİZİKSEL SÜTUNLARA DİKKAT ET: Sorular optik formda yan yana (örneğin 1-30 sol sütunda, 31-60 sağ sütunda) duruyorsa KESİNLİKLE bunları iki ayrı "block" olarak döndür! Asla birleştirip 1-60 yapma.
    - SADECE sorular görsel olarak tek bir sütunda kesintisiz iniyorsa tek parça (örn: 1-60) döndür.
    - 'columnXCenter' değeri, o sütunun fotoğraf üzerindeki yatay (X) merkezini temsil eden 0 ile 1000 arasında kaba bir sayıdır. (Sola yakınsa 200, ortadaysa 500 gibi).
    - 'verticalAlignment' değeri her zaman "bottom" olabilir, bunu çok önemseme.

    Lütfen kesinlikle JSON formatında döndür. Hiçbir markdown kullanma.

    İstenilen JSON yapısı:
    {
      "categories": [
        {
          "categoryName": "Kağıtta yazan testin adı",
          "blocks": [
            {
              "startQuestion": 1,
              "endQuestion": 60,
              "columnXCenter": 250,
              "verticalAlignment": "bottom"
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
