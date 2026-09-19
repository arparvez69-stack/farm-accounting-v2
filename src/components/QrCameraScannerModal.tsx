import React, { useEffect, useRef, useState } from 'react';
import { Camera, X, RefreshCw, AlertCircle, Upload, CheckCircle2, ShieldAlert } from 'lucide-react';
import jsQR from 'jsqr';

interface QrCameraScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanSuccess: (scannedCode: string) => void;
}

/**
 * Decodes a QR code from a user-captured camera photo or image file using jsQR.
 * Handles high-resolution camera images by performing multi-scale detection passes.
 */
export function decodeQrFromImageFile(file: File): Promise<string | null> {
  return new Promise((resolve, reject) => {
    if (!file || file.size === 0) {
      reject(new Error('কোনো ফাইল নির্বাচন করা হয়নি।'));
      return;
    }

    const isImageMime = file.type && file.type.startsWith('image/');
    const isImageExt = /\.(jpe?g|png|webp|heic|heif|bmp|gif)$/i.test(file.name);
    if (!isImageMime && !isImageExt && file.type !== '') {
      reject(new Error('অনুগ্রহ করে একটি ছবি ফাইল নির্বাচন করুন বা ক্যামেরা দিয়ে ছবি তুলুন।'));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('ছবি পড়তে ব্যর্থ হয়েছে।'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('ছবি লোড করা যায়নি।'));
      img.onload = () => {
        const tryDecode = (width: number, height: number): string | null => {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return null;
          ctx.drawImage(img, 0, 0, width, height);
          const imageData = ctx.getImageData(0, 0, width, height);
          const res = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'attemptBoth'
          });
          return res ? res.data : null;
        };

        // 1. First pass: capped at 1200px max dimension for responsive performance
        let w = img.width;
        let h = img.height;
        if (w > 1200 || h > 1200) {
          if (w > h) {
            h = Math.round((h * 1200) / w);
            w = 1200;
          } else {
            w = Math.round((w * 1200) / h);
            h = 1200;
          }
        }
        let code = tryDecode(w, h);
        if (code) return resolve(code);

        // 2. Second pass: downscaled 800px if high camera resolution had pixel noise
        if (w > 800 || h > 800) {
          const maxDim = Math.max(img.width, img.height);
          const smallW = Math.round((img.width * 800) / maxDim);
          const smallH = Math.round((img.height * 800) / maxDim);
          code = tryDecode(smallW, smallH);
          if (code) return resolve(code);
        }

        // 3. Third pass: full original dimensions if downscaled attempts missed it
        if (img.width !== w) {
          code = tryDecode(img.width, img.height);
          if (code) return resolve(code);
        }

        resolve(null);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export const QrCameraScannerModal: React.FC<QrCameraScannerModalProps> = ({
  isOpen,
  onClose,
  onScanSuccess
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanAnimIdRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [cameraState, setCameraState] = useState<'IDLE' | 'STARTING' | 'STREAMING' | 'ERROR'>('IDLE');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isPermissionDenied, setIsPermissionDenied] = useState<boolean>(false);
  const [isScanningFile, setIsScanningFile] = useState<boolean>(false);
  const [scannedResult, setScannedResult] = useState<string | null>(null);

  // Safely stop all active camera tracks and animation frames
  const stopCameraStream = () => {
    if (scanAnimIdRef.current) {
      cancelAnimationFrame(scanAnimIdRef.current);
      scanAnimIdRef.current = null;
    }

    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach((track) => {
          track.stop();
        });
      } catch (err) {
        console.warn('Error stopping camera track:', err);
      }
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  // Frame scanner loop using jsQR
  const startScanLoop = () => {
    if (scanAnimIdRef.current) {
      cancelAnimationFrame(scanAnimIdRef.current);
      scanAnimIdRef.current = null;
    }

    const scanFrame = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (!video || !canvas) return;

      // Ensure video is actively playing and has dimensions > 0
      if (
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        video.videoWidth > 0 &&
        video.videoHeight > 0
      ) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'attemptBoth'
          });

          if (code && code.data && code.data.trim()) {
            const result = code.data.trim();
            setScannedResult(result);
            if (navigator.vibrate) {
              try {
                navigator.vibrate(80);
              } catch (_) {
                // Ignore vibration failure
              }
            }
            stopCameraStream();
            setTimeout(() => {
              onScanSuccess(result);
            }, 300);
            return;
          }
        }
      }

      scanAnimIdRef.current = requestAnimationFrame(scanFrame);
    };

    scanAnimIdRef.current = requestAnimationFrame(scanFrame);
  };

  // Directly initialize camera stream - must be called within user interaction
  const initCamera = async () => {
    stopCameraStream();
    setErrorMessage('');
    setIsPermissionDenied(false);
    setScannedResult(null);
    setCameraState('STARTING');

    // 1. Verify mediaDevices support and secure context (HTTPS / localhost)
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraState('ERROR');
      setErrorMessage(
        'আপনার ব্রাউজার বা ডিভাইসে সরাসরি লাইভ ক্যামেরা স্ট্রিম সমর্থন করে না। অনুগ্রহ করে নিচের "ছবি তুলে স্ক্যান করুন" বোতাম ব্যবহার করুন।'
      );
      return;
    }

    // 2. Request camera with ideal rear-facing camera configuration
    try {
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) {
        // Modal might have been closed while awaiting
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      // iOS Safari specific attributes configuration
      video.setAttribute('playsinline', 'true');
      video.setAttribute('webkit-playsinline', 'true');
      video.muted = true;
      video.autoplay = true;
      video.srcObject = stream;

      // Handle video metadata loaded event
      video.onloadedmetadata = () => {
        video
          .play()
          .then(() => {
            setCameraState('STREAMING');
            startScanLoop();
          })
          .catch((playErr) => {
            console.warn('Video play prevented:', playErr);
            // Some iOS modes require explicit play trigger
            setCameraState('STREAMING');
            startScanLoop();
          });
      };
    } catch (err: any) {
      console.error('Camera getUserMedia error:', err);
      setCameraState('ERROR');

      const isDenied =
        err.name === 'NotAllowedError' ||
        err.name === 'PermissionDeniedError' ||
        err.name === 'SecurityError';

      setIsPermissionDenied(isDenied);

      if (isDenied) {
        setErrorMessage(
          'ক্যামেরা ব্যবহারের অনুমতি প্রত্যাখ্যাত হয়েছে। আইফোনে ক্যামেরা পুনরায় চালু করতে: iPhone Settings > Safari > Camera (অথবা Settings > The Goated Farm > Camera) এ গিয়ে "Allow" বা অনুমতি চালু করুন।'
        );
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setErrorMessage('আপনার ডিভাইসে কোনো উপযুক্ত ব্যাক ক্যামেরা খুঁজে পাওয়া যায়নি।');
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        setErrorMessage('ক্যামেরাটি অন্য কোনো অ্যাপ ব্যবহার করছে। অনুগ্রহ করে অন্যান্য অ্যাপ বন্ধ করে পুনরায় চেষ্টা করুন।');
      } else {
        setErrorMessage(err.message || 'ক্যামেরা চালু করতে সমস্যা হয়েছে।');
      }
    }
  };

  // Start camera when modal opens, clean up when it closes
  useEffect(() => {
    if (isOpen) {
      initCamera();
    } else {
      stopCameraStream();
      setCameraState('IDLE');
      setScannedResult(null);
      setErrorMessage('');
      setIsPermissionDenied(false);
    }

    return () => {
      stopCameraStream();
    };
  }, [isOpen]);

  // Fallback: Handle snapshot / photo file upload scan
  const handleFallbackFileScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    try {
      setIsScanningFile(true);
      setErrorMessage('');
      const code = await decodeQrFromImageFile(file);
      if (!code) {
        setErrorMessage('ছবিতে কোনো কিউআর কোড (QR Code) পাওয়া যায়নি। অনুগ্রহ করে কাছে থেকে স্পষ্ট ছবি তুলুন।');
        return;
      }

      setScannedResult(code.trim());
      stopCameraStream();
      setTimeout(() => {
        onScanSuccess(code.trim());
      }, 300);
    } catch (err: any) {
      setErrorMessage(err.message || 'ছবি থেকে কিউআর কোড পড়তে ব্যর্থ হয়েছে।');
    } finally {
      setIsScanningFile(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-950 text-white">
          <div className="flex items-center gap-2">
            <Camera className="w-5 h-5 text-emerald-400" />
            <h3 className="font-bold text-sm text-slate-100">পশুর কিউআর কোড স্ক্যানার</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Viewfinder / Video Container */}
        <div className="relative w-full aspect-square bg-black flex items-center justify-center overflow-hidden">
          {/* Hidden Canvas for Decoding */}
          <canvas ref={canvasRef} className="hidden" />

          {/* HTML5 Video element with strictly required iOS Safari attributes */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-cover ${cameraState === 'STREAMING' ? 'opacity-100' : 'opacity-0'}`}
          />

          {/* Viewfinder Target Overlay */}
          {cameraState === 'STREAMING' && !scannedResult && (
            <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center p-8">
              <div className="relative w-56 h-56 border-2 border-emerald-400/70 rounded-2xl shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]">
                {/* Corner Accents */}
                <div className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-emerald-400 rounded-tl-lg" />
                <div className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-emerald-400 rounded-tr-lg" />
                <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-emerald-400 rounded-bl-lg" />
                <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-emerald-400 rounded-br-lg" />

                {/* Animated Scan Line */}
                <div className="absolute inset-x-2 h-0.5 bg-linear-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_8px_#34d399] animate-pulse top-1/2 -translate-y-1/2" />
              </div>
              <p className="mt-4 text-xs font-semibold text-emerald-300 text-center bg-black/60 px-3 py-1 rounded-full backdrop-blur-xs">
                কিউআর কোডটি ফ্রেমের মাঝে রাখুন
              </p>
            </div>
          )}

          {/* Success Detected Feedback */}
          {scannedResult && (
            <div className="absolute inset-0 bg-emerald-950/80 backdrop-blur-xs flex flex-col items-center justify-center p-6 text-center text-white">
              <CheckCircle2 className="w-16 h-16 text-emerald-400 mb-3 animate-bounce" />
              <h4 className="text-lg font-bold text-white mb-1">কিউআর কোড শনাক্ত হয়েছে!</h4>
              <p className="font-mono text-sm bg-black/40 px-3 py-1.5 rounded-lg border border-emerald-500/40 text-emerald-200">
                {scannedResult}
              </p>
            </div>
          )}

          {/* Starting / Loading Spinner */}
          {cameraState === 'STARTING' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-300 gap-3 p-6 text-center">
              <RefreshCw className="w-10 h-10 text-emerald-400 animate-spin" />
              <p className="text-sm font-medium">ক্যামেরা চালু হচ্ছে...</p>
              <p className="text-xs text-slate-400">অনুমতি চাইলে 'Allow' বা 'অনুমতি দিন' চাপুন</p>
            </div>
          )}

          {/* Camera Error / Permission Denied Screen */}
          {cameraState === 'ERROR' && (
            <div className="absolute inset-0 p-5 flex flex-col items-center justify-center text-center bg-slate-900 text-slate-200 overflow-y-auto">
              {isPermissionDenied ? (
                <ShieldAlert className="w-12 h-12 text-rose-500 mb-2 shrink-0" />
              ) : (
                <AlertCircle className="w-12 h-12 text-amber-400 mb-2 shrink-0" />
              )}

              <h4 className="font-bold text-sm text-white mb-1">
                {isPermissionDenied ? 'ক্যামেরা অনুমতি প্রত্যাখ্যাত' : 'ক্যামেরা চালু করা যায়নি'}
              </h4>

              <p className="text-xs text-slate-300 mb-4 max-w-xs leading-relaxed">
                {errorMessage}
              </p>

              {/* iOS Permission Step-by-Step Instructions */}
              {isPermissionDenied && (
                <div className="bg-slate-800/90 border border-slate-700 rounded-xl p-3 text-left text-[11px] text-slate-300 space-y-1.5 mb-4 w-full max-w-xs">
                  <div className="font-bold text-emerald-400 text-xs mb-1">আইফোনে সমাধান:</div>
                  <div>১. iPhone-এর <strong className="text-white">Settings</strong> অ্যাপে যান।</div>
                  <div>২. নিচে স্ক্রল করে <strong className="text-white">Safari</strong> (বা The Goated Farm) খুলুন।</div>
                  <div>৩. <strong className="text-white">Camera</strong> অপশনে গিয়ে <strong className="text-emerald-400">Allow</strong> নির্বাচন করুন।</div>
                  <div>৪. এরপর ব্রাউজারে ফিরে পেজ রিফ্রেশ করুন।</div>
                </div>
              )}

              <div className="flex flex-col gap-2 w-full max-w-xs">
                <button
                  type="button"
                  onClick={initCamera}
                  className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>পুনরায় চেষ্টা করুন</span>
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>ছবি তুলে বা ফাইল দিয়ে স্ক্যান করুন</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer Controls & Fallback */}
        <div className="p-3 bg-slate-950 border-t border-slate-800 flex items-center justify-between gap-2">
          {/* Hidden File Input for Capture / Upload Fallback */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleFallbackFileScan}
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isScanningFile}
            className="flex-1 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center justify-center gap-1.5 border border-slate-700 transition-colors cursor-pointer disabled:opacity-50"
            title="লাইভ ক্যামেরা কাজ না করলে ছবি তুলে বা গ্যালারি থেকে কিউআর কোড স্ক্যান করুন"
          >
            <Camera className="w-3.5 h-3.5 text-emerald-400" />
            <span>{isScanningFile ? 'ছবি প্রসেস হচ্ছে...' : 'ছবি তুলে স্ক্যান'}</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="py-2 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition-colors cursor-pointer"
          >
            বন্ধ করুন
          </button>
        </div>
      </div>
    </div>
  );
};
