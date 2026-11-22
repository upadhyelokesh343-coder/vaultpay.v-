import React from 'react';
import {
  ArrowRight,
  Clock,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Smartphone,
} from 'lucide-react';
import { AdminOrder } from '../types/wallet';
import { calculateCommission, formatINR } from '../utils/formatters';
import { useLanguage } from '../i18n/LanguageContext';

interface OrderGrabSectionProps {
  adminOrders: AdminOrder[];
  isPaymentAppLinked: boolean;
  onSelectOrder: (order: AdminOrder) => void;
  onGoToPaymentApps: () => void;
  showPaidStatuses?: boolean;
}

function OrderStatusBadge({ status }: { status: AdminOrder['status'] }) {
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

export const OrderGrabSection: React.FC<OrderGrabSectionProps> = ({
  adminOrders,
  isPaymentAppLinked,
  onSelectOrder,
  onGoToPaymentApps,
  showPaidStatuses = false,
}) => {
  const { t } = useLanguage();
  const activeOrders = adminOrders.filter((o) => o.status === 'active');
  const submittedOrders = showPaidStatuses
    ? adminOrders.filter((o) => o.status !== 'active')
    : [];

  return (
    <section
      aria-label={t.activeAdminOrders}
      className="rounded-2xl border border-white/[0.08] bg-[#0F172A] p-3.5"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-100">{t.activeAdminOrders}</h2>
        {isPaymentAppLinked && activeOrders.length > 0 && (
          <span className="font-mono text-[11px] font-semibold text-amber-300 tabular-nums">
            {activeOrders.length} {t.activeCountSuffix}
          </span>
        )}
      </div>

      {!isPaymentAppLinked ? (
        <div className="mt-2.5 flex items-center justify-between gap-3 rounded-xl border border-amber-400/25 bg-[#080D1A] px-3.5 py-3">
          <div className="flex items-center gap-2.5">
            <Smartphone className="h-4 w-4 shrink-0 text-amber-300" />
            <p className="text-[11px] leading-snug text-slate-300">
              {t.connectAppPrompt}
            </p>
          </div>
          <button
            type="button"
            onClick={onGoToPaymentApps}
            className="h-8 shrink-0 rounded-lg bg-amber-400 px-3 text-[11px] font-bold text-[#070B14] hover:bg-amber-300 whitespace-nowrap"
          >
            {t.connectAppBtn}
          </button>
        </div>
      ) : activeOrders.length === 0 && submittedOrders.length === 0 ? (
        <p className="py-4 text-center text-xs text-slate-500">
          {t.noActiveOrders}
        </p>
      ) : (
        <div className="mt-2.5 space-y-2.5">
          {activeOrders.map((order) => {
            const { commission, totalReturn } = calculateCommission(order.amount);
            return (
              <div
                key={order.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-[#080D1A] px-3.5 py-3 transition-colors hover:border-amber-400/35"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-lg font-bold text-white tabular-nums">
                      {formatINR(order.amount, false)}
                    </span>
                    <span className="font-mono text-[11px] text-slate-500">
                      {order.orderCode}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[11px] tabular-nums">
                    <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-bold text-emerald-300">
                      +11% ({formatINR(commission, false)})
                    </span>
                    <span className="font-bold text-amber-300">
                      → {t.walletReturnShort}: {formatINR(totalReturn, false)}
                    </span>
                  </div>
                  <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-emerald-400">
                    <ExternalLink className="h-3 w-3" />
                    <span>{t.paymentLinkReady}</span>
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => onSelectOrder(order)}
                  className="inline-flex h-9 shrink-0 items-center justify-center gap-1 rounded-xl bg-amber-400 px-3.5 text-xs font-bold text-[#070B14] transition-all hover:bg-amber-300 active:scale-[0.97] whitespace-nowrap"
                >
                  <span>{t.payNow}</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}

          {submittedOrders.length > 0 && (
            <div className="divide-y divide-white/[0.06] rounded-xl border border-white/[0.06] bg-[#080D1A] px-3.5">
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
                        {order.status === 'pending' && t.pendingApprovalShort}
                        {order.status === 'success' &&
                          `${t.approvedCreditedPrefix}${formatINR(totalReturn, false)}`}
                        {order.status === 'rejected' && t.rejectedNoBalance}
                      </p>
                    </div>
                    <OrderStatusBadge status={order.status} />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
