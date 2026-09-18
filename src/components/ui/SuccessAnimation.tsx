import React, { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';

export interface SuccessToastData {
  id: string | number;
  message: string;
  submessage?: string;
}

/**
 * Global helper to trigger a standardized success feedback animation across the app.
 * Suitable for: saving entries, marking reminders done, recording payments, etc.
 */
export function triggerSuccessAnimation(message: string, submessage?: string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('goted_action_success', {
        detail: {
          id: `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          message,
          submessage,
        },
      })
    );
  }
}

/**
 * SuccessAnimationToast mounts in the root layout (App.tsx) and listens for success events,
 * showing an accessible, springy checkmark animation with clean typography.
 */
export const SuccessAnimationToast: React.FC = () => {
  const [current, setCurrent] = useState<SuccessToastData | null>(null);

  useEffect(() => {
    const handleSuccessEvent = (e: Event) => {
      const customEvent = e as CustomEvent<SuccessToastData>;
      if (customEvent.detail && customEvent.detail.message) {
        setCurrent(customEvent.detail);
      }
    };

    window.addEventListener('goted_action_success', handleSuccessEvent);
    return () => {
      window.removeEventListener('goted_action_success', handleSuccessEvent);
    };
  }, []);

  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(() => {
      setCurrent(null);
    }, 2500);
    return () => clearTimeout(timer);
  }, [current]);

  if (!current) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] max-w-sm sm:max-w-md w-[calc(100%-2rem)] pointer-events-auto select-none"
    >
      <div className="flex items-center gap-3 p-3 sm:p-3.5 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-emerald-500/30 dark:border-emerald-500/40 rounded-2xl shadow-lg shadow-emerald-950/10 dark:shadow-black/30 animate-success-toast">
        {/* Animated Checkmark Circle */}
        <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0 shadow-sm shadow-emerald-600/30">
          <Check className="w-5 h-5 sm:w-6 sm:h-6 stroke-[3] animate-success-pop" />
        </div>

        <div className="flex-1 min-w-0 pr-1">
          <p className="text-[13px] sm:text-[14px] font-bold text-gray-900 dark:text-slate-100 leading-tight truncate">
            {current.message}
          </p>
          {current.submessage && (
            <p className="text-[11px] sm:text-xs text-gray-500 dark:text-slate-400 mt-0.5 truncate">
              {current.submessage}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={() => setCurrent(null)}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-200 p-1 rounded-lg transition-colors cursor-pointer"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
