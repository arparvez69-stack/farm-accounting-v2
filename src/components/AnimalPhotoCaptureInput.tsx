import React, { useRef, useState } from 'react';
import { Camera, Image as ImageIcon, Trash2, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';

interface AnimalPhotoCaptureInputProps {
  photoUrl: string;
  onChange: (dataUrl: string) => void;
  onError?: (errorMsg: string) => void;
  label?: string;
}

/**
 * Compresses an image file client-side to a max dimension of 800px preserving aspect ratio,
 * and exports as JPEG base64 string to keep IndexedDB and Firestore lightweight.
 * Built with specific iOS Safari PWA compatibility.
 */
export function compressImageFile(file: File, maxDimension = 800, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file || file.size === 0) {
      reject(new Error('কোনো ছবি ফাইল নির্বাচন করা হয়নি।'));
      return;
    }

    // On iOS Safari camera capture, file.type can be empty or non-standard (e.g. image/heic)
    const isImageMime = file.type && file.type.startsWith('image/');
    const isImageExt = /\.(jpe?g|png|webp|heic|heif|bmp|gif)$/i.test(file.name || '');
    if (!isImageMime && !isImageExt && file.type !== '') {
      reject(new Error('অনুগ্রহ করে একটি ছবি ফাইল (JPEG, PNG, WebP) নির্বাচন করুন বা ক্যামেরা দিয়ে তুলুন।'));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('ছবি পড়তে ব্যর্থ হয়েছে। ক্যামেরা বা ফটো অ্যাক্সেস অনুমতি নিশ্চিত করুন।'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('ছবি প্রক্রিয়া করা যায়নি। ফাইলটি ক্ষতিগ্রস্ত বা অসমর্থিত ফরম্যাট হতে পারে।'));
      img.onload = () => {
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;

        if (!width || !height) {
          reject(new Error('ছবির মাপ নির্ধারণ করা সম্ভব হয়নি।'));
          return;
        }

        // Scale down both dimensions so max dimension is constrained to maxDimension (800px)
        const currentMax = Math.max(width, height);
        if (currentMax > maxDimension) {
          const ratio = maxDimension / currentMax;
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('ক্যানভাস প্রক্রিয়া করা সম্ভব হয়নি।'));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        try {
          const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
          if (!compressedBase64 || compressedBase64 === 'data:,') {
            reject(new Error('ছবির ডেটা রূপান্তর ব্যর্থ হয়েছে।'));
            return;
          }
          resolve(compressedBase64);
        } catch (e: any) {
          reject(new Error('ছবি এনকোড করতে ত্রুটি হয়েছে: ' + (e?.message || '')));
        }
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export const AnimalPhotoCaptureInput: React.FC<AnimalPhotoCaptureInputProps> = ({
  photoUrl,
  onChange,
  onError,
  label = 'পশুর ছবি (Animal Photo)'
}) => {
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [localError, setLocalError] = useState<string>('');
  const [showPermissionHelp, setShowPermissionHelp] = useState<boolean>(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset input value immediately so re-capturing or picking the same file fires onChange
    e.target.value = '';

    setIsProcessing(true);
    setLocalError('');
    setShowPermissionHelp(false);

    try {
      const compressedDataUrl = await compressImageFile(file, 800, 0.8);
      // Immediately update parent state so preview reflects the new photo without delay
      onChange(compressedDataUrl);
    } catch (err: any) {
      console.error('Photo processing error:', err);
      const errMsg = err?.message || 'ছবি প্রক্রিয়া করতে ব্যর্থ হয়েছে।';
      setLocalError(errMsg);
      if (onError) onError(errMsg);

      // Check if it might be permission related
      if (
        errMsg.toLowerCase().includes('permission') ||
        errMsg.toLowerCase().includes('অনুমতি') ||
        errMsg.toLowerCase().includes('ক্যামেরা')
      ) {
        setShowPermissionHelp(true);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRemovePhoto = () => {
    onChange('');
    setLocalError('');
    setShowPermissionHelp(false);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="block text-[13px] font-semibold text-gray-800 dark:text-slate-200">
          {label}
        </label>
        {photoUrl && (
          <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            ছবি সংযুক্ত আছে
          </span>
        )}
      </div>

      {/* Hidden file inputs: One for Rear Camera capture, one for Library/Gallery selection */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Photo Preview Container or Action Trigger */}
      {photoUrl ? (
        <div className="relative rounded-xl overflow-hidden border border-emerald-300 dark:border-emerald-700/60 bg-emerald-50/40 dark:bg-slate-800/60 p-2.5 flex flex-col sm:flex-row items-center gap-3">
          {/* Instant Updated Thumbnail */}
          <div className="relative w-28 h-28 sm:w-32 sm:h-32 rounded-lg overflow-hidden border border-gray-200 dark:border-slate-700 shrink-0 bg-black/5 shadow-xs">
            <img
              src={photoUrl}
              alt="পশুর ছবি প্রিভিউ"
              className="w-full h-full object-cover"
            />
          </div>

          <div className="flex-1 w-full space-y-2 text-center sm:text-left">
            <div className="text-xs text-gray-600 dark:text-slate-300">
              ছবিটি সফলভাবে প্রসেস করা হয়েছে (সর্বোচ্চ ৮০০ পিক্সেল ও অপ্টিমাইজড)।
            </div>

            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                disabled={isProcessing}
                className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs disabled:opacity-50"
              >
                <Camera className="w-3.5 h-3.5" />
                <span>ক্যামেরা দিয়ে পুনরায় তুলুন</span>
              </button>

              <button
                type="button"
                onClick={() => galleryInputRef.current?.click()}
                disabled={isProcessing}
                className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-700 hover:bg-gray-100 dark:hover:bg-slate-600 text-gray-700 dark:text-slate-200 border border-gray-300 dark:border-slate-600 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
              >
                <ImageIcon className="w-3.5 h-3.5" />
                <span>গ্যালারি পরিবর্তন</span>
              </button>

              <button
                type="button"
                onClick={handleRemovePhoto}
                disabled={isProcessing}
                className="px-2.5 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-900/60 text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                title="ছবি মুছে ফেলুন"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>মুছুন</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border-2 border-dashed border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800/40 p-3.5 text-center">
          {isProcessing ? (
            <div className="py-4 flex flex-col items-center justify-center text-gray-500 dark:text-slate-400 gap-2">
              <RefreshCw className="w-6 h-6 text-emerald-600 animate-spin" />
              <span className="text-xs font-medium">ছবি সাইজ অপ্টিমাইজ ও লোড হচ্ছে...</span>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-center gap-2.5">
                {/* Primary Button: Directly triggers iOS rear camera via capture="environment" */}
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer min-h-[38px]"
                >
                  <Camera className="w-4 h-4" />
                  <span>ক্যামেরা দিয়ে ছবি তুলুন (Rear Camera)</span>
                </button>

                {/* Secondary Button: Gallery or File Picker */}
                <button
                  type="button"
                  onClick={() => galleryInputRef.current?.click()}
                  className="px-4 py-2 rounded-xl bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-800 dark:text-slate-200 border border-gray-300 dark:border-slate-600 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer min-h-[38px]"
                >
                  <ImageIcon className="w-4 h-4 text-emerald-600" />
                  <span>গ্যালারি থেকে নির্বাচন</span>
                </button>
              </div>

              <p className="text-[11px] text-gray-500 dark:text-slate-400">
                ছবি স্বয়ংক্রিয়ভাবে অপ্টিমাইজ হয়ে (সর্বোচ্চ ৮০০ পিক্সেল) যুক্ত হবে।
              </p>
            </div>
          )}
        </div>
      )}

      {/* Error Message Feedback */}
      {localError && (
        <div className="flex items-start gap-1.5 p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-400 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="flex-1">{localError}</div>
        </div>
      )}

      {/* iOS Settings Guidance for Camera Permission */}
      {showPermissionHelp && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-900/60 rounded-xl p-3 text-xs text-amber-900 dark:text-amber-200 space-y-1">
          <div className="font-bold text-amber-800 dark:text-amber-300">
            আইফোনে ক্যামেরা অনুমতি চালু করার নিয়ম:
          </div>
          <div>১. iPhone-এর <strong className="font-semibold">Settings</strong> অ্যাপে যান।</div>
          <div>২. স্ক্রল করে <strong className="font-semibold">Safari</strong> (অথবা The Goated Farm অ্যাপ) নির্বাচন করুন।</div>
          <div>৩. <strong className="font-semibold">Camera</strong> অপশনে গিয়ে <strong className="font-semibold text-emerald-800 dark:text-emerald-400">Allow</strong> দিন।</div>
        </div>
      )}
    </div>
  );
};
