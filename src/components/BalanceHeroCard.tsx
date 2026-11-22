import React from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import { formatINR } from '../utils/formatters';
import { useLanguage } from '../i18n/LanguageContext';

interface BalanceHeroCardProps {
  walletBalance: number;
  totalPaid: number;
  totalWithdrawal: number;
  totalCashbackEarned: number;
  onOpenWallet: () => void;
  onOpenWithdraw: () => void;
}

export const BalanceHeroCard: React.FC<BalanceHeroCardProps> = ({
  walletBalance,
  totalPaid,
  totalWithdrawal,
  totalCashbackEarned,
  onOpenWallet,
  onOpenWithdraw,
}) => {
  const { t } = useLanguage();

  return (
    <section aria-label={t.heroSectionAria} className="space-y-2.5">
      {/* Compact Mobile Hero Card */}
      <div className="relative overflow-hidden rounded-2xl border border-amber-400/25 bg-gradient-to-br from-[#121D38] via-[#0D1529] to-[#090F1E] p-4 shadow-lg shadow-black/40">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-14 -right-14 h-36 w-36 rounded-full bg-amber-400/10 blur-2xl"
        />
        <div
          aria-hidden="true"
          className="vp-card-shimmer pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-amber-300/[0.07] to-transparent"
        />

        <div className="relative z-10 space-y-3">
          <div className="flex items-center justify-between gap-2 border-b border-white/[0.08] pb-2.5">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-amber-400/35 bg-amber-400/15 text-amber-300">
                <TrendingUp className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xs font-bold text-amber-300">
                  {t.instantCashbackTitle}
                </p>
                <p className="text-[11px] text-slate-400">
                  {t.creditedOnApproval}
                </p>
              </div>
            </div>

            <div className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-300">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
              <span className="font-mono tabular-nums">+11%</span>
            </div>
          </div>

          <div>
            <p className="text-[11px] font-medium text-slate-400">
              {t.walletBalanceWith11}
            </p>
            <p className="mt-0.5 font-mono text-2xl font-bold tracking-tight text-white tabular-nums">
              {formatINR(walletBalance)}
            </p>
            <p className="mt-1 text-[11px] text-slate-400">
              {t.earned11}{' '}
              <strong className="font-mono font-semibold text-emerald-400 tabular-nums">
                +{formatINR(totalCashbackEarned)}
              </strong>
            </p>
          </div>
        </div>
      </div>

      {/* Compact Two-Column Paid & Withdrawal Strip */}
      <div className="grid grid-cols-2 divide-x divide-white/[0.08] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0F172A]">
        <div className="flex items-center justify-between gap-2 px-3 py-2.5">
          <div className="min-w-0">
            <div className="flex items-center gap-1 text-[11px] font-medium text-slate-400">
              <ArrowDownLeft className="h-3 w-3 text-emerald-400" />
              <span>{t.paidLabel}</span>
            </div>
            <p className="mt-0.5 truncate font-mono text-sm font-bold text-slate-100 tabular-nums">
              {formatINR(totalPaid)}
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenWallet}
            className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-emerald-400/30 bg-emerald-500/15 px-2.5 text-[11px] font-semibold text-emerald-300 active:scale-[0.97] whitespace-nowrap"
          >
            {t.walletBtn}
          </button>
        </div>

        <div className="flex items-center justify-between gap-2 px-3 py-2.5">
          <div className="min-w-0">
            <div className="flex items-center gap-1 text-[11px] font-medium text-slate-400">
              <ArrowUpRight className="h-3 w-3 text-amber-400" />
              <span>{t.withdrawLabel}</span>
            </div>
            <p className="mt-0.5 truncate font-mono text-sm font-bold text-slate-100 tabular-nums">
              {formatINR(totalWithdrawal)}
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenWithdraw}
            className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-white/[0.06] px-2.5 text-[11px] font-semibold text-slate-200 active:scale-[0.97] whitespace-nowrap"
          >
            {t.outBtn}
          </button>
        </div>
      </div>
    </section>
  );
};
