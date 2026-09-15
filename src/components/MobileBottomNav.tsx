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
  const tabs: { id: ActiveTab; label: string; icon: React.ElementType }[] = [
    { id: 'dashboard', label: 'ড্যাশবোর্ড', icon: LayoutDashboard },
    { id: 'accounting', label: 'হিসাবরক্ষণ', icon: BookOpen },
    { id: 'operations', label: 'খামার', icon: Tractor },
    { id: 'commerce', label: 'মজুদ/বিক্রয়', icon: Package },
    { id: 'finance', label: 'ব্যাংক/ঋণ', icon: Landmark },
    { id: 'reports', label: 'রিপোর্ট', icon: FileSpreadsheet },
    { id: 'more', label: 'আরও', icon: Menu }
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-slate-900/98 backdrop-blur border-t border-slate-800 pb-safe shadow-2xl">
      <div className="flex items-center justify-around px-1 py-1 max-w-lg mx-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onChangeTab(tab.id)}
              className={`flex flex-col items-center justify-center min-w-[48px] py-1 px-1 rounded-xl transition-all ${
                isActive
                  ? 'text-emerald-400 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <div
                className={`p-1 rounded-lg transition-colors ${
                  isActive ? 'bg-emerald-950/80' : ''
                }`}
              >
                <Icon className="w-5 h-5" />
              </div>
              <span className="text-[10px] tracking-tight leading-tight mt-0.5">
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
