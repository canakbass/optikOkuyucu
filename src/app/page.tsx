'use client';

import { useState } from 'react';
import CameraScanner from '@/components/CameraScanner';
import ResultsScreen, { GradingResult } from '@/components/ResultsScreen';
import { Loader2, AlertCircle } from 'lucide-react';

type Step = 'capture_key' | 'capture_student' | 'processing' | 'results';

export default function Home() {
  const [step, setStep] = useState<Step>('capture_key');
  const [answerKeyImage, setAnswerKeyImage] = useState<string | null>(null);
  const [studentImage, setStudentImage] = useState<string | null>(null);
  const [result, setResult] = useState<GradingResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCaptureKey = (base64: string) => {
    setAnswerKeyImage(base64);
    setStep('capture_student');
  };

  const handleCaptureStudent = async (base64: string) => {
    setStudentImage(base64);
    setStep('processing');
    setError(null);
    
    try {
      const response = await fetch('/api/grade', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          answerKeyImage,
          studentImage: base64,
        }),
      });

      if (!response.ok) {
        throw new Error('Değerlendirme sırasında bir hata oluştu');
      }

      const data: GradingResult = await response.json();
      setResult(data);
      setStep('results');
    } catch (err: any) {
      setError(err.message || 'Bilinmeyen bir hata oluştu');
      setStep('capture_student'); // let them try again
    }
  };

  const resetProcess = () => {
    setAnswerKeyImage(null);
    setStudentImage(null);
    setResult(null);
    setError(null);
    setStep('capture_key');
  };

  return (
    <main className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <header className="text-center mb-10">
          <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight">
            Optik Okuyucu
          </h1>
          <p className="mt-2 text-lg text-gray-600">
            Telefonunuzla optik formlarınızı anında değerlendirin.
          </p>
        </header>

        {error && (
          <div className="mb-6 bg-red-50 border-l-4 border-red-500 p-4 rounded-r-lg flex items-start gap-3">
            <AlertCircle className="text-red-500 shrink-0 mt-0.5" />
            <p className="text-red-700">{error}</p>
          </div>
        )}

        {step === 'capture_key' && (
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <CameraScanner 
              onCapture={handleCaptureKey} 
              title="1. Adım: Cevap Anahtarı" 
              description="Öncelikle doğru cevapların işaretli olduğu ustanın optik formunu (cevap anahtarını) okutun."
            />
          </div>
        )}

        {step === 'capture_student' && (
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <CameraScanner 
              onCapture={handleCaptureStudent} 
              title="2. Adım: Öğrenci Optiği" 
              description="Şimdi değerlendirmek istediğiniz öğrenci optik formunu okutun."
            />
            <button 
              onClick={() => setStep('capture_key')}
              className="mt-6 text-sm text-gray-500 hover:text-gray-700 block text-center w-full"
            >
              &larr; Geri dön ve Cevap Anahtarını tekrar çek
            </button>
          </div>
        )}

        {step === 'processing' && (
          <div className="bg-white p-12 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center justify-center text-center">
            <Loader2 className="w-16 h-16 text-blue-600 animate-spin mb-6" />
            <h2 className="text-2xl font-bold text-gray-800 mb-2">Değerlendiriliyor...</h2>
            <p className="text-gray-500">Yapay zeka optik formları okuyor ve karşılaştırıyor. Bu işlem birkaç saniye sürebilir.</p>
          </div>
        )}

        {step === 'results' && result && (
          <ResultsScreen result={result} onReset={resetProcess} />
        )}
      </div>
    </main>
  );
}
