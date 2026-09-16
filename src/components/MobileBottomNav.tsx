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
    { id: 'accounting', label: 'হিসাব', icon: BookOpen },
    { id: 'operations', label: 'খামার', icon: Tractor },
    { id: 'commerce', label: 'মজুদ/বিক্রয়', icon: Package },
    { id: 'finance', label: 'ব্যাংক/ঋণ', icon: Landmark },
    { id: 'reports', label: 'রিপোর্ট', icon: FileSpreadsheet },
    { id: 'more', label: 'মেনু', icon: Menu }
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-gray-200 pb-safe pt-1 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
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
                  ? 'text-[#1E5128] font-bold'
                  : 'text-gray-500 hover:text-gray-900 font-medium'
              }`}
            >
              <div
                className={`p-1.5 rounded-xl transition-all ${
                  isActive ? 'bg-[#F0FDF4] text-[#1E5128]' : 'text-gray-500'
                }`}
              >
                <Icon className={`w-5 h-5 ${isActive ? 'stroke-[2.5]' : 'stroke-[1.8]'}`} />
              </div>
              <span className="text-[11px] leading-tight mt-0.5 tracking-tight">
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

