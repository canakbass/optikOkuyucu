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
    Bu optik formdaki soru sütunlarının (blokların) MANTIKSAL yapısını ve kabaca yatay (X) konumlarını bulmanı istiyorum.
    Hassas hizalama (Y koordinatları ve eğim) bilgisayar görüsü (CV) ile yapılacaktır, bu yüzden senden Y koordinatı veya köşe koordinatları İSTEMİYORUM.
    
    Optik formda "GENEL YETENEK", "GENEL KÜLTÜR" gibi ana kategoriler ve bunların altında 30'ar soruluk alt sütunlar (bloklar) bulunur.
    Örneğin "Genel Yetenek" bölümünde 1'den 30'a kadar olan sorular bir blok, 31'den 60'a kadar olan sorular ayrı bir blok oluşturur.
    
    DİKKAT (ÇOK ÖNEMLİ): 
    - Fotoğrafta kaç tane kategori (ders/test) varsa hepsi için bir obje oluşturmalısın. Kategori adını kağıttan kendin oku.
    - Bir kategori birden fazla dikey sütuna bölünmüş olabilir. Kaç sütun varsa 'blocks' listesine o kadar obje ekle.
    - Sütunda yazan İLK ve SON soru numarasını 'startQuestion' ve 'endQuestion' olarak KENDİN belirle. 
    - 'columnXCenter' değeri, o sütunun fotoğraf üzerindeki yatay (X) merkezini temsil eden 0 ile 1000 arasında kaba bir sayıdır.
    - 'blockTopY' değeri, o sütunun (bloğun) İLK SORUSUNUN fotoğraf üzerindeki kaba dikey (Y) koordinatıdır (0 ile 1000 arasında). Bu sayede soruların kağıdın en üstünden mi yoksa ortasından/altından mı başladığını anlayacağız.

    Lütfen kesinlikle JSON formatında döndür. Hiçbir markdown kullanma.
    Aşağıdaki JSON şemasını DİKKATLE incele. Şemadaki 0 (SIFIR) değerleri SADECE ÖRNEKTİR!

    İstenilen JSON yapısı:
    {
      "categories": [
        {
          "categoryName": "Kağıtta yazan testin/kategorinin adı (Örn: GENEL YETENEK)",
          "blocks": [
            {
              "startQuestion": 1,
              "endQuestion": 30,
              "columnXCenter": 0,
              "blockTopY": 0
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
          config: { 
            responseMimeType: 'application/json',
            temperature: 0.1 
          }
        });
      } catch (err: any) {
        if (err.message?.includes('not found') || err.status === 404) {
          return await ai.models.generateContent({
            model: 'gemini-3.1-flash-lite',
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
