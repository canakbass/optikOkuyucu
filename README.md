# Optik Okuyucu

Bu proje, öğrencilerin optik formlarını (cevap anahtarı ile karşılaştırarak) telefon kamerası ile okumalarını sağlayan basit bir Next.js web uygulamasıdır. Değerlendirme işlemi için Google Gemini API kullanılmaktadır.

## Kurulum ve Çalıştırma

1. Projeyi bilgisayarınıza klonlayın veya indirin.
2. Gerekli kütüphaneleri yükleyin:
   ```bash
   npm install
   ```
3. Proje dizininde `.env.local` adlı bir dosya oluşturun ve içine Gemini API anahtarınızı ekleyin:
   ```env
   GEMINI_API_KEY=sizin_api_anahtariniz
   ```
4. Uygulamayı başlatın:
   ```bash
   npm run dev
   ```
5. Tarayıcınızda [http://localhost:3000](http://localhost:3000) adresine giderek uygulamayı kullanmaya başlayabilirsiniz.

## Vercel'e Yükleme (Deploy)

Projeyi Vercel'de yayınlamak çok basittir:
1. Projeyi kendi GitHub hesabınıza yükleyin.
2. Vercel paneline giriş yapıp "Add New Project" deyin.
3. GitHub deponuzu seçin.
4. "Environment Variables" kısmına `GEMINI_API_KEY` değişkenini ekleyin.
5. "Deploy" butonuna basın.

Uygulamanız kısa süre içinde yayına alınacaktır.
