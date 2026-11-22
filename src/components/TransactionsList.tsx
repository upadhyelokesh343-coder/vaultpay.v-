import React, { useState } from 'react';
import {
  ArrowUpRight,
  CheckCircle2,
  Clock,
  TrendingUp,
  XCircle,
  Gift,
  Users,
} from 'lucide-react';
import { Transaction, TransactionStatus } from '../types/wallet';
import { formatINR } from '../utils/formatters';
import { useLanguage } from '../i18n/LanguageContext';
import { localizeTransaction } from '../i18n/localizeRecords';

interface TransactionsListProps {
  transactions: Transaction[];
  initialFilter?: 'all' | 'payouts' | 'withdrawals';
  compactLimit?: number;
  onSeeAll?: () => void;
  onSettlePending?: (txId: string) => void;
}

function StatusIndicator({ status }: { status: TransactionStatus }) {
  const { t } = useLanguage();
  if (status === 'Success') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        <span>{t.statusSuccess}</span>
      </span>
    );
  }
  if (status === 'Pending') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-amber-400/15 px-2 py-0.5 text-xs font-semibold text-amber-300">
        <Clock className="h-3.5 w-3.5 shrink-0" />
        <span>{t.statusPending}</span>
      </span>
    );
  }
  if (status === 'Rejected') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/15 px-2 py-0.5 text-xs font-semibold text-rose-400">
        <XCircle className="h-3.5 w-3.5 shrink-0" />
        <span>{t.statusRejected}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-white/[0.06] px-2 py-0.5 text-xs font-medium text-slate-400">
      <XCircle className="h-3.5 w-3.5 shrink-0" />
      <span>{t.statusClosed}</span>
    </span>
  );
}

export const TransactionsList: React.FC<TransactionsListProps> = ({
  transactions,
  initialFilter = 'all',
  compactLimit,
  onSeeAll,
  onSettlePending,
}) => {
  const { lang, t } = useLanguage();
  const [filter, setFilter] = useState<'all' | 'payouts' | 'withdrawals'>(
    initialFilter
  );
  const [showAllInline, setShowAllInline] = useState(false);

  const filtered = transactions.filter((tx) => {
    if (filter === 'all') return true;
    if (filter === 'payouts')
      return (
        tx.type === 'order_payout' ||
        tx.type === 'daily_bonus' ||
        tx.type === 'referral_bonus'
      );
    if (filter === 'withdrawals') return tx.type === 'withdrawal';
    return true;
  });

  const visibleRows =
    compactLimit && !showAllInline ? filtered.slice(0, compactLimit) : filtered;

  return (
    <section
      aria-label={t.txHistoryTitle}
      className="rounded-3xl border border-white/[0.08] bg-[#0F172A] p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-100">
            {t.txHistoryTitle}
          </h2>
          <p className="text-xs text-slate-400">{t.txHistorySubtitle}</p>
        </div>

        {onSeeAll ? (
          <button
            type="button"
            onClick={() => {
              setShowAllInline((v) => !v);
              onSeeAll();
            }}
            className="min-h-[36px] text-xs font-semibold text-amber-300 hover:text-amber-200 whitespace-nowrap"
          >
            {showAllInline ? t.showLess : t.seeAll}
          </button>
        ) : null}
      </div>

      {/* Filter Tabs */}
      <div className="mt-3.5 flex items-center gap-1 overflow-x-auto rounded-xl bg-[#090F1D] p-1">
        {(
          [
            { id: 'all', label: t.filterAll },
            { id: 'payouts', label: t.filterPayouts },
            { id: 'withdrawals', label: t.filterWithdrawals },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setFilter(tab.id)}
            className={`min-h-[36px] flex-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === tab.id
                ? 'bg-[#192646] text-amber-300 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Rows */}
      <div className="mt-3 divide-y divide-white/[0.06]">
        {visibleRows.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm font-medium text-slate-300">
              {t.noTransactionsYet}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {t.noTransactionsHint}
            </p>
          </div>
        ) : (
          visibleRows.map((tx) => {
            const isWithdrawal = tx.type === 'withdrawal';
            const isOrder = tx.type === 'order_payout';
            const isBonus = tx.type === 'daily_bonus';
            const isReferral = tx.type === 'referral_bonus';
            const localized = localizeTransaction(tx, lang);

            const iconBox =
              tx.status === 'Rejected'
                ? 'border-rose-500/30 bg-rose-500/10 text-rose-400'
                : tx.status === 'Pending'
                ? 'border-amber-400/30 bg-amber-400/10 text-amber-300'
                : isOrder || isBonus || isReferral
                ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-300'
                : 'border-rose-400/25 bg-rose-500/10 text-rose-300';

            const IconComp = isOrder
              ? TrendingUp
              : isReferral
              ? Users
              : isBonus
              ? Gift
              : ArrowUpRight;

            return (
              <div
                key={tx.id}
                className="flex items-center justify-between gap-3 py-3.5 first:pt-2 last:pb-1"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${iconBox}`}
                  >
                    <IconComp className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-100">
                      {localized.title}
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
                      <span className="truncate">{localized.subtitle}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 font-mono text-[11px] text-slate-500 tabular-nums">
                      <span>{tx.timestamp}</span>
                      <span aria-hidden="true">·</span>
                      <span>{tx.referenceId}</span>
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span
                    className={`font-mono text-sm font-bold tabular-nums sm:text-base ${
                      tx.status === 'Closed' || tx.status === 'Rejected'
                        ? 'text-slate-500 line-through'
                        : tx.status === 'Pending'
                        ? 'text-amber-300'
                        : isWithdrawal
                        ? 'text-rose-300'
                        : 'text-emerald-400'
                    }`}
                  >
                    {isWithdrawal ? '-' : tx.status === 'Rejected' || tx.status === 'Closed' ? '' : '+'}
                    {formatINR(tx.amount)}
                  </span>

                  <div className="flex items-center gap-2">
                    <StatusIndicator status={tx.status} />
                    {tx.status === 'Pending' && tx.type === 'withdrawal' && onSettlePending && (
                      <button
                        type="button"
                        onClick={() => onSettlePending(tx.id)}
                        className="text-[11px] font-semibold text-amber-300 underline underline-offset-2 hover:text-amber-200"
                      >
                        {t.settleBtn}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};
