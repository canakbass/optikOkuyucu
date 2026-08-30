'use client';

import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Camera, RefreshCw, Upload } from 'lucide-react';

interface CameraScannerProps {
  onCapture: (base64Image: string) => void;
  title: string;
  description: string;
}

export default function CameraScanner({ onCapture, title, description }: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const startCamera = useCallback(async () => {
    try {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' } // Prefer back camera
      });
      setStream(mediaStream);
      setHasPermission(true);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err) {
      console.error("Kamera erişimi reddedildi veya hata oluştu:", err);
      setHasPermission(false);
    }
  }, [stream]);

  useEffect(() => {
    startCamera();
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []); // Run once on mount

  const handleCapture = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      
      // Set canvas dimensions to match video stream
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      const context = canvas.getContext('2d');
      if (context) {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        // Get base64 string
        const base64Image = canvas.toDataURL('image/jpeg', 0.8);
        onCapture(base64Image);
        
        // Stop camera after capture
        if (stream) {
          stream.getTracks().forEach(track => track.stop());
        }
      }
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64Image = event.target?.result as string;
      if (base64Image) {
        onCapture(base64Image);
        // Stop camera if it's running
        if (stream) {
          stream.getTracks().forEach(track => track.stop());
        }
      }
    };
    reader.readAsDataURL(file);
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  if (hasPermission === false) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center bg-red-50 rounded-xl border border-red-200">
        <p className="text-red-600 mb-4 font-medium">Kamera erişimi reddedildi. Lütfen tarayıcı ayarlarından kamera izni verin veya fotoğraf yükleyin.</p>
        <div className="flex flex-col w-full gap-3">
          <button 
            onClick={startCamera}
            className="w-full px-4 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 flex justify-center items-center gap-2"
          >
            <RefreshCw size={18} /> Kamerayı Tekrar Dene
          </button>
          <div className="relative w-full">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-red-200"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-red-50 text-red-500">VEYA</span>
            </div>
          </div>
          <button
            onClick={triggerFileInput}
            className="w-full px-4 py-3 bg-white border-2 border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 flex justify-center items-center gap-2 font-medium"
          >
            <Upload size={18} /> Galeriden Yükle
          </button>
          <input 
            type="file" 
            accept="image/*" 
            className="hidden" 
            ref={fileInputRef} 
            onChange={handleFileUpload} 
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center w-full max-w-md mx-auto">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">{title}</h2>
        <p className="text-sm text-gray-600 mt-2">{description}</p>
      </div>

      <div className="relative w-full aspect-[3/4] bg-black rounded-2xl overflow-hidden shadow-xl mb-6">
        {/* Video stream */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
        />
        
        {/* Overlay guides */}
        <div className="absolute inset-0 z-10 pointer-events-none p-6 flex flex-col justify-between">
          <div className="w-full h-full border-2 border-white/50 rounded-lg relative">
            {/* Corner markers */}
            <div className="absolute -top-1 -left-1 w-8 h-8 border-t-4 border-l-4 border-green-500 rounded-tl-lg"></div>
            <div className="absolute -top-1 -right-1 w-8 h-8 border-t-4 border-r-4 border-green-500 rounded-tr-lg"></div>
            <div className="absolute -bottom-1 -left-1 w-8 h-8 border-b-4 border-l-4 border-green-500 rounded-bl-lg"></div>
            <div className="absolute -bottom-1 -right-1 w-8 h-8 border-b-4 border-r-4 border-green-500 rounded-br-lg"></div>
            
            {/* Center crosshair */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
              <div className="w-4 h-[1px] bg-white/50 absolute top-1/2 left-1/2 -translate-x-1/2"></div>
              <div className="h-4 w-[1px] bg-white/50 absolute top-1/2 left-1/2 -translate-y-1/2"></div>
            </div>
          </div>
        </div>

        {/* Loading state indicator */}
        {!stream && (
          <div className="absolute inset-0 z-20 bg-gray-900 flex items-center justify-center">
            <div className="animate-spin text-white">
              <RefreshCw size={32} />
            </div>
          </div>
        )}
      </div>

      <div className="w-full flex gap-3">
        <button
          onClick={handleCapture}
          disabled={!stream}
          className="flex-1 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-lg shadow-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Camera size={24} />
          Çek
        </button>
        
        <button
          onClick={triggerFileInput}
          className="flex-1 py-4 bg-white border-2 border-gray-200 hover:bg-gray-50 text-gray-800 rounded-xl font-bold text-lg shadow-sm flex items-center justify-center gap-2 transition-colors"
        >
          <Upload size={24} />
          Yükle
        </button>
      </div>
      
      {/* Hidden inputs */}
      <canvas ref={canvasRef} className="hidden" />
      <input 
        type="file" 
        accept="image/*" 
        className="hidden" 
        ref={fileInputRef} 
        onChange={handleFileUpload} 
      />
    </div>
  );
}
