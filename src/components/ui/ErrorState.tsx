import React, { useState } from 'react';
import { AlertCircle, RotateCcw, AlertTriangle, X, ChevronDown, ChevronUp } from 'lucide-react';

export interface ErrorStateAction {
  label: string;
  onClick: () => void;
  icon?: React.ComponentType<{ className?: string }> | React.ReactNode;
  disabled?: boolean;
}

export interface ErrorStateProps {
  id?: string;
  title?: string;
  message: string;
  technicalDetails?: string;
  retryAction?: ErrorStateAction | (() => void);
  secondaryAction?: ErrorStateAction;
  onDismiss?: () => void;
  compact?: boolean;
  variant?: 'card' | 'inline' | 'banner';
  className?: string;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  id,
  title,
  message,
  technicalDetails,
  retryAction,
  secondaryAction,
  onDismiss,
  compact = false,
  variant = 'card',
  className = '',
}) => {
  const [showDetails, setShowDetails] = useState(false);

  // Normalize retryAction
  const retryObj: ErrorStateAction | undefined =
    typeof retryAction === 'function'
      ? { label: 'পুনরায় চেষ্টা করুন', onClick: retryAction, icon: RotateCcw }
      : retryAction;

  const renderActionIcon = (actionIcon: ErrorStateAction['icon']) => {
    if (!actionIcon) return null;
    if (React.isValidElement(actionIcon)) {
      return actionIcon;
    }
    const IconComponent = actionIcon as React.ComponentType<{ className?: string }>;
    return <IconComponent className="w-3.5 h-3.5 shrink-0" />;
  };

  // 1. INLINE VARIANT (For inside forms, under inputs, or tight containers)
  if (variant === 'inline') {
    return (
      <div
        id={id}
        role="alert"
        className={`flex items-start justify-between gap-2.5 p-3 rounded-xl bg-rose-50/90 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/60 text-rose-900 dark:text-rose-200 animate-fade-in ${className}`}
      >
        <div className="flex items-start gap-2 text-xs sm:text-[13px] leading-relaxed flex-1">
          <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            {title && <span className="font-bold block text-rose-800 dark:text-rose-300">{title}</span>}
            <span className="font-medium text-rose-700 dark:text-rose-300/90">{message}</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {retryObj && (
            <button
              type="button"
              onClick={retryObj.onClick}
              disabled={retryObj.disabled}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 hover:bg-rose-100 dark:hover:bg-slate-700 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-semibold shadow-2xs transition-colors cursor-pointer min-h-[32px] disabled:opacity-50"
            >
              {renderActionIcon(retryObj.icon || RotateCcw)}
              <span>{retryObj.label}</span>
            </button>
          )}
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss error"
              className="p-1 rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-100/80 dark:hover:bg-rose-900/40 transition-colors cursor-pointer min-h-[32px] min-w-[32px] flex items-center justify-center"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    );
  }

  // 2. BANNER VARIANT (Full width bar across top of tables or modules)
  if (variant === 'banner') {
    return (
      <div
        id={id}
        role="alert"
        className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 sm:p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/80 text-rose-900 dark:text-rose-200 animate-fade-in shadow-2xs ${className}`}
      >
        <div className="flex items-start gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-rose-100 dark:bg-rose-900/50 text-rose-600 dark:text-rose-300 flex items-center justify-center shrink-0 border border-rose-200 dark:border-rose-800">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div className="text-xs sm:text-sm">
            {title && <div className="font-bold text-rose-900 dark:text-rose-100">{title}</div>}
            <div className="text-rose-700 dark:text-rose-300 font-medium leading-relaxed">{message}</div>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
          {retryObj && (
            <button
              type="button"
              onClick={retryObj.onClick}
              disabled={retryObj.disabled}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 active:scale-98 text-white text-xs font-semibold shadow-xs transition-all cursor-pointer min-h-[36px] disabled:opacity-50"
            >
              {renderActionIcon(retryObj.icon || RotateCcw)}
              <span>{retryObj.label}</span>
            </button>
          )}
          {secondaryAction && (
            <button
              type="button"
              onClick={secondaryAction.onClick}
              disabled={secondaryAction.disabled}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-700 dark:text-slate-200 border border-gray-200 dark:border-slate-700 text-xs font-medium shadow-2xs transition-colors cursor-pointer min-h-[36px]"
            >
              {renderActionIcon(secondaryAction.icon)}
              <span>{secondaryAction.label}</span>
            </button>
          )}
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss error"
              className="p-1.5 rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-100 dark:hover:bg-rose-900/50 transition-colors cursor-pointer min-h-[36px] min-w-[36px] flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    );
  }

  // 3. CARD VARIANT (Default: For empty/failed tables, lists, or full sections)
  return (
    <div
      id={id}
      role="alert"
      className={`flex flex-col items-center justify-center text-center rounded-2xl border border-dashed border-rose-200 dark:border-rose-900/60 bg-rose-50/50 dark:bg-rose-950/20 ${
        compact ? 'p-4 sm:p-5' : 'p-6 sm:p-8'
      } ${className}`}
    >
      <div
        className={`rounded-xl bg-white dark:bg-slate-800 border border-rose-200/90 dark:border-rose-800/60 shadow-2xs flex items-center justify-center mb-3 shrink-0 text-rose-600 dark:text-rose-400 ${
          compact ? 'w-10 h-10' : 'w-12 h-12'
        }`}
      >
        <AlertCircle className={compact ? 'w-5 h-5' : 'w-6 h-6'} />
      </div>

      <h3
        className={`font-bold text-rose-900 dark:text-rose-100 ${
          compact ? 'text-xs sm:text-sm' : 'text-sm sm:text-base'
        }`}
      >
        {title || 'তথ্য লোড করতে সমস্যা হয়েছে'}
      </h3>

      <p
        className={`text-rose-700/90 dark:text-rose-300 mt-1 max-w-md mx-auto leading-relaxed ${
          compact ? 'text-[11px] sm:text-xs' : 'text-xs sm:text-sm'
        }`}
      >
        {message}
      </p>

      {/* Buttons */}
      <div className="mt-3.5 flex flex-wrap items-center justify-center gap-2">
        {retryObj && (
          <button
            type="button"
            onClick={retryObj.onClick}
            disabled={retryObj.disabled}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 active:scale-98 text-white text-xs sm:text-sm font-semibold shadow-xs transition-all cursor-pointer min-h-[44px] disabled:opacity-50"
          >
            {renderActionIcon(retryObj.icon || RotateCcw)}
            <span>{retryObj.label}</span>
          </button>
        )}

        {secondaryAction && (
          <button
            type="button"
            onClick={secondaryAction.onClick}
            disabled={secondaryAction.disabled}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-white dark:bg-slate-800 hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-700 dark:text-slate-200 border border-gray-200 dark:border-slate-700 text-xs sm:text-sm font-semibold shadow-2xs transition-colors cursor-pointer min-h-[44px]"
          >
            {renderActionIcon(secondaryAction.icon)}
            <span>{secondaryAction.label}</span>
          </button>
        )}

        {technicalDetails && (
          <button
            type="button"
            onClick={() => setShowDetails((prev) => !prev)}
            className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl text-rose-700 dark:text-rose-300 hover:bg-rose-100/60 dark:hover:bg-rose-900/30 text-xs font-semibold transition-colors cursor-pointer min-h-[44px]"
          >
            <span>{showDetails ? 'বিবরণ লুকান' : 'কারিগরি তথ্য'}</span>
            {showDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>

      {showDetails && technicalDetails && (
        <div className="mt-3 p-3 bg-white/80 dark:bg-slate-900/80 rounded-xl border border-rose-200/80 dark:border-rose-900/80 text-left w-full max-w-md text-[11px] text-rose-800 dark:text-rose-300 font-mono overflow-auto max-h-32 select-all whitespace-pre-wrap">
          {technicalDetails}
        </div>
      )}
    </div>
  );
};

export default ErrorState;
