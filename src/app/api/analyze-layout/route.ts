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

    // Cevap anahtarından gelen bölüm bilgisini prompt'a ekle
    let sectionHint = '';
    if (answerKeyCategories && Array.isArray(answerKeyCategories) && answerKeyCategories.length > 0) {
      const cats = answerKeyCategories as AnswerKeyCategory[];
      sectionHint = `
    ÖNEMLİ: Cevap anahtarından aşağıdaki bölümler tespit edildi. 
    SADECE bu bölümleri ara! İsim, telefon, TC kimlik, branş, KOD vb. alanları YOKSAY.
    
    Bölümler:
${cats.map(c => `    - "${c.categoryName}": Soru ${c.startQuestion} → ${c.endQuestion} (${c.questionCount} soru)`).join('\n')}
    
    Her bölüm bir veya daha fazla dikey sütuna bölünmüş olabilir.
    Örneğin "${cats[0]?.categoryName}" bölümü 60 sorudan oluşuyorsa, 
    formda muhtemelen 2 ayrı sütun halinde (1-30 ve 31-60) dizilmiştir.
    Her sütun için ayrı bir 'block' objesi oluştur.
`;
    }

    const prompt = `
    Aşağıda sana bir optik form görseli gönderiyorum.
    Bu optik formdaki SADECE soru/cevap sütunlarının (blokların) MANTIKSAL yapısını ve kabaca yatay (X) konumlarını bulmanı istiyorum.
    
    Hassas hizalama (Y koordinatları ve eğim) bilgisayar görüsü (CV) ile yapılacaktır, bu yüzden senden Y koordinatı veya köşe koordinatları İSTEMİYORUM.
    ${sectionHint}
    DİKKAT (ÇOK ÖNEMLİ): 
    - SADECE soru/cevap balonlarının (A, B, C, D, E şıkları) bulunduğu sütunları bul.
    - İsim, soyad, TC kimlik, telefon, branş seçimi, KOD numarası gibi alanları YOKSAY.
    - Bir kategori birden fazla dikey sütuna bölünmüş olabilir. Kaç sütun varsa 'blocks' listesine o kadar obje ekle.
    - Sütunda yazan İLK ve SON soru numarasını 'startQuestion' ve 'endQuestion' olarak KENDİN belirle.
    - 'columnXCenter' değeri, o sütunun fotoğraf üzerindeki yatay (X) merkezini temsil eden 0 ile 1000 arasında kaba bir sayıdır. (Sola yakınsa 200, ortadaysa 500 gibi).
    - 'verticalAlignment' değeri, bu soru bloğunun sol taraftaki referans çizgilerine göre NEYE HİZALANDIĞINI belirtir. 
      * Eğer bu sütundaki en son soru, kağıdın en altındaki referans çizgisiyle aynı hizadaysa "bottom" yazın.
      * Eğer sorular en üstten başlıyorsa "top" yazın.
      * (Çoğu standart formda isim kısmı üstte, sorular altta olduğu için genelde "bottom" olur).

    Lütfen kesinlikle JSON formatında döndür. Hiçbir markdown kullanma.

    İstenilen JSON yapısı:
    {
      "categories": [
        {
          "categoryName": "Kağıtta yazan testin/kategorinin adı (Örn: GENEL YETENEK)",
          "blocks": [
            {
              "startQuestion": 1,
              "endQuestion": 30,
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
