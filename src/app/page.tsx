'use client';

import { useState } from 'react';
import CameraScanner from '@/components/CameraScanner';
import ResultsScreen, { GradingResult } from '@/components/ResultsScreen';
import { Loader2, AlertCircle } from 'lucide-react';
import { processOMRImage, gradeOMR, LayoutMap } from '@/utils/omr';

type Step = 'capture_key' | 'capture_student' | 'processing' | 'results';

export default function Home() {
  const [step, setStep] = useState<Step>('capture_key');
  const [answerKeyImage, setAnswerKeyImage] = useState<string | null>(null);
  const [studentImage, setStudentImage] = useState<string | null>(null);
  const [result, setResult] = useState<GradingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [layoutCache, setLayoutCache] = useState<LayoutMap | null>(null);

  const handleCaptureKey = (base64: string) => {
    setAnswerKeyImage(base64);
    setLayoutCache(null); // Reset layout when answer key changes
    setStep('capture_student');
  };

  const handleCaptureStudent = async (base64: string) => {
    setStudentImage(base64);
    setStep('processing');
    setError(null);
    
    try {
      if (!answerKeyImage) throw new Error("Cevap anahtarı eksik.");

      // 1. Read Answer Key Text via LLM
      const akRes = await fetch('/api/read-answer-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: answerKeyImage }),
      });
      if (!akRes.ok) {
        const errorData = await akRes.json().catch(() => ({}));
        throw new Error(errorData.error || `Cevap anahtarı okunamadı (HTTP ${akRes.status})`);
      }
      const answerKeyDataJSON = await akRes.json();
      const answerKeyData = answerKeyDataJSON.categories; // OMRResult[]

      // 2. Get Layout for Student Form via LLM
      let currentLayout = layoutCache;
      if (!currentLayout) {
        const layoutRes = await fetch('/api/analyze-layout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: base64 }),
        });
        
        if (!layoutRes.ok) {
          const errorData = await layoutRes.json().catch(() => ({}));
          throw new Error(errorData.error || `Koordinat analizi başarısız (HTTP ${layoutRes.status})`);
        }
        
        currentLayout = await layoutRes.json();
        setLayoutCache(currentLayout);
      }

      // 3. Process Student Image using Canvas mathematically
      const studentData = await processOMRImage(base64, currentLayout!);

      // 4. Grade the results
      const finalResult = gradeOMR(answerKeyData, studentData);
      
      setResult(finalResult as GradingResult);
      setStep('results');
    } catch (err: any) {
      setError(err.message || 'Bilinmeyen bir hata oluştu');
      setStep('capture_student');
    }
  };

  const resetProcess = () => {
    setAnswerKeyImage(null);
    setStudentImage(null);
    setResult(null);
    setError(null);
    setLayoutCache(null);
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
