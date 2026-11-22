import React from 'react';
import {
  ArrowUpRight,
  Building2,
  Zap,
  Clock,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { AdminOrder, WalletState } from '../types/wallet';
import { calculateCommission, formatINR } from '../utils/formatters';
import { TransactionsList } from './TransactionsList';
import { useLanguage } from '../i18n/LanguageContext';

interface WalletViewProps {
  state: WalletState;
  onSelectOrder: (order: AdminOrder) => void;
  onOpenWithdraw: () => void;
  onSettlePending: (txId: string) => void;
  onGoToPaymentApps: () => void;
}

function StatusBadge({ status }: { status: AdminOrder['status'] }) {
  const { t } = useLanguage();
  if (status === 'pending') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-amber-400/35 bg-amber-400/15 px-2 py-0.5 text-[11px] font-bold text-amber-300">
        <Clock className="h-3 w-3 shrink-0" />
        <span>{t.statusPending}</span>
      </span>
    );
  }
  if (status === 'success') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-emerald-400/35 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-300">
        <CheckCircle2 className="h-3 w-3 shrink-0" />
        <span>{t.statusSuccess}</span>
      </span>
    );
  }
  if (status === 'rejected') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-rose-500/35 bg-rose-500/15 px-2 py-0.5 text-[11px] font-bold text-rose-300">
        <XCircle className="h-3 w-3 shrink-0" />
        <span>{t.statusRejected}</span>
      </span>
    );
  }
  return null;
}

export const WalletView: React.FC<WalletViewProps> = ({
  state,
  onSelectOrder,
  onOpenWithdraw,
  onSettlePending,
  onGoToPaymentApps,
}) => {
  const { t } = useLanguage();
  const activeOrders = state.adminOrders.filter((o) => o.status === 'active');
  const submittedOrders = state.adminOrders.filter((o) => o.status !== 'active');
  const isLinked = Boolean(state.linkedPaymentApp);

  return (
    <div className="space-y-3.5">
      {/* Wallet Balance + Withdraw */}
      <div className="rounded-2xl border border-white/[0.08] bg-[#0F172A] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium text-slate-400">
              {t.walletBalanceWith11}
            </p>
            <p className="mt-0.5 font-mono text-2xl font-bold text-white tabular-nums">
              {formatINR(state.walletBalance)}
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenWithdraw}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-amber-400 px-3.5 text-xs font-bold text-[#070B14] transition-colors hover:bg-amber-300"
          >
            <Building2 className="h-3.5 w-3.5" />
            <span>{t.withdrawLabel}</span>
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Paid Order Statuses (Pending / Success / Rejected) */}
        <div className="mt-4 border-t border-white/[0.08] pt-3">
          <h2 className="text-xs font-bold text-slate-200">
            {t.paymentApprovalStatus} ({submittedOrders.length})
          </h2>
          {submittedOrders.length === 0 ? (
            <p className="mt-2 text-[11px] text-slate-500">
              {t.noSubmittedPayments}
            </p>
          ) : (
            <div className="mt-2 divide-y divide-white/[0.06] rounded-xl border border-white/[0.06] bg-[#080D1A] px-3">
              {submittedOrders.map((order) => {
                const { commission, totalReturn } = calculateCommission(order.amount);
                return (
                  <div
                    key={order.id}
                    className="flex items-center justify-between gap-2 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-bold text-white tabular-nums">
                          {formatINR(order.amount, false)}
                        </span>
                        <span className="font-mono text-[11px] font-bold text-emerald-300 tabular-nums">
                          +11% ({formatINR(commission, false)}) → {formatINR(totalReturn, false)}
                        </span>
                        <span className="font-mono text-[10px] text-slate-500">
                          {order.orderCode}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        {order.status === 'pending' && t.statusPendingAdmin}
                        {order.status === 'success' &&
                          `${t.approvedCreditedPrefix}${formatINR(totalReturn, false)}`}
                        {order.status === 'rejected' && t.rejectedNoBalance}
                      </p>
                    </div>
                    <StatusBadge status={order.status} />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Ready to Pay Orders */}
        <div className="mt-4 border-t border-white/[0.08] pt-3">
          <h2 className="text-xs font-bold text-slate-200">
            {t.activeOrdersTitle} ({isLinked ? activeOrders.length : 0})
          </h2>
          {!isLinked ? (
            <div className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-amber-400/25 bg-[#080D1A] px-3 py-2.5">
              <p className="text-[11px] text-slate-300">
                {t.linkAppToUnlock}
              </p>
              <button
                type="button"
                onClick={onGoToPaymentApps}
                className="h-8 shrink-0 rounded-lg bg-amber-400 px-3 text-[11px] font-bold text-[#070B14]"
              >
                {t.linkAppBtn}
              </button>
            </div>
          ) : activeOrders.length === 0 ? (
            <p className="mt-2 text-[11px] text-slate-500">{t.noActiveOrdersShort}</p>
          ) : (
            <div className="mt-2 space-y-2">
              {activeOrders.map((order) => {
                const { commission, totalReturn } = calculateCommission(order.amount);
                return (
                  <div
                    key={order.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-emerald-400/20 bg-[#080D1A] px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-mono text-sm font-bold text-white tabular-nums">
                          {formatINR(order.amount, false)}
                        </p>
                        <span className="font-mono text-[10px] text-slate-400">
                          {order.orderCode}
                        </span>
                      </div>
                      <p className="mt-0.5 font-mono text-[11px] font-bold text-emerald-300 tabular-nums">
                        +11% ({formatINR(commission, false)}) →{' '}
                        <span className="text-amber-300">
                          {t.walletReturnShort}: {formatINR(totalReturn, false)}
                        </span>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onSelectOrder(order)}
                      className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-amber-400 px-3 text-[11px] font-bold text-[#070B14]"
                    >
                      <Zap className="h-3 w-3 fill-current" />
                      {t.payNow}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <TransactionsList
        transactions={state.transactions}
        onSettlePending={onSettlePending}
      />
    </div>
  );
};
