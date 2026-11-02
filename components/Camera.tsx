
import React, { useRef, useEffect, useState } from 'react';

interface CameraProps {
  stream: MediaStream | null;
  error: string | null;
  onCapture?: (base64Image: string) => void;
  mode: 'capture' | 'scan'; // 'scan' mode effectively just view mode now
  isActive?: boolean;
  onSwitchCamera?: () => void;
}

const Camera: React.FC<CameraProps> = ({ 
  stream,
  error,
  onCapture, 
  mode, 
  isActive = true,
  onSwitchCamera
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isMirrored, setIsMirrored] = useState<boolean>(false); 

  // Capture helper
  const captureFrame = (returnImage = true): string | null => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      
      if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
          return null;
      }

      const context = canvas.getContext('2d');
      if (context) {
        const { videoWidth, videoHeight } = video;
        const targetAspectRatio = 3 / 4;
        let cropWidth, cropHeight, cropX, cropY;

        if ((videoWidth / videoHeight) > targetAspectRatio) {
            cropHeight = videoHeight;
            cropWidth = cropHeight * targetAspectRatio;
            cropX = (videoWidth - cropWidth) / 2;
            cropY = 0;
        } else {
            cropWidth = videoWidth;
            cropHeight = cropWidth / targetAspectRatio;
            cropX = 0;
            cropY = (videoHeight - cropHeight) / 2;
        }
        
        canvas.width = cropWidth;
        canvas.height = cropHeight;

        if (isMirrored) {
            context.translate(cropWidth, 0);
            context.scale(-1, 1);
        }

        context.drawImage(video, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
        
        if (returnImage) {
           return canvas.toDataURL('image/jpeg', 1.0); 
        }
      }
    }
    return null;
  };

  const handleManualCapture = () => {
    const img = captureFrame(true);
    if (img && onCapture) onCapture(img);
  };

  useEffect(() => {
    if (videoRef.current && stream) {
      const track = stream.getVideoTracks()[0];
      const settings = track?.getSettings();
      const shouldMirror = settings?.facingMode !== 'environment';
      setIsMirrored(shouldMirror);

      // FORCE VIDEO PLAY TO AVOID BLACK SCREEN
      videoRef.current.srcObject = stream;
      videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play().catch(e => console.warn("Video play failed:", e));
      };
    }
  }, [stream]);

  return (
    <div className="relative w-full h-full">
      <div className="relative overflow-hidden bg-black/80 h-full flex items-center justify-center">
        {error ? (
          <div className="flex flex-col items-center justify-center h-full w-full text-red-500 p-4 text-center border border-red-900/50 bg-red-950/20">
            <p className="font-tech text-lg">[SISTEMA]: {error}</p>
            {error.includes('DENEGADO') && (
              <p className="mt-4 text-sm text-zinc-400 font-sans max-w-md">
                Para usar la aplicación, necesitas permitir el acceso a la cámara en la configuración de tu navegador.
              </p>
            )}
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`absolute w-full h-full object-cover transition-all duration-700 ${isMirrored ? 'transform scale-x-[-1]' : 'transform scale-x-1'} ${!isActive || !stream ? 'opacity-20 grayscale' : 'opacity-100'}`}
            />
            <canvas ref={canvasRef} className="hidden" />
            
            <div className="absolute inset-0 bg-[linear-gradient(rgba(234,179,8,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(234,179,8,0.03)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none"></div>

            {/* BOTÓN CAMBIAR CÁMARA */}
            {onSwitchCamera && stream && (
                <button 
                    type="button"
                    onClick={onSwitchCamera}
                    className="absolute top-4 right-4 z-50 bg-black/50 text-white p-3 rounded-full border border-zinc-500 hover:bg-zinc-800 active:scale-95 transition-all"
                    title="Cambiar Cámara"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                </button>
            )}

            {mode === 'capture' && isActive && stream && (
              <div className="absolute bottom-6 left-0 right-0 flex justify-center z-30">
                <button
                  type="button"
                  onClick={handleManualCapture}
                  className="bg-yellow-500 text-black rounded-full p-4 shadow-[0_0_20px_rgba(234,179,8,0.6)] hover:bg-yellow-400 hover:scale-110 transition-all active:scale-95 border-2 border-white"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-8 h-8">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
                  </svg>
                </button>
              </div>
            )}

            {!stream && !error && (
              <div className="text-center font-mono-tech text-yellow-500 animate-pulse">
                INICIANDO CÁMARA...
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default Camera;