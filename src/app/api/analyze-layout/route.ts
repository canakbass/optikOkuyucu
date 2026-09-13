import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || '',
});

export async function POST(request: Request) {
  try {
    const { image } = await request.json();

    if (!image) {
      return NextResponse.json({ error: 'Eksik fotoğraf.' }, { status: 400 });
    }

    const imageB64 = image.split(',')[1];

    const prompt = `
    Aşağıda sana bir optik form görseli gönderiyorum.
    Bu optik formdaki soru sütunlarının TAM SINIRLARINI (bounding box) bulmanı istiyorum.
    
    Optik formda "GENEL YETENEK", "GENEL KÜLTÜR" gibi ana kategoriler ve bunların altında 30'ar soruluk alt sütunlar (bloklar) bulunur.
    Örneğin "Genel Yetenek" bölümünde 1'den 30'a kadar olan sorular bir blok, 31'den 60'a kadar olan sorular ayrı bir blok oluşturur.
    
    Fotoğrafta perspektif bozulması (eğrilik) olabileceği için, her bir bloğun İLK (en üst) ve SON (en alt) satırlarının koordinatlarını ayrı ayrı bulmanı istiyorum. Aksi takdirde eğrilik (skew) yakalanamaz!
    
    1. topRow (İlk Satır - Örn: 1. soru):
    - yCenter: Bu satırın dikey (Y) tam merkezi.
    - numberXCenter: Bu satırdaki soru numarasının (Örn: "1") yatay (X) tam merkezi.
    - optionEXCenter: Bu satırdaki E şıkkının yatay (X) tam merkezi.
    
    2. bottomRow (Son Satır - Örn: 30. soru):
    - yCenter: Bu satırın dikey (Y) tam merkezi.
    - numberXCenter: Bu satırdaki soru numarasının (Örn: "30") yatay (X) tam merkezi.
    - optionEXCenter: Bu satırdaki E şıkkının yatay (X) tam merkezi.

    For the 'numberXCenter', you must provide the X coordinate of the center of the question number text itself (e.g., the number '1' or '31').
    For the 'optionEXCenter', you must provide the X coordinate of the center of the final 'E' bubble.

    Lütfen kesinlikle JSON formatında döndür. Hiçbir markdown kullanma. Koordinatlar 0-1000 arasında olmalıdır.
    
    İstenilen JSON yapısı:
    {
      "categories": [
        {
          "categoryName": "Kategori Adı",
          "blocks": [
            {
              "startQuestion": 1,
              "endQuestion": 30,
              "topRow": {
                "yCenter": y,
                "numberXCenter": x,
                "optionEXCenter": x
              },
              "bottomRow": {
                "yCenter": y,
                "numberXCenter": x,
                "optionEXCenter": x
              }
            }
          ]
        }
      ]
    }
    `;

    const runWithFallback = async (imageB64: string) => {
      try {
        return await ai.models.generateContent({
          model: 'gemini-3.1-flash-lite',
          contents: [
            { role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: 'image/jpeg', data: imageB64 } }] }
          ],
          config: { responseMimeType: 'application/json', temperature: 0.1 }
        });
      } catch (err: any) {
        if (err.message?.includes('not found') || err.status === 404) {
          return await ai.models.generateContent({
            model: 'gemini-3.1-flash-lite',
            contents: [
              { role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: 'image/jpeg', data: imageB64 } }] }
            ],
            config: { responseMimeType: 'application/json', temperature: 0.1 }
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
