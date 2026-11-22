import React, { useState } from 'react';
import {
  CheckCircle2,
  Smartphone,
  Lock,
  ShieldCheck,
  X,
  ArrowRight,
  LogOut,
} from 'lucide-react';
import { LinkedPaymentApp } from '../types/wallet';
import { useLanguage } from '../i18n/LanguageContext';

interface PaymentAppOption {
  id: string;
  name: string;
}

const PAYMENT_APPS: PaymentAppOption[] = [
  { id: 'ybl', name: 'PhonePe' },
  { id: 'paytm', name: 'Paytm' },
  { id: 'okaxis', name: 'Google Pay' },
  { id: 'upi', name: 'BHIM UPI' },
  { id: 'apl', name: 'Amazon Pay' },
  { id: 'ikwik', name: 'MobiKwik' },
];

const PaymentAppLogo: React.FC<{ appId: string; size?: 'sm' | 'md' }> = ({
  appId,
  size = 'md',
}) => {
  const boxClass =
    size === 'sm' ? 'h-7 w-7 rounded-lg' : 'h-10 w-10 rounded-xl';

  switch (appId) {
    case 'ybl':
      // PhonePe official purple badge with white Devanagari "पे"
      return (
        <div
          className={`flex shrink-0 items-center justify-center bg-[#5F259F] shadow-sm ${boxClass}`}
        >
          <svg
            viewBox="0 0 40 40"
            className="h-6 w-6"
            aria-hidden="true"
          >
            <path
              d="M11 12.5h18.5v3.2h-2.8v12.8h-3.6V15.7h-6.1v5.6c0 2.5 1.1 3.7 3.2 3.7.8 0 1.6-.2 2.2-.5v3.1c-.9.4-2 .6-3.1.6-3.7 0-5.9-2.2-5.9-6.2v-6.3H11v-3.2Z"
              fill="#FFFFFF"
            />
            <path
              d="M23.2 12.5 18.6 7.4l2.4-2 5.4 6.2-3.2.9Z"
              fill="#FFFFFF"
            />
          </svg>
        </div>
      );

    case 'paytm':
      // Paytm dual-tone official Pay + tm emblem
      return (
        <div
          className={`flex shrink-0 items-center justify-center bg-white shadow-sm ${boxClass}`}
        >
          <svg
            viewBox="0 0 48 48"
            className="h-8 w-8"
            aria-hidden="true"
          >
            <text
              x="5"
              y="26"
              fill="#002970"
              fontFamily="system-ui, -apple-system, sans-serif"
              fontSize="12.5"
              fontWeight="900"
              letterSpacing="-0.5"
            >
              Pay
            </text>
            <text
              x="27"
              y="26"
              fill="#00BAF2"
              fontFamily="system-ui, -apple-system, sans-serif"
              fontSize="12.5"
              fontWeight="900"
              letterSpacing="-0.5"
            >
              tm
            </text>
            <rect x="6" y="30" width="36" height="3.2" rx="1.6" fill="#00BAF2" />
          </svg>
        </div>
      );

    case 'okaxis':
      // Google Pay 4-color Google "G" emblem
      return (
        <div
          className={`flex shrink-0 items-center justify-center bg-white shadow-sm ${boxClass}`}
        >
          <svg
            viewBox="0 0 48 48"
            className="h-6 w-6"
            aria-hidden="true"
          >
            <path
              fill="#EA4335"
              d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
            />
            <path
              fill="#4285F4"
              d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
            />
            <path
              fill="#FBBC05"
              d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
            />
            <path
              fill="#34A853"
              d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
            />
          </svg>
        </div>
      );

    case 'upi':
      // BHIM UPI saffron & green dual chevron logo
      return (
        <div
          className={`flex shrink-0 items-center justify-center bg-white shadow-sm ${boxClass}`}
        >
          <svg
            viewBox="0 0 40 40"
            className="h-6 w-6"
            aria-hidden="true"
          >
            <polygon points="15,7 28,20 12,33 17,20" fill="#138808" />
            <polygon points="11,7 24,20 8,33 13,20" fill="#FF6B00" />
          </svg>
        </div>
      );

    case 'apl':
      // Amazon Pay "a" + iconic orange smile arrow
      return (
        <div
          className={`flex shrink-0 items-center justify-center bg-white shadow-sm ${boxClass}`}
        >
          <svg
            viewBox="0 0 48 48"
            className="h-7 w-7"
            aria-hidden="true"
          >
            <text
              x="24"
              y="28"
              textAnchor="middle"
              fill="#232F3E"
              fontFamily="system-ui, -apple-system, sans-serif"
              fontSize="24"
              fontWeight="800"
            >
              a
            </text>
            <path
              d="M11 33c7.5 4.8 18.5 4.8 26 0"
              fill="none"
              stroke="#FF9900"
              strokeWidth="3.2"
              strokeLinecap="round"
            />
            <path
              d="M33.5 30.2 38.5 32.8 35.2 37.2"
              fill="none"
              stroke="#FF9900"
              strokeWidth="2.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      );

    case 'ikwik':
    default:
      // MobiKwik blue badge with signature "M" emblem
      return (
        <div
          className={`flex shrink-0 items-center justify-center bg-[#00449E] shadow-sm ${boxClass}`}
        >
          <svg
            viewBox="0 0 40 40"
            className="h-6 w-6"
            aria-hidden="true"
          >
            <path
              d="M8 29V11h5.2l6.8 9.6L26.8 11H32v18h-4.8V18.8L21 27.2h-2l-6.2-8.4V29H8Z"
              fill="#FFFFFF"
            />
            <circle cx="29.6" cy="11.5" r="2.4" fill="#00D4FF" />
          </svg>
        </div>
      );
  }
};

interface PaymentViewProps {
  linkedPaymentApp: LinkedPaymentApp | null;
  onLinkPaymentApp: (
    appId: string,
    appName: string,
    mobileNumber: string,
    pinCode: string
  ) => { ok: boolean; error?: string };
  onUnlinkPaymentApp: () => void;
  onOrdersUnlockedGoHome: () => void;
}

export const PaymentView: React.FC<PaymentViewProps> = ({
  linkedPaymentApp,
  onLinkPaymentApp,
  onUnlinkPaymentApp,
  onOrdersUnlockedGoHome,
}) => {
  const { t } = useLanguage();
  const [selectedApp, setSelectedApp] = useState<PaymentAppOption | null>(null);
  const [mobileNumber, setMobileNumber] = useState('');
  const [pinCode, setPinCode] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [verifiedAppSuccess, setVerifiedAppSuccess] = useState<string | null>(null);

  const handleOpenAppModal = (app: PaymentAppOption) => {
    setSelectedApp(app);
    setMobileNumber(linkedPaymentApp?.mobileNumber ?? '');
    setPinCode('');
    setErrorMsg(null);
    setVerifiedAppSuccess(null);
  };

  const handleVerifySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedApp) return;
    setErrorMsg(null);

    const res = onLinkPaymentApp(
      selectedApp.id,
      selectedApp.name,
      mobileNumber,
      pinCode
    );
    if (!res.ok) {
      setErrorMsg(res.error ?? t.verificationFailed);
      return;
    }
    setVerifiedAppSuccess(selectedApp.name);
  };

  return (
    <div className="space-y-3.5">
      {/* Connected Status Card */}
      {linkedPaymentApp ? (
        <div className="rounded-2xl border border-emerald-400/30 bg-[#0F172A] p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <PaymentAppLogo appId={linkedPaymentApp.appId} />
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-white">
                    {linkedPaymentApp.appName} {t.verifiedSuffix}
                  </p>
                  <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                    {t.activeBadge}
                  </span>
                </div>
                <p className="mt-0.5 font-mono text-xs text-slate-300 tabular-nums">
                  {t.mobilePrefix} {linkedPaymentApp.mobileNumber}
                </p>
                <p className="mt-1 text-[11px] text-emerald-400">
                  {t.ordersActiveHint}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onUnlinkPaymentApp}
              aria-label={t.unlinkBtn}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-white/10 px-2.5 text-[11px] text-slate-300 hover:border-rose-500/40 hover:text-rose-300"
            >
              <LogOut className="h-3 w-3" />
              <span>{t.unlinkBtn}</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-amber-400/25 bg-[#0F172A] p-4">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="h-5 w-5 shrink-0 text-amber-300" />
            <div>
              <h2 className="text-sm font-bold text-white">
                {t.connectOnlinePaymentTitle}
              </h2>
              <p className="mt-0.5 text-[11px] text-slate-400">
                {t.connectOnlinePaymentDesc}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Payment Apps Grid */}
      <div className="rounded-2xl border border-white/[0.08] bg-[#0F172A] p-4">
        <h3 className="text-xs font-bold text-slate-200">
          {t.onlinePaymentAppsTitle}
        </h3>
        <div className="mt-3 grid grid-cols-2 gap-2.5">
          {PAYMENT_APPS.map((app) => {
            const isLinked = linkedPaymentApp?.appId === app.id;
            return (
              <button
                key={app.id}
                type="button"
                onClick={() => handleOpenAppModal(app)}
                className={`flex items-center justify-between gap-2 rounded-xl border p-3 text-left transition-colors active:scale-[0.98] ${
                  isLinked
                    ? 'border-emerald-400/45 bg-emerald-500/10'
                    : 'border-white/[0.08] bg-[#080D1A] hover:border-amber-400/40'
                }`}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <PaymentAppLogo appId={app.id} />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold text-white">
                      {app.name}
                    </p>
                    <p className="truncate text-[10px] text-slate-400">
                      {isLinked ? t.connectedLabel : t.appTags[app.id] ?? app.id}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* App Verification Modal */}
      {selectedApp && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${selectedApp.name} ${t.verificationSuffix}`}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4"
        >
          <div className="w-full max-w-[410px] overflow-hidden rounded-t-3xl border border-white/10 bg-[#0F172A] shadow-2xl sm:rounded-3xl">
            <div className="mx-auto mt-2.5 h-1 w-9 rounded-full bg-slate-700 sm:hidden" />

            <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
              <div className="flex items-center gap-2">
                <PaymentAppLogo appId={selectedApp.id} size="sm" />
                <h3 className="text-sm font-bold text-white">
                  {selectedApp.name} {t.verificationSuffix}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedApp(null)}
                aria-label={t.cancelBtn}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white/[0.06] hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-4">
              {verifiedAppSuccess ? (
                <div className="space-y-3.5 text-center">
                  <div className="flex flex-col items-center rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-5">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500 text-[#05130E]">
                      <CheckCircle2 className="h-6 w-6" />
                    </div>
                    <p className="mt-2.5 text-sm font-bold text-white">
                      {verifiedAppSuccess} {t.connectedTitleSuffix}
                    </p>
                    <p className="mt-1 text-[11px] text-emerald-300">
                      {t.ordersUnlockedDesc}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setSelectedApp(null);
                      onOrdersUnlockedGoHome();
                    }}
                    className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-amber-400 px-4 text-xs font-bold text-[#070B14] hover:bg-amber-300"
                  >
                    <span>{t.viewActiveOrdersBtn}</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <form onSubmit={handleVerifySubmit} className="space-y-3">
                  <div>
                    <label className="flex items-center gap-1.5 text-[11px] font-medium text-slate-300">
                      <Smartphone className="h-3.5 w-3.5 text-emerald-400" />
                      <span>
                        {selectedApp.name} {t.registeredMobileLabel}
                      </span>
                    </label>
                    <div className="relative mt-1">
                      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-xs font-semibold text-slate-400">
                        +91
                      </span>
                      <input
                        type="tel"
                        maxLength={10}
                        value={mobileNumber}
                        onChange={(e) => {
                          setMobileNumber(e.target.value.replace(/\D/g, ''));
                          if (errorMsg) setErrorMsg(null);
                        }}
                        placeholder={t.mobilePlaceholder}
                        className="h-10 w-full rounded-xl border border-white/15 bg-[#080D1A] pr-3 pl-11 font-mono text-sm font-semibold text-white placeholder:font-sans placeholder:font-normal placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="flex items-center gap-1.5 text-[11px] font-medium text-slate-300">
                      <Lock className="h-3.5 w-3.5 text-amber-300" />
                      <span>{t.paymentPinLabel}</span>
                    </label>
                    <input
                      type="password"
                      inputMode="numeric"
                      maxLength={6}
                      value={pinCode}
                      onChange={(e) => {
                        setPinCode(e.target.value.replace(/\D/g, ''));
                        if (errorMsg) setErrorMsg(null);
                      }}
                      placeholder="••••••"
                      className="mt-1 h-10 w-full rounded-xl border border-white/15 bg-[#080D1A] px-3 font-mono text-sm font-bold tracking-widest text-white placeholder:tracking-normal placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
                    />
                  </div>

                  {errorMsg && (
                    <p className="text-[11px] font-medium text-rose-400">
                      {errorMsg}
                    </p>
                  )}

                  <button
                    type="submit"
                    className="h-10 w-full rounded-xl bg-amber-400 text-xs font-bold text-[#070B14] transition-colors hover:bg-amber-300 active:scale-[0.98]"
                  >
                    {t.verifyAndActivateBtn} {selectedApp.name}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
