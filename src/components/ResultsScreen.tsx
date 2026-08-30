'use client';

import React from 'react';
import { CheckCircle2, XCircle, MinusCircle, RotateCcw } from 'lucide-react';

export interface QuestionResult {
  questionNumber: number;
  studentAnswer: string | null;
  correctAnswer: string;
  status: 'correct' | 'incorrect' | 'blank';
}

export interface GradingResult {
  totalCorrect: number;
  totalIncorrect: number;
  totalBlank: number;
  questions: QuestionResult[];
}

interface ResultsScreenProps {
  result: GradingResult;
  onReset: () => void;
}

export default function ResultsScreen({ result, onReset }: ResultsScreenProps) {
  const totalQuestions = result.totalCorrect + result.totalIncorrect + result.totalBlank;
  const score = Math.round((result.totalCorrect / totalQuestions) * 100);

  return (
    <div className="w-full max-w-2xl mx-auto p-4">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold text-gray-800 mb-2">Sonuçlar</h2>
        <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-blue-100 text-blue-600 text-3xl font-bold mb-4">
          {score}
        </div>
        <p className="text-gray-600 font-medium">Başarı Puanı</p>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-green-50 p-4 rounded-xl border border-green-100 flex flex-col items-center">
          <CheckCircle2 className="text-green-500 mb-2" size={28} />
          <span className="text-2xl font-bold text-green-700">{result.totalCorrect}</span>
          <span className="text-sm font-medium text-green-600">Doğru</span>
        </div>
        <div className="bg-red-50 p-4 rounded-xl border border-red-100 flex flex-col items-center">
          <XCircle className="text-red-500 mb-2" size={28} />
          <span className="text-2xl font-bold text-red-700">{result.totalIncorrect}</span>
          <span className="text-sm font-medium text-red-600">Yanlış</span>
        </div>
        <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 flex flex-col items-center">
          <MinusCircle className="text-gray-400 mb-2" size={28} />
          <span className="text-2xl font-bold text-gray-700">{result.totalBlank}</span>
          <span className="text-sm font-medium text-gray-500">Boş</span>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-8">
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
          <h3 className="font-bold text-gray-800">Soru Analizi</h3>
        </div>
        <ul className="divide-y divide-gray-100">
          {result.questions.map((q) => (
            <li key={q.questionNumber} className="px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
              <div className="flex items-center gap-4">
                <span className="w-8 text-gray-500 font-medium">{q.questionNumber}.</span>
                {q.status === 'correct' && <CheckCircle2 className="text-green-500" size={20} />}
                {q.status === 'incorrect' && <XCircle className="text-red-500" size={20} />}
                {q.status === 'blank' && <MinusCircle className="text-gray-400" size={20} />}
                
                <span className={`font-semibold ${q.status === 'correct' ? 'text-green-600' : q.status === 'incorrect' ? 'text-red-600' : 'text-gray-500'}`}>
                  {q.studentAnswer || 'Boş'}
                </span>
              </div>
              
              {q.status !== 'correct' && (
                <div className="text-sm">
                  <span className="text-gray-500 mr-2">Doğru Cevap:</span>
                  <span className="font-bold text-green-600 bg-green-50 px-2 py-1 rounded">{q.correctAnswer}</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      <button
        onClick={onReset}
        className="w-full py-4 bg-gray-900 hover:bg-gray-800 text-white rounded-xl font-bold text-lg shadow-md flex items-center justify-center gap-3 transition-colors"
      >
        <RotateCcw size={20} />
        Yeni Optik Oku
      </button>
    </div>
  );
}
