import React, { useState, useEffect } from 'react';
import {
  X,
  ArrowUpRight,
  CheckCircle2,
  Smartphone,
  Building2,
  Phone,
  AlertCircle,
} from 'lucide-react';
import { UserProfile, WithdrawMethod } from '../types/wallet';
import { WithdrawDetailsInput } from '../hooks/useWalletStore';
import { formatINR, MIN_WITHDRAW_AMOUNT } from '../utils/formatters';
import { useLanguage } from '../i18n/LanguageContext';

interface DepositWithdrawModalProps {
  isOpen: boolean;
  walletBalance: number;
  profile: UserProfile;
  authMobile?: string;
  onClose: () => void;
  onWithdraw: (
    amountInr: number,
    details: WithdrawDetailsInput,
    statusMode?: 'Success' | 'Pending'
  ) => { ok: boolean; error?: string };
}

export const DepositWithdrawModal: React.FC<DepositWithdrawModalProps> = ({
  isOpen,
  walletBalance,
  profile,
  authMobile,
  onClose,
  onWithdraw,
}) => {
  const { t } = useLanguage();
  const [withdrawMethod, setWithdrawMethod] = useState<WithdrawMethod>('upi');
  const [inrInput, setInrInput] = useState<string>('');
  const [upiInput, setUpiInput] = useState<string>('');
  const [bankNameInput, setBankNameInput] = useState<string>('');
  const [accountNumberInput, setAccountNumberInput] = useState<string>('');
  const [ifscInput, setIfscInput] = useState<string>('');
  const [mobileInput, setMobileInput] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setSuccessMsg(null);
      setInrInput(walletBalance > 0 ? String(walletBalance) : '');
      setUpiInput(profile.upiId || '');
      setBankNameInput(profile.bankName || '');
      setAccountNumberInput('');
      setIfscInput('');
      setMobileInput((authMobile || profile.mobileNumber || '').replace(/\D/g, '').slice(0, 10));
    }
  }, [isOpen, walletBalance, profile, authMobile]);

  if (!isOpen) return null;

  const parsedInr = Number(inrInput);

  const handleWithdrawSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!Number.isFinite(parsedInr) || parsedInr < MIN_WITHDRAW_AMOUNT) {
      setError(t.errMinWithdraw);
      return;
    }

    const res = onWithdraw(
      parsedInr,
      {
        method: withdrawMethod,
        upiId: upiInput,
        bankName: bankNameInput,
        accountNumber: accountNumberInput,
        ifscCode: ifscInput,
        mobileNumber: mobileInput,
      },
      'Pending'
    );

    if (!res.ok) {
      setError(res.error ?? t.withdrawFailed);
      return;
    }

    setSuccessMsg(
      `${t.withdrawalLoggedPrefix} ${formatINR(parsedInr)} (${t.statusPending})`
    );
    setTimeout(() => {
      onClose();
    }, 1000);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.withdrawFundsTitle}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <div className="max-h-[92vh] w-full max-w-[410px] overflow-y-auto rounded-t-3xl border border-white/10 bg-[#0F172A] shadow-2xl sm:rounded-3xl">
        <div className="mx-auto mt-2.5 h-1 w-9 rounded-full bg-slate-700 sm:hidden" />

        <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <ArrowUpRight className="h-4 w-4 text-amber-300" />
            <span>{t.withdrawFundsTitle}</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={t.cancelBtn}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white/[0.06] hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4">
          {successMsg ? (
            <div className="flex flex-col items-center py-5 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <p className="mt-2.5 text-sm font-bold text-white">{successMsg}</p>
            </div>
          ) : (
            <form onSubmit={handleWithdrawSubmit} noValidate className="space-y-3">
              <div className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-[#080D1A] px-3 py-2 text-xs">
                <span className="text-slate-400">{t.walletBalanceLabel}</span>
                <span className="font-mono font-bold text-emerald-400 tabular-nums">
                  {formatINR(walletBalance)}
                </span>
              </div>

              <div>
                <div className="flex items-center justify-between gap-2">
                  <label className="text-[11px] font-medium text-slate-300">
                    {t.withdrawAmountLabel}
                  </label>
                  <div className="flex items-center gap-2">
                    {walletBalance > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setInrInput(String(walletBalance));
                          setError(null);
                        }}
                        className="text-[11px] font-semibold text-amber-300 hover:text-amber-200"
                      >
                        {t.maxBtn}
                      </button>
                    )}
                  </div>
                </div>
                <div className="relative mt-1">
                  <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-sm font-bold text-slate-400">
                    ₹
                  </span>
                  <input
                    type="number"
                    step="any"
                    value={inrInput}
                    onChange={(e) => {
                      setInrInput(e.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="0"
                    className="h-10 w-full rounded-xl border border-white/10 bg-[#080D1A] pr-3 pl-7 font-mono text-base font-bold text-white focus:border-amber-400 focus:outline-none tabular-nums"
                  />
                </div>
              </div>

              {/* 3 Separate Destination Buttons: UPI | Bank Account | Mobile Number */}
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    {
                      id: 'upi',
                      label: t.upiLabel,
                      icon: Smartphone,
                    },
                    {
                      id: 'bank',
                      label: t.bankAccountLabel,
                      icon: Building2,
                    },
                    {
                      id: 'mobile',
                      label: t.mobileWithdrawLabel,
                      icon: Phone,
                    },
                  ] as const
                ).map((dest) => {
                  const Icon = dest.icon;
                  const active = withdrawMethod === dest.id;
                  return (
                    <button
                      key={dest.id}
                      type="button"
                      onClick={() => {
                        setWithdrawMethod(dest.id);
                        if (error) setError(null);
                      }}
                      className={`flex flex-col items-center justify-center rounded-xl border px-2 py-2.5 text-center transition-colors ${
                        active
                          ? 'border-amber-400/60 bg-amber-400/15 text-white'
                          : 'border-white/[0.08] bg-[#090F1E] text-slate-400 hover:border-white/20'
                      }`}
                    >
                      <Icon
                        className={`h-4 w-4 ${
                          active ? 'text-amber-300' : 'text-slate-400'
                        }`}
                      />
                      <span className="mt-1 text-[11px] font-bold leading-tight">
                        {dest.label}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Dynamic Payout Details Inputs */}
              {withdrawMethod === 'upi' && (
                <div className="rounded-xl border border-white/[0.08] bg-[#080D1A] p-3">
                  <label className="block text-[11px] font-medium text-slate-300">
                    {t.withdrawUpiInputLabel}
                  </label>
                  <input
                    type="text"
                    value={upiInput}
                    onChange={(e) => {
                      setUpiInput(e.target.value);
                      if (error) setError(null);
                    }}
                    placeholder={t.withdrawUpiPlaceholder}
                    className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-[#0F172A] px-3 font-mono text-xs text-white placeholder:font-sans placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
                  />
                </div>
              )}

              {withdrawMethod === 'bank' && (
                <div className="space-y-2 rounded-xl border border-white/[0.08] bg-[#080D1A] p-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-300">
                      {t.withdrawBankNameLabel}
                    </label>
                    <input
                      type="text"
                      value={bankNameInput}
                      onChange={(e) => {
                        setBankNameInput(e.target.value);
                        if (error) setError(null);
                      }}
                      placeholder={t.withdrawBankNamePlaceholder}
                      className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-[#0F172A] px-3 text-xs text-white placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-300">
                      {t.withdrawAccountNumLabel}
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={accountNumberInput}
                      onChange={(e) => {
                        setAccountNumberInput(e.target.value.replace(/\s+/g, ''));
                        if (error) setError(null);
                      }}
                      placeholder={t.withdrawAccountNumPlaceholder}
                      className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-[#0F172A] px-3 font-mono text-xs text-white placeholder:font-sans placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-300">
                      {t.withdrawIfscLabel}
                    </label>
                    <input
                      type="text"
                      value={ifscInput}
                      onChange={(e) => setIfscInput(e.target.value.toUpperCase())}
                      placeholder={t.withdrawIfscPlaceholder}
                      className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-[#0F172A] px-3 font-mono text-xs uppercase text-white placeholder:font-sans placeholder:normal-case placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {withdrawMethod === 'mobile' && (
                <div className="rounded-xl border border-white/[0.08] bg-[#080D1A] p-3">
                  <label className="block text-[11px] font-medium text-slate-300">
                    {t.withdrawMobileInputLabel}
                  </label>
                  <div className="relative mt-1">
                    <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-xs font-semibold text-slate-400">
                      +91
                    </span>
                    <input
                      type="tel"
                      maxLength={10}
                      value={mobileInput}
                      onChange={(e) => {
                        setMobileInput(e.target.value.replace(/\D/g, ''));
                        if (error) setError(null);
                      }}
                      placeholder={t.mobilePlaceholder}
                      className="h-9 w-full rounded-lg border border-white/10 bg-[#0F172A] pr-3 pl-10 font-mono text-xs font-semibold text-white placeholder:font-sans placeholder:font-normal placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {error && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-xl border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-300"
                >
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                className="h-10 w-full rounded-xl bg-amber-400 text-xs font-bold text-[#070B14] transition-colors hover:bg-amber-300 active:scale-[0.98]"
              >
                {t.confirmWithdrawalBtn}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
