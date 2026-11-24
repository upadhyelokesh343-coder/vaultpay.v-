import React, { useEffect, useState } from 'react';
import {
  Phone,
  User,
  Lock,
  Gift,
  Eye,
  EyeOff,
  CheckCircle2,
  ShieldCheck,
  Languages,
} from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';

interface AuthPageProps {
  initialMode?: 'login' | 'register';
  prefilledReferralCode?: string | null;
  onRegister: (params: {
    mobileNumber: string;
    username: string;
    password: string;
    confirmPassword: string;
    referralCode?: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  onLogin: (params: {
    mobileNumber: string;
    password: string;
  }) => Promise<{ ok: boolean; error?: string }>;
}

export const AuthPage: React.FC<AuthPageProps> = ({
  initialMode = 'login',
  prefilledReferralCode,
  onRegister,
  onLogin,
}) => {
  const { t, toggleLang } = useLanguage();
  const [mode, setMode] = useState<'login' | 'register'>(
    prefilledReferralCode ? 'register' : initialMode
  );
  const [mobileNumber, setMobileNumber] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [referralCode, setReferralCode] = useState(prefilledReferralCode || '');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (prefilledReferralCode) {
      setReferralCode(prefilledReferralCode);
      setMode('register');
    }
  }, [prefilledReferralCode]);

  const isPrefilled = Boolean(
    prefilledReferralCode &&
      referralCode.trim().toUpperCase() === prefilledReferralCode.toUpperCase()
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setSubmitting(true);

    try {
      if (mode === 'register') {
        const res = await onRegister({
          mobileNumber,
          username,
          password,
          confirmPassword,
          referralCode,
        });
        if (!res.ok) {
          setError(res.error ?? t.errAuthGeneric);
          return;
        }
        setSuccessMsg(t.authSuccessRegistered);
      } else {
        const res = await onLogin({
          mobileNumber,
          password,
        });
        if (!res.ok) {
          setError(res.error ?? t.errAuthInvalidCreds);
          return;
        }
        setSuccessMsg(t.authSuccessLoggedIn);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#04070E] text-slate-100">
      <div className="relative mx-auto flex min-h-screen max-w-[430px] flex-col justify-between border-x border-white/[0.06] bg-[#070B14] px-5 py-6 shadow-2xl shadow-black">
        {/* Top Bar with Brand & Language Toggle */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-400/35 bg-gradient-to-br from-[#16223D] to-[#0D1528] text-amber-300 shadow-lg shadow-amber-500/10">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-base font-extrabold tracking-tight text-white">
                VaultPay
              </h1>
              <p className="text-[11px] font-medium text-emerald-400">
                {t.instantCashbackTitle}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={toggleLang}
            aria-label={t.switchLangAria}
            className="inline-flex h-9 items-center gap-1 rounded-xl border border-amber-400/35 bg-[#10182C] px-3 text-xs font-bold text-amber-300 transition-colors hover:border-amber-400/60 hover:bg-[#16223D] active:scale-[0.97]"
          >
            <Languages className="h-3.5 w-3.5 shrink-0" />
            <span>{t.switchLangLabel}</span>
          </button>
        </div>

        {/* Full-Page Auth Card */}
        <div className="my-auto py-6">
          <div className="overflow-hidden rounded-3xl border border-amber-400/25 bg-[#0C1222] p-5 shadow-2xl">
            <div className="mb-4">
              <h2 className="text-lg font-bold text-white">
                {mode === 'register'
                  ? t.authModalTitleRegister
                  : t.authModalTitleLogin}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                {t.authNotLoggedInDesc}
              </p>
            </div>

            {/* Segmented Mode Tabs */}
            <div className="mb-4 grid grid-cols-2 gap-1.5 rounded-xl border border-white/[0.08] bg-[#070B14] p-1">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError(null);
                  setSuccessMsg(null);
                }}
                className={`h-9 rounded-lg text-xs font-bold transition-colors ${
                  mode === 'login'
                    ? 'bg-gradient-to-r from-amber-400 to-amber-300 text-[#070B14]'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {t.authLoginTab}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setError(null);
                  setSuccessMsg(null);
                }}
                className={`h-9 rounded-lg text-xs font-bold transition-colors ${
                  mode === 'register'
                    ? 'bg-gradient-to-r from-amber-400 to-amber-300 text-[#070B14]'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {t.authRegisterTab}
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3.5">
              {/* Mobile Number */}
              <div>
                <label className="block text-[11px] font-medium text-slate-300">
                  {t.authMobileLabel}
                </label>
                <div className="relative mt-1">
                  <span className="pointer-events-none absolute top-1/2 left-3 flex -translate-y-1/2 items-center gap-1 font-mono text-xs font-semibold text-slate-400">
                    <Phone className="h-3.5 w-3.5 text-amber-300" />
                    +91
                  </span>
                  <input
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    value={mobileNumber}
                    onChange={(e) =>
                      setMobileNumber(
                        e.target.value.replace(/\D/g, '').slice(0, 10)
                      )
                    }
                    placeholder={t.authMobilePlaceholder}
                    className="h-11 w-full rounded-xl border border-white/10 bg-[#070B14] pr-3 pl-16 font-mono text-xs font-semibold text-white placeholder:font-sans placeholder:text-slate-500 focus:border-amber-400 focus:outline-none tabular-nums"
                  />
                </div>
              </div>

              {/* Username (Register) */}
              {mode === 'register' && (
                <div>
                  <label className="block text-[11px] font-medium text-slate-300">
                    {t.authUsernameLabel}
                  </label>
                  <div className="relative mt-1">
                    <User className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-amber-300" />
                    <input
                      type="text"
                      maxLength={32}
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder={t.authUsernamePlaceholder}
                      className="h-11 w-full rounded-xl border border-white/10 bg-[#070B14] pr-3 pl-9 text-xs font-medium text-white placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {/* Password */}
              <div>
                <label className="block text-[11px] font-medium text-slate-300">
                  {t.authPasswordLabel}
                </label>
                <div className="relative mt-1">
                  <Lock className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-amber-300" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t.authPasswordPlaceholder}
                    className="h-11 w-full rounded-xl border border-white/10 bg-[#070B14] pr-10 pl-9 text-xs text-white placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label="Toggle password visibility"
                    className="absolute top-1/2 right-2.5 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Confirm Password (Register) */}
              {mode === 'register' && (
                <div>
                  <label className="block text-[11px] font-medium text-slate-300">
                    {t.authConfirmPasswordLabel}
                  </label>
                  <div className="relative mt-1">
                    <Lock className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-emerald-400" />
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder={t.authConfirmPasswordPlaceholder}
                      className="h-11 w-full rounded-xl border border-white/10 bg-[#070B14] pr-10 pl-9 text-xs text-white placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword((prev) => !prev)}
                      aria-label="Toggle confirm password visibility"
                      className="absolute top-1/2 right-2.5 -translate-y-1/2 text-slate-400 hover:text-white"
                    >
                      {showConfirmPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Referral Code Box (Register — auto-filled if arrived from shared link) */}
              {mode === 'register' && (
                <div>
                  <label className="flex items-center justify-between text-[11px] font-medium text-slate-300">
                    <span>{t.authReferralCodeLabel}</span>
                    {isPrefilled && (
                      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                        {t.authReferralPrefilledHint}
                      </span>
                    )}
                  </label>
                  <div className="relative mt-1">
                    <Gift className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-emerald-400" />
                    <input
                      type="text"
                      maxLength={32}
                      value={referralCode}
                      onChange={(e) =>
                        setReferralCode(e.target.value.toUpperCase().replace(/\s+/g, ''))
                      }
                      placeholder={t.authReferralCodePlaceholder}
                      className={`h-11 w-full rounded-xl border bg-[#070B14] pr-3 pl-9 font-mono text-xs font-bold tracking-wider uppercase focus:outline-none ${
                        isPrefilled
                          ? 'border-emerald-400/55 text-emerald-300'
                          : 'border-white/10 text-white placeholder:font-sans placeholder:font-normal placeholder:tracking-normal placeholder:normal-case placeholder:text-slate-500 focus:border-amber-400'
                      }`}
                    />
                  </div>
                </div>
              )}

              {mode === 'login' && prefilledReferralCode && (
                <div className="flex items-center justify-between rounded-xl border border-emerald-400/35 bg-emerald-500/10 px-3 py-2 text-[11px]">
                  <span className="flex items-center gap-1.5 text-emerald-200">
                    <Gift className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Invite Code Applied</span>
                  </span>
                  <span className="font-mono font-bold text-emerald-300">
                    {prefilledReferralCode}
                  </span>
                </div>
              )}

              {error && (
                <p className="rounded-xl border border-rose-500/30 bg-rose-500/15 px-3 py-2 text-[11px] font-medium text-rose-300">
                  {error}
                </p>
              )}

              {successMsg && (
                <div className="flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/15 px-3 py-2 text-[11px] font-medium text-emerald-300">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>{successMsg}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="h-11 w-full rounded-xl bg-gradient-to-r from-amber-400 to-amber-300 text-xs font-bold text-[#070B14] shadow-lg shadow-amber-500/15 transition-transform active:scale-[0.98] disabled:opacity-50"
              >
                {submitting
                  ? t.authSubmittingBtn
                  : mode === 'register'
                  ? t.authRegisterBtn
                  : t.authLoginBtn}
              </button>

              <button
                type="button"
                onClick={() => {
                  setMode(mode === 'register' ? 'login' : 'register');
                  setError(null);
                  setSuccessMsg(null);
                }}
                className="w-full pt-1 text-center text-[11px] font-medium text-slate-400 hover:text-amber-300"
              >
                {mode === 'register'
                  ? t.authSwitchToLogin
                  : t.authSwitchToRegister}
              </button>
            </form>
          </div>
        </div>

        <p className="text-center text-[10px] text-slate-500">
          VaultPay · 11% Instant Cashback Wallet
        </p>
      </div>
    </div>
  );
};
