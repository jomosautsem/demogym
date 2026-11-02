import React, { useState, useCallback } from 'react';
import Cropper from 'react-easy-crop';
import { Range, getTrackBackground, Direction } from 'react-range';
import { getCroppedImg } from '../utils/cropImage';

interface ImageCropperProps {
  imageSrc: string;
  onConfirm: (croppedImage: string) => void;
  onCancel: () => void;
}

const ImageCropper: React.FC<ImageCropperProps> = ({ imageSrc, onConfirm, onCancel }) => {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const onCropComplete = useCallback((croppedArea: any, croppedAreaPixels: any) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const handleConfirm = async () => {
    if (!croppedAreaPixels || !imageSrc) return;
    setIsProcessing(true);
    try {
      const croppedImage = await getCroppedImg(imageSrc, croppedAreaPixels);
      onConfirm(croppedImage);
    } catch (e) {
      console.error(e);
      alert('Hubo un error al recortar la imagen.');
    } finally {
      setIsProcessing(false);
    }
  };
  
  const btnPrimary = "bg-yellow-500 text-black font-tech font-bold uppercase tracking-widest px-6 py-3 hover:bg-yellow-400 active:translate-y-1 active:shadow-none transition-all shadow-[4px_4px_0px_0px_rgba(255,255,255,0.1)] border-2 border-yellow-600 disabled:opacity-50 disabled:cursor-not-allowed";
  const btnSecondary = "bg-zinc-800 text-yellow-500 font-tech font-bold uppercase tracking-widest px-6 py-3 hover:bg-zinc-700 active:translate-y-1 active:shadow-none transition-all shadow-[4px_4px_0px_0px_rgba(234,179,8,0.2)] border-2 border-zinc-600";

  return (
    <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex flex-col items-center justify-start overflow-y-auto py-8 animate-[fadeIn_0.3s_ease-out]">
      <div className="w-full max-w-lg mx-auto p-4">
        <div className="border-l-4 border-yellow-500 pl-4 mb-4">
            <h2 className="text-3xl font-tech font-bold text-white mb-1">AJUSTAR FOTOGRAFÍA</h2>
            <p className="text-zinc-500 font-mono-tech text-sm">ENCUADRE EL ROSTRO Y CONFIRME</p>
        </div>
        <div className="relative w-full aspect-[3/4] bg-zinc-900 border-2 border-zinc-800">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={3 / 4}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
            style={{
                containerStyle: { background: '#111' },
                cropAreaStyle: { border: '2px dashed rgba(234, 179, 8, 0.7)' }
            }}
          />
        </div>
        <div className="w-full p-4 bg-black/50 border-x-2 border-b-2 border-zinc-800">
            <label className="block text-center text-xs font-tech text-yellow-500/80 mb-4 uppercase tracking-widest">ZOOM</label>
            <div className="px-4">
                <Range
                    step={0.01}
                    min={1}
                    max={3}
                    values={[zoom]}
                    onChange={(values) => setZoom(values[0])}
                    direction={Direction.Right}
                    rtl={false}
                    draggableTrack={false}
                    allowOverlap={false}
                    disabled={isProcessing}
                    label="Zoom"
                    labelledBy="zoom-slider"
                    renderTrack={({ props, children }) => (
                    <div {...props} style={{ ...props.style, height: '6px', width: '100%', background: getTrackBackground({ values: [zoom], colors: ['#eab308', '#333'], min: 1, max: 3 })}}>
                        {children}
                    </div>
                    )}
                    renderThumb={({ props }) => (
                    <div {...props} key={props.key} style={{ ...props.style, height: '20px', width: '20px', backgroundColor: '#f1f5f9', border: '2px solid #eab308' }}/>
                    )}
                />
            </div>
        </div>
        <div className="flex gap-4 mt-8">
            <button onClick={onCancel} className={btnSecondary} disabled={isProcessing}>Volver a Tomar</button>
            <button onClick={handleConfirm} className={`${btnPrimary} flex-1`} disabled={isProcessing}>
            {isProcessing ? 'PROCESANDO...' : 'Confirmar Recorte'}
            </button>
        </div>
      </div>
    </div>
  );
};

export default ImageCropper;