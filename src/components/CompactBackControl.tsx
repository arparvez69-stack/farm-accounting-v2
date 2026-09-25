import React from 'react';
import { ChevronLeft } from 'lucide-react';
import { useLanguage } from '../i18n/translations';

interface Props {
  canGoBack: boolean;
  onBack: () => void;
  backTitle?: string;
  activeTab?: string;
}

/**
 * Compact fixed Back control for mobile/small-screen viewports.
 * Stays fixed near the top-left of the viewport while scrolling long pages
 * without consuming vertical page space or obscuring main content.
 */
export const CompactBackControl: React.FC<Props> = ({
  canGoBack,
  onBack,
  backTitle,
  activeTab
}) => {
  const { language } = useLanguage();

  // Do not render on root dashboard or if there is no back history
  if (!canGoBack || activeTab === 'dashboard') {
    return null;
  }

  const label = backTitle || (language === 'en' ? 'Back' : 'ফিরে যান');

  return (
    <div
      className="fixed top-[calc(env(safe-area-inset-top,0px)+0.45rem)] left-[calc(env(safe-area-inset-left,0px)+0.45rem)] z-40 md:hidden pointer-events-none"
      id="compact-fixed-back-container"
    >
      <button
        type="button"
        id="btn-compact-fixed-back"
        onClick={onBack}
        aria-label={label}
        title={language === 'en' ? `Back: ${label}` : `পূর্ববর্তী ধাপে ফিরে যান: ${label}`}
        className="pointer-events-auto min-w-[44px] min-h-[44px] flex items-center justify-center p-1 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 active:scale-95 transition-all cursor-pointer"
      >
        <div className="w-8 h-8 rounded-full bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-gray-200/90 dark:border-slate-700/90 shadow-sm flex items-center justify-center text-gray-800 dark:text-slate-100 hover:bg-white dark:hover:bg-slate-800 hover:border-blue-500/80 transition-all">
          <ChevronLeft className="w-5 h-5 text-gray-700 dark:text-slate-200 stroke-[2.5] -ml-0.5" />
        </div>
      </button>
    </div>
  );
};
