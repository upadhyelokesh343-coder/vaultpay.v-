import React from 'react';
import { TrendingUp, Award, Layers, Wallet } from 'lucide-react';
import { WalletState } from '../types/wallet';
import { formatINR } from '../utils/formatters';
import { TransactionsList } from './TransactionsList';
import { useLanguage } from '../i18n/LanguageContext';

interface StatisticsViewProps {
  state: WalletState;
  onSettlePending: (txId: string) => void;
}

export const StatisticsView: React.FC<StatisticsViewProps> = ({
  state,
  onSettlePending,
}) => {
  const { t } = useLanguage();

  const orderTransactions = state.transactions
    .filter((t) => t.type === 'order_payout' && t.status === 'Success')
    .slice(0, 7)
    .reverse();

  const maxChartCommission = Math.max(
    110,
    ...orderTransactions.map((tx) => tx.commissionAmount ?? 0)
  );

  const metrics = [
    {
      label: t.statEarned11,
      value: formatINR(state.totalCashbackEarned),
      icon: TrendingUp,
      highlight: 'text-emerald-400',
    },
    {
      label: t.statApproved,
      value: String(state.completedOrdersCount),
      icon: Layers,
      highlight: 'text-amber-300',
    },
    {
      label: t.statTotalPaid,
      value: formatINR(state.totalPaid),
      icon: Wallet,
      highlight: 'text-slate-100',
    },
    {
      label: t.statRate,
      value: '11.0%',
      icon: Award,
      highlight: 'text-amber-300',
    },
  ];

  return (
    <div className="space-y-3.5">
      <div className="grid grid-cols-2 gap-2.5">
        {metrics.map((m) => {
          const Icon = m.icon;
          return (
            <div
              key={m.label}
              className="rounded-2xl border border-white/[0.08] bg-[#0F172A] p-3.5"
            >
              <div className="flex items-center justify-between text-slate-400">
                <span className="text-[11px] font-medium">{m.label}</span>
                <Icon className="h-3.5 w-3.5 text-amber-300" />
              </div>
              <p
                className={`mt-1.5 font-mono text-lg font-bold tabular-nums ${m.highlight}`}
              >
                {m.value}
              </p>
            </div>
          );
        })}
      </div>

      <div className="rounded-2xl border border-white/[0.08] bg-[#0F172A] p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-100">
              {t.cashbackChartTitle}
            </h2>
            <p className="text-[11px] text-slate-400">
              {t.latestApprovedOrders}
            </p>
          </div>
          <span className="font-mono text-xs font-semibold text-emerald-400 tabular-nums">
            +{formatINR(state.totalCashbackEarned)}
          </span>
        </div>

        {orderTransactions.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-white/10 bg-[#080D1A] py-8 text-center">
            <p className="text-xs font-medium text-slate-300">
              {t.noApprovedPayoutsYet}
            </p>
          </div>
        ) : (
          <div className="mt-4 flex h-36 items-end justify-around gap-2 rounded-xl border border-white/[0.06] bg-[#080D1A] px-3 pt-5 pb-2.5">
            {orderTransactions.map((tx, idx) => {
              const comm = tx.commissionAmount ?? 0;
              const heightPct = Math.max(16, Math.round((comm / maxChartCommission) * 100));
              return (
                <div
                  key={tx.id}
                  className="flex h-full flex-1 flex-col items-center justify-end gap-1.5"
                >
                  <span className="font-mono text-[10px] font-semibold text-emerald-400 tabular-nums">
                    +₹{comm.toFixed(0)}
                  </span>
                  <div className="flex w-full max-w-[32px] flex-1 items-end">
                    <div
                      style={{ height: `${heightPct}%` }}
                      className="w-full rounded-t-lg bg-gradient-to-t from-emerald-500 to-amber-300"
                    />
                  </div>
                  <span className="font-mono text-[10px] text-slate-400 tabular-nums">
                    #{idx + 1}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <TransactionsList
        transactions={state.transactions}
        onSettlePending={onSettlePending}
      />
    </div>
  );
};
