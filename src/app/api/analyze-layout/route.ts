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
    
    Aşağıda vereceğim JSON şemasına harfi harfine uymalısın.
    Her sütun (block) için bana 4 adet TAM VE BAĞIMSIZ NOKTA (X, Y) vermeni istiyorum.
    
    DİKKAT (ÇOK ÖNEMLİ): 
    - Fotoğrafta kaç tane kategori (ders/test) varsa hepsi için bir obje oluşturmalısın. Kategori adını (Örn: TÜRKÇE, MATEMATİK, FEN BİLİMLERİ) kağıttan kendin oku.
    - Bir kategori birden fazla dikey sütuna bölünmüş olabilir. Kaç sütun varsa `blocks` listesine o kadar obje ekle.
    - Soruların 1'den 30'a veya 40'a gitmesi şart değildir. Sütunda yazan İLK ve SON soru numarasını `startQuestion` ve `endQuestion` olarak KENDİN belirle. (Örn: YKS formunda 40 soru tek sütun olabilir, KPSS'de 30'ar soru iki sütun olabilir. Sistemin sınırları yoktur, her şeye uyum sağlamalıdır.)
    - Fotoğraf yamuk çekilmiş olabilir. Bu yüzden en alttaki sorunun X koordinatı ile en üstteki sorunun X koordinatı AYNI OLAMAZ.
    - Asla "Bounding Box (Kare)" mantığıyla düşünme. 4 noktaya da sanki birbirinden tamamen bağımsız 4 farklı hedefmiş gibi bak.
    - En alt satırın koordinatlarını hesaplarken, üst satırı KOPYALAMA. Bizzat o noktaya bakıp eğimi (skew) hesaba kat.

    Lütfen kesinlikle JSON formatında döndür. Hiçbir markdown kullanma. Koordinatlar 0-1000 arasında olmalıdır.

    İstenilen JSON yapısı:
    {
      "categories": [
        {
          "categoryName": "Kağıtta yazan testin/kategorinin adı (Örn: TÜRKÇE TESTİ, MATEMATİK, Genel Kültür vs.)",
          "blocks": [
            {
              "startQuestion": "Bu sütundaki (block) ilk sorunun numarası (Örn: 1 veya 31 veya 41)",
              "endQuestion": "Bu sütundaki (block) son sorunun numarası (Örn: 30 veya 40 veya 60)",
              "corners": {
                "firstQuestionNumber": {
                  "text": "Sütundaki EN ÜSTTEKİ sorunun numarasını OKU (Örn: '1' veya '31')",
                  "x": "Okuduğun bu numaranın tam yatay (X) merkezi",
                  "y": "Okuduğun bu numaranın tam dikey (Y) merkezi"
                },
                "firstQuestionOptionE": {
                  "text": "Sütundaki EN ÜSTTEKİ sorunun formdaki SON şıkkındaki harfi OKU (Örn: 'E' veya 'D')",
                  "x": "Okuduğun bu şıkkın tam yatay (X) merkezi",
                  "y": "Okuduğun bu şıkkın tam dikey (Y) merkezi"
                },
                "lastQuestionNumber": {
                  "text": "Sütundaki EN ALTTAKİ sorunun numarasını OKU (Örn: '30' veya '40')",
                  "x": "Okuduğun bu numaranın tam yatay (X) merkezi. (DİKKAT: ÜSTTEKİYLE AYNI HİZADA OLMAK ZORUNDA DEĞİL, SADECE BU NUMARANIN YERİNİ BUL!)",
                  "y": "Okuduğun bu numaranın tam dikey (Y) merkezi"
                },
                "lastQuestionOptionE": {
                  "text": "Sütundaki EN ALTTAKİ sorunun formdaki SON şıkkındaki harfi OKU (Örn: 'E')",
                  "x": "Okuduğun bu şıkkın tam yatay (X) merkezi. (DİKKAT: ÜSTTEKİYLE AYNI HİZADA OLMAK ZORUNDA DEĞİL!)",
                  "y": "Okuduğun bu şıkkın tam dikey (Y) merkezi"
                }
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
