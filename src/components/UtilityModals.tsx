import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  Check,
  CheckCheck,
  Copy,
  Gift,
  Users,
  MessageSquareHeart,
  Send,
  CheckCircle2,
  ImagePlus,
} from 'lucide-react';
import { ChatMessage } from '../types/wallet';
import { formatINR } from '../utils/formatters';
import { compressImageFileToDataUrl } from '../utils/imageHelper';
import { useLanguage } from '../i18n/LanguageContext';

interface DailyTaskModalProps {
  isOpen: boolean;
  completedOrdersCount: number;
  streakDays: number;
  claimedToday: boolean;
  onClose: () => void;
  onClaimDaily: () => { ok: boolean; error?: string };
}

export const DailyTaskModal: React.FC<DailyTaskModalProps> = ({
  isOpen,
  completedOrdersCount,
  streakDays,
  claimedToday,
  onClose,
  onClaimDaily,
}) => {
  const { t } = useLanguage();
  const [feedback, setFeedback] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleClaim = () => {
    const res = onClaimDaily();
    if (res.ok) {
      setFeedback(t.dailyRewardCreditedMsg);
    } else {
      setFeedback(res.error ?? t.alreadyClaimedMsg);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.dailyTasksTitle}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <div className="w-full max-w-[410px] rounded-t-3xl border border-white/10 bg-[#0F172A] p-5 shadow-2xl sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-3.5">
          <div className="flex items-center gap-2.5">
            <Gift className="h-5 w-5 text-amber-300" />
            <h3 className="text-base font-bold text-white">{t.dailyTasksTitle}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-white/[0.06] hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between gap-2 rounded-2xl border border-amber-400/25 bg-[#080D1A] p-4">
            <div>
              <p className="text-sm font-bold text-slate-100">
                {t.dailyCheckInTitle}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">
                {t.streakPrefix} {streakDays} {t.streakSuffix}
              </p>
            </div>
            <button
              type="button"
              onClick={handleClaim}
              disabled={claimedToday}
              className="min-h-[40px] shrink-0 rounded-xl bg-amber-400 px-3.5 text-xs font-bold text-[#070B14] hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-emerald-500/20 disabled:text-emerald-300"
            >
              {claimedToday ? t.claimedBtn : t.claim25Btn}
            </button>
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-[#080D1A] p-4">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-200">
                {t.complete3OrdersLabel}
              </span>
              <span className="font-mono font-bold text-emerald-400 tabular-nums">
                {Math.min(completedOrdersCount, 3)} / 3
              </span>
            </div>
            <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-slate-800">
              <div
                style={{ width: `${Math.min(100, (completedOrdersCount / 3) * 100)}%` }}
                className="h-full bg-gradient-to-r from-emerald-500 to-amber-300"
              />
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              {t.everyOrderEarns11}
            </p>
          </div>

          {feedback && (
            <div className="flex items-center gap-2 rounded-xl bg-emerald-500/15 px-3.5 py-2.5 text-xs font-medium text-emerald-300">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{feedback}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface ReferralModalProps {
  isOpen: boolean;
  userId: string;
  completedReferralsCount: number;
  referralBonusEarned: number;
  onClose: () => void;
}

export const ReferralModal: React.FC<ReferralModalProps> = ({
  isOpen,
  userId,
  completedReferralsCount,
  referralBonusEarned,
  onClose,
}) => {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const inviteCode = `AUREX-${userId}`;
  const shareUrl = `${window.location.origin}/?ref=${inviteCode}`;
  const currentCycleCount = completedReferralsCount % 5;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'VaultPay',
          text: `${t.shareInviteText} ${shareUrl}`,
          url: shareUrl,
        });
        return;
      } catch {
        // fallback to copy
      }
    }
    await handleCopyLink();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.teamReferralTitle}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <div className="w-full max-w-[410px] rounded-t-3xl border border-white/10 bg-[#0F172A] p-5 shadow-2xl sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-3.5">
          <div className="flex items-center gap-2.5">
            <Users className="h-5 w-5 text-sky-300" />
            <h3 className="text-base font-bold text-white">{t.referralSectionTitle}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-white/[0.06] hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 space-y-3.5">
          <div className="space-y-2.5 rounded-2xl border border-white/[0.08] bg-[#080D1A] p-4">
            <p className="text-xs text-slate-400">{t.yourInviteCodeLabel}</p>
            <p className="font-mono text-lg font-bold tracking-wider text-amber-300">
              {inviteCode}
            </p>
            <p className="truncate rounded-lg border border-white/[0.07] bg-[#0F172A] px-2.5 py-2 font-mono text-[11px] text-slate-300">
              {shareUrl}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleCopyLink}
                className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-[#0F172A] px-3 text-xs font-bold text-slate-100 hover:border-amber-400/40"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5 text-amber-300" />}
                {copied ? t.linkCopiedBtn : t.copyLinkBtn}
              </button>
              <button
                type="button"
                onClick={handleShare}
                className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-xl bg-amber-400 px-3 text-xs font-bold text-[#070B14] hover:bg-amber-300"
              >
                {t.shareLinkBtn}
              </button>
            </div>
            <p className="text-[11px] leading-relaxed text-slate-400">
              {t.referralRuleDesc}
            </p>
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-[#080D1A] p-4">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-200">
                {t.qualifiedProgressLabel}
              </span>
              <span className="font-mono font-bold text-emerald-400 tabular-nums">
                {currentCycleCount} / 5
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
              <div
                style={{ width: `${(currentCycleCount / 5) * 100}%` }}
                className="h-full bg-gradient-to-r from-emerald-500 to-amber-300"
              />
            </div>
            <div className="mt-3 flex items-center justify-between text-xs">
              <span className="text-slate-400">{t.referralEarnedLabel}</span>
              <span className="font-mono font-bold text-amber-300 tabular-nums">
                {formatINR(referralBonusEarned)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

interface SupportWidgetProps {
  availableBalance: number;
  messages: ChatMessage[];
  onSendMessage: (
    text: string,
    imageData?: string
  ) => Promise<{ ok: boolean; error?: string }>;
  onOpenMarkRead?: () => void;
}

function formatShortTime(ts?: string): string {
  if (!ts) return '';
  const parts = ts.split(' ');
  return parts[1] ? parts[1].slice(0, 5) : ts;
}

export const SupportWidget: React.FC<SupportWidgetProps> = ({
  messages,
  onSendMessage,
  onOpenMarkRead,
}) => {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [pendingPhoto, setPendingPhoto] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const unreadAgentCount = messages.filter(
    (m) => m.sender === 'agent' && !m.readByUser
  ).length;

  useEffect(() => {
    if (open && unreadAgentCount > 0 && onOpenMarkRead) {
      onOpenMarkRead();
    }
  }, [open, unreadAgentCount, onOpenMarkRead]);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [open, messages.length]);

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPhotoError(null);
    try {
      const compressed = await compressImageFileToDataUrl(file);
      setPendingPhoto(compressed);
    } catch {
      setPhotoError(t.invalidImageError);
    }
  };

  const handleSend = async (textToSend: string, photoToSend?: string | null) => {
    const clean = textToSend.trim();
    const img = photoToSend ?? pendingPhoto;
    if ((!clean && !img) || sending) return;
    setSending(true);
    setPhotoError(null);
    setInput('');
    setPendingPhoto(null);
    await onSendMessage(clean, img || undefined);
    setSending(false);
  };

  return (
    <>
      {/* Floating Support Button inside mobile shell */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t.supportTitle}
        className="fixed right-3 bottom-18 z-40 flex h-11 w-11 items-center justify-center rounded-2xl border border-amber-400/40 bg-gradient-to-br from-[#162340] to-[#0D1528] text-amber-300 shadow-lg shadow-black/60 transition-transform hover:scale-105 active:scale-95 sm:right-[calc(50%-200px)]"
      >
        {open ? (
          <X className="h-4 w-4" />
        ) : (
          <MessageSquareHeart className="h-5 w-5" />
        )}
        {!open && unreadAgentCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#25D366] px-1 font-mono text-[10px] font-bold text-[#070B14]">
            {unreadAgentCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t.supportTitle}
          className="fixed right-3 bottom-32 z-40 flex w-76 flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#0F172A] shadow-2xl sm:right-[calc(50%-200px)]"
        >
          <div className="flex items-center justify-between border-b border-white/[0.08] bg-[#141F3B] px-3.5 py-2.5">
            <div>
              <p className="text-xs font-bold text-white">{t.supportTitle}</p>
              <p className="text-[10px] text-emerald-300">{t.supportSubtitle}</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg p-1 text-slate-400 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div
            ref={scrollRef}
            className="max-h-60 space-y-2 overflow-y-auto bg-[#0B141A] p-3"
          >
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-2xl rounded-tl-none border border-white/[0.08] bg-[#202C33] px-3 py-2 text-xs leading-relaxed text-slate-200">
                {t.supportWelcome}
              </div>
            </div>

            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-2.5 py-2 text-xs leading-relaxed ${
                    m.sender === 'user'
                      ? 'rounded-tr-none bg-[#005C4B] text-white'
                      : 'rounded-tl-none border border-white/[0.08] bg-[#202C33] text-slate-100'
                  }`}
                >
                  {m.imageUrl && (
                    <button
                      type="button"
                      onClick={() => setPreviewUrl(m.imageUrl!)}
                      className="mb-1.5 block w-full overflow-hidden rounded-xl border border-white/10"
                    >
                      <img
                        src={m.imageUrl}
                        alt="Chat attachment"
                        className="max-h-40 w-full object-cover"
                      />
                    </button>
                  )}
                  {m.text && <p className="px-0.5 break-words">{m.text}</p>}
                  <div className="mt-1 flex items-center justify-end gap-1 px-0.5 text-[9px] text-slate-300/75">
                    <span>{formatShortTime(m.createdAt)}</span>
                    {m.sender === 'user' && (
                      <CheckCheck className="h-3 w-3 text-sky-300" />
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-1.5 border-t border-white/[0.06] px-3 py-2">
            {[t.supportQuick1, t.supportQuick2, t.supportQuick3].map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => void handleSend(q, null)}
                className="rounded-lg border border-white/10 bg-[#080D1A] px-2.5 py-1 text-[11px] text-slate-300 hover:border-amber-400/40"
              >
                {q}
              </button>
            ))}
          </div>

          {photoError && (
            <p className="border-t border-white/[0.06] px-3 py-1 text-[10px] font-medium text-rose-400">
              {photoError}
            </p>
          )}

          {pendingPhoto && (
            <div className="flex items-center justify-between gap-2 border-t border-white/[0.08] bg-[#131C21] px-3 py-2">
              <div className="flex items-center gap-2">
                <img
                  src={pendingPhoto}
                  alt="Preview"
                  className="h-10 w-10 rounded-lg border border-white/15 object-cover"
                />
                <span className="text-[11px] font-medium text-[#25D366]">
                  {t.photoBadgeText}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setPendingPhoto(null)}
                aria-label="Remove photo"
                className="rounded-full bg-white/10 p-1 text-slate-300 hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSend(input);
            }}
            className="flex items-center gap-1.5 border-t border-white/[0.08] p-2.5"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handlePhotoChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label={t.attachPhotoLabel}
              title={t.attachPhotoLabel}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-[#080D1A] text-emerald-300 hover:border-[#25D366] hover:text-[#25D366]"
            >
              <ImagePlus className="h-4 w-4" />
            </button>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={pendingPhoto ? t.photoCaptionPlaceholder : t.supportPlaceholder}
              className="min-h-[38px] min-w-0 flex-1 rounded-xl border border-white/10 bg-[#080D1A] px-3 text-xs text-white focus:border-[#00A884] focus:outline-none"
            />
            <button
              type="submit"
              disabled={sending || (!input.trim() && !pendingPhoto)}
              aria-label="Send"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#00A884] text-[#070B14] hover:bg-[#25D366] disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}

      {/* In-app full-screen photo lightbox */}
      {previewUrl && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setPreviewUrl(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-h-[85vh] max-w-[410px]"
          >
            <button
              type="button"
              onClick={() => setPreviewUrl(null)}
              aria-label={t.closePreviewLabel}
              className="absolute -top-3 -right-3 flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-[#0F172A] text-white shadow-lg"
            >
              <X className="h-4 w-4" />
            </button>
            <img
              src={previewUrl}
              alt="Full view"
              className="max-h-[82vh] w-auto rounded-2xl border border-white/15 object-contain shadow-2xl"
            />
          </div>
        </div>
      )}
    </>
  );
};
