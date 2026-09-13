import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || '',
});

async function main() {
  const imageBytes = fs.readFileSync("/home/can/.gemini/antigravity/brain/e1d32d2e-5782-49bc-a8fc-33a279e0f3eb/.user_uploaded/media_1789309426326.jpg");
  const imageB64 = imageBytes.toString('base64');
  
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
    - Bir kategori birden fazla dikey sütuna bölünmüş olabilir. Kaç sütun varsa 'blocks' listesine o kadar obje ekle.
    - Soruların 1'den 30'a veya 40'a gitmesi şart değildir. Sütunda yazan İLK ve SON soru numarasını 'startQuestion' ve 'endQuestion' olarak KENDİN belirle. 
    - Fotoğraf yamuk çekilmiş olabilir. Bu yüzden en alttaki sorunun X koordinatı ile en üstteki sorunun X koordinatı AYNI OLAMAZ.
    
    Lütfen kesinlikle JSON formatında döndür. Hiçbir markdown kullanma. Koordinatlar 0-1000 arasında olmalıdır.

    İstenilen JSON yapısı:
    {
      "categories": [
        {
          "categoryName": "Kağıtta yazan testin/kategorinin adı (Örn: TÜRKÇE TESTİ, MATEMATİK)",
          "blocks": [
            {
              "startQuestion": "Bu sütundaki (block) ilk sorunun numarası (Sayısal değer, Örn: 1 veya 31)",
              "endQuestion": "Bu sütundaki (block) son sorunun numarası (Sayısal değer, Örn: 30 veya 40)",
              "topRow": {
                "yCenter": "EN ÜSTTEKİ sorunun numarasının tam dikey (Y) merkezi",
                "numberXCenter": "EN ÜSTTEKİ sorunun numarasının tam yatay (X) merkezi",
                "optionEXCenter": "EN ÜSTTEKİ sorunun SON ŞIKKININ (E şıkkı) tam yatay (X) merkezi"
              },
              "bottomRow": {
                "yCenter": "EN ALTTAKİ sorunun numarasının tam dikey (Y) merkezi",
                "numberXCenter": "EN ALTTAKİ sorunun numarasının tam yatay (X) merkezi",
                "optionEXCenter": "EN ALTTAKİ sorunun SON ŞIKKININ (E şıkkı) tam yatay (X) merkezi"
              }
            }
          ]
        }
      ]
    }
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: [
        { role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: 'image/jpeg', data: imageB64 } }] }
      ],
      config: { responseMimeType: 'application/json', temperature: 0.1 }
    });
    
    console.log(response.text);
  } catch (err) {
    console.error(err);
  }
}
main();
