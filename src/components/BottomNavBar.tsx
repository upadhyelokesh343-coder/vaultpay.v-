import React from 'react';
import { Home, CreditCard, Wallet, BarChart3, User } from 'lucide-react';
import { NavTab } from '../types/wallet';
import { useLanguage } from '../i18n/LanguageContext';

interface BottomNavBarProps {
  activeTab: NavTab;
  pendingCount: number;
  onSelectTab: (tab: NavTab) => void;
}

export const BottomNavBar: React.FC<BottomNavBarProps> = ({
  activeTab,
  pendingCount,
  onSelectTab,
}) => {
  const { t } = useLanguage();

  return (
    <nav
      aria-label={t.navAria}
      className="fixed right-0 bottom-0 left-0 z-40"
    >
      <div className="mx-auto max-w-[430px] border-t border-white/[0.08] bg-[#090F1E]/95 backdrop-blur-md">
        <div className="grid h-14 grid-cols-5 items-center px-1">
          {/* 1. Home */}
          <button
            type="button"
            onClick={() => onSelectTab('home')}
            className={`flex h-12 flex-col items-center justify-center gap-0.5 transition-colors ${
              activeTab === 'home' ? 'text-amber-300' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Home className="h-4 w-4" />
            <span className="text-[10px] font-medium">{t.navHome}</span>
          </button>

          {/* 2. Payment (UPI Apps Verification) */}
          <button
            type="button"
            onClick={() => onSelectTab('payment')}
            className={`flex h-12 flex-col items-center justify-center gap-0.5 transition-colors ${
              activeTab === 'payment' ? 'text-amber-300' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <CreditCard className="h-4 w-4" />
            <span className="text-[10px] font-medium">{t.navPayment}</span>
          </button>

          {/* 3. Raised Center Wallet Button */}
          <div className="relative flex items-center justify-center">
            <button
              type="button"
              onClick={() => onSelectTab('order')}
              aria-label={t.navWalletAria}
              className={`relative -mt-5 flex h-12 w-12 items-center justify-center rounded-2xl border-2 shadow-lg transition-transform active:scale-95 ${
                activeTab === 'order'
                  ? 'border-amber-200 bg-gradient-to-br from-amber-300 to-amber-500 text-[#070B14] shadow-amber-500/30'
                  : 'border-[#070B14] bg-gradient-to-br from-amber-400 to-amber-500 text-[#070B14] shadow-amber-500/20'
              }`}
            >
              <Wallet className="h-5 w-5" />
              {pendingCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full border border-[#070B14] bg-emerald-400 px-1 font-mono text-[9px] font-bold text-[#05130E] tabular-nums">
                  {pendingCount}
                </span>
              )}
            </button>
          </div>

          {/* 4. Statistics */}
          <button
            type="button"
            onClick={() => onSelectTab('statistics')}
            className={`flex h-12 flex-col items-center justify-center gap-0.5 transition-colors ${
              activeTab === 'statistics'
                ? 'text-amber-300'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <BarChart3 className="h-4 w-4" />
            <span className="text-[10px] font-medium">{t.navStatistics}</span>
          </button>

          {/* 5. My */}
          <button
            type="button"
            onClick={() => onSelectTab('my')}
            className={`flex h-12 flex-col items-center justify-center gap-0.5 transition-colors ${
              activeTab === 'my' ? 'text-amber-300' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <User className="h-4 w-4" />
            <span className="text-[10px] font-medium">{t.navMy}</span>
          </button>
        </div>
      </div>
    </nav>
  );
};
