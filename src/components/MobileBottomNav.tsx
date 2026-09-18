import React from 'react';
import {
  LayoutDashboard,
  BookOpen,
  Tractor,
  Package,
  Landmark,
  FileSpreadsheet,
  Menu
} from 'lucide-react';
import { useLanguage, t } from '../i18n/translations';

export type ActiveTab =
  | 'dashboard'
  | 'accounting'
  | 'operations'
  | 'commerce'
  | 'finance'
  | 'reports'
  | 'more';

interface Props {
  activeTab: ActiveTab;
  onChangeTab: (tab: ActiveTab) => void;
}

export const MobileBottomNav: React.FC<Props> = ({ activeTab, onChangeTab }) => {
  const { language } = useLanguage();

  const tabs: { id: ActiveTab; labelKey: string; icon: React.ElementType }[] = [
    { id: 'dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard },
    { id: 'accounting', labelKey: 'nav.accounting', icon: BookOpen },
    { id: 'operations', labelKey: 'nav.operations', icon: Tractor },
    { id: 'commerce', labelKey: 'nav.commerce', icon: Package },
    { id: 'finance', labelKey: 'nav.finance', icon: Landmark },
    { id: 'reports', labelKey: 'nav.reports', icon: FileSpreadsheet },
    { id: 'more', labelKey: 'nav.more', icon: Menu }
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-gray-200 dark:border-slate-800 pb-safe pt-1 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] dark:shadow-[0_-4px_16px_rgba(0,0,0,0.3)] transition-colors">
      <div className="flex items-center justify-around px-1 max-w-lg mx-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onChangeTab(tab.id)}
              className={`flex flex-col items-center justify-center min-w-[44px] min-h-[50px] py-1 px-1 rounded-xl transition-all cursor-pointer active:scale-95 ${
                isActive
                  ? 'text-[#1E5128] dark:text-emerald-400 font-bold'
                  : 'text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-100 font-medium'
              }`}
            >
              <div
                className={`p-1.5 rounded-xl transition-all ${
                  isActive ? 'bg-[#F0FDF4] dark:bg-emerald-950/70 text-[#1E5128] dark:text-emerald-400' : 'text-gray-500 dark:text-slate-400'
                }`}
              >
                <Icon className={`w-5 h-5 ${isActive ? 'stroke-[2.5]' : 'stroke-[1.8]'}`} />
              </div>
              <span className="text-[11px] leading-tight mt-0.5 tracking-tight">
                {t(tab.labelKey, language)}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

