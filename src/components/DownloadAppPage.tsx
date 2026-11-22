import React, { useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Check,
  Download,
  Gift,
  Globe,
  Languages,
  LogOut,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { AuthAccount } from '../types/wallet';
import { useLanguage } from '../i18n/LanguageContext';

const APK_DOWNLOAD_URL =
  'https://drive.google.com/uc?export=download&id=1tpRyV4kbquxZVA9r8rbIXjPvIZRbI-uY';

interface DownloadAppPageProps {
  authAccount: AuthAccount;
  referredBy: string | null;
  onOpenWebsite: () => void;
  onLogout: () => void;
}

export const DownloadAppPage: React.FC<DownloadAppPageProps> = ({
  authAccount,
  referredBy,
  onOpenWebsite,
  onLogout,
}) => {
  const { t, toggleLang } = useLanguage();
  const [downloadStarted, setDownloadStarted] = useState(false);
  const [copiedRef, setCopiedRef] = useState(false);

  const activeReferral = authAccount.referredBy || referredBy;

  const handleCopyMyRef = async () => {
    try {
      await navigator.clipboard.writeText(authAccount.referralCode);
      setCopiedRef(true);
      setTimeout(() => setCopiedRef(false), 1800);
    } catch {
      // ignore
    }
  };

  return (
    <div className="min-h-screen bg-[#04070E] text-slate-100">
      <div className="relative mx-auto flex min-h-screen max-w-[430px] flex-col justify-between border-x border-white/[0.06] bg-[#070B14] px-5 py-6 shadow-2xl shadow-black">
        {/* Top Bar */}
        <div className="flex items-center justify-between gap-2">
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

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleLang}
              aria-label={t.switchLangAria}
              className="inline-flex h-9 items-center gap-1 rounded-xl border border-amber-400/35 bg-[#10182C] px-2.5 text-xs font-bold text-amber-300 hover:border-amber-400/60"
            >
              <Languages className="h-3.5 w-3.5 shrink-0" />
              <span>{t.switchLangLabel}</span>
            </button>

            <button
              type="button"
              onClick={onLogout}
              aria-label={t.authLogoutBtn}
              title={t.authLogoutBtn}
              className="inline-flex h-9 items-center gap-1 rounded-xl border border-white/10 bg-[#10182C] px-2.5 text-xs font-semibold text-slate-300 hover:border-rose-400/40 hover:text-rose-300"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Full-Page Download Hero Card */}
        <div className="my-auto py-6">
          <div className="space-y-5 rounded-3xl border border-amber-400/25 bg-[#0C1222] p-6 text-center shadow-2xl">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-emerald-400/35 bg-emerald-500/15 text-emerald-300 shadow-lg shadow-emerald-500/10">
              <Smartphone className="h-8 w-8" />
            </div>

            <div>
              <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/30 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-bold text-emerald-300">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {t.downloadAccountReadyBadge}
              </span>
              <h2 className="mt-3 text-xl font-extrabold tracking-tight text-white">
                {t.downloadPageTitle}
              </h2>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                {t.downloadPageSubtitle}
              </p>
            </div>

            {/* User & Referral Code Preservation Card */}
            <div className="space-y-2 rounded-2xl border border-white/[0.08] bg-[#070B14] p-3.5 text-left text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-400">{t.authUsernameLabel}</span>
                <span className="font-bold text-white">
                  {authAccount.username}{' '}
                  <span className="font-mono text-[11px] text-slate-400">
                    (ID: {authAccount.userId})
                  </span>
                </span>
              </div>

              <div className="flex items-center justify-between gap-2 border-t border-white/[0.06] pt-2">
                <span className="text-slate-400">{t.yourInviteCodeLabel}</span>
                <button
                  type="button"
                  onClick={handleCopyMyRef}
                  className="inline-flex items-center gap-1 font-mono text-xs font-bold text-amber-300 hover:text-amber-200"
                >
                  <span>{authAccount.referralCode}</span>
                  {copiedRef ? (
                    <Check className="h-3 w-3 text-emerald-400" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </button>
              </div>

              {activeReferral && (
                <div className="flex items-center justify-between gap-2 border-t border-white/[0.06] pt-2">
                  <span className="flex items-center gap-1 text-emerald-300">
                    <Gift className="h-3.5 w-3.5" />
                    {t.invitedByBadge}
                  </span>
                  <span className="rounded bg-emerald-500/15 px-2 py-0.5 font-mono text-xs font-bold text-emerald-300">
                    {activeReferral}
                  </span>
                </div>
              )}
            </div>

            {/* Primary Full-Width Google Drive APK Download Link Button */}
            <a
              href={APK_DOWNLOAD_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setDownloadStarted(true)}
              className="flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-amber-400 via-amber-300 to-emerald-400 px-5 text-sm font-extrabold text-[#070B14] shadow-xl shadow-amber-500/20 transition-transform hover:brightness-105 active:scale-[0.98]"
            >
              <Download className="h-5 w-5" />
              <span>{t.downloadAppPrimaryBtn}</span>
            </a>

            {/* Secondary Button: Open VaultPay directly on the Website */}
            <button
              type="button"
              onClick={onOpenWebsite}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-amber-400/35 bg-[#10182C] px-5 text-sm font-bold text-amber-300 transition-colors hover:border-amber-400/60 hover:bg-[#16223D] active:scale-[0.98]"
            >
              <Globe className="h-4 w-4" />
              <span>{t.openWebsiteAppBtn}</span>
            </button>

            {downloadStarted && (
              <div className="space-y-1 rounded-2xl border border-emerald-400/35 bg-emerald-500/10 px-4 py-3 text-emerald-200">
                <p className="text-xs font-bold text-white">
                  {t.appInstalledTitle}
                </p>
                <p className="text-[11px] leading-relaxed text-emerald-200">
                  {t.appInstalledDesc}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Bottom Footer */}
        <div className="text-center">
          <p className="text-[10px] text-slate-500">
            VaultPay · 11% Instant Cashback Wallet
          </p>
        </div>
      </div>
    </div>
  );
};
