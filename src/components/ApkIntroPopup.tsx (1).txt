import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';

export const APK_POPUP_SLIDES = [
  {
    id: 'reminder-purchase',
    image: '/assets/aistudio/IMG_20261123_163113_909621ce.png',
    alt: 'VaultPay Important Reminder - Complete 1 Purchase Order to unlock rewards',
  },
  {
    id: 'notice-bank-link',
    image: '/assets/aistudio/IMG_20261123_163041_e591f12d.png',
    alt: 'VaultPay Mahatvapurna Suchna - Sahi UPI aur bank khata rules',
  },
  {
    id: 'notice-bind-upi',
    image: '/assets/aistudio/IMG_20261123_163012_21950378.png',
    alt: 'VaultPay Mahatvapurna Suchna - Keval Bind UPI ID se bhugtan karein',
  },
] as const;

interface ApkIntroPopupProps {
  onClose: () => void;
}

export const ApkIntroPopup: React.FC<ApkIntroPopupProps> = ({ onClose }) => {
  const [stepIndex, setStepIndex] = useState(0);
  const [loadedImages, setLoadedImages] = useState<Record<string, boolean>>({});
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const [retryToken, setRetryToken] = useState<Record<string, number>>({});

  const currentSlide = APK_POPUP_SLIDES[stepIndex];
  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === APK_POPUP_SLIDES.length - 1;
  const isLoaded = Boolean(loadedImages[currentSlide.id]);
  const hasFailed = Boolean(failedImages[currentSlide.id]);
  const attemptCount = retryToken[currentSlide.id] || 0;
  const activeSrc =
    attemptCount > 0
      ? `${currentSlide.image}?r=${attemptCount}`
      : currentSlide.image;

  // Warm browser/WebView cache for all 3 exact photos while user views step 1
  useEffect(() => {
    APK_POPUP_SLIDES.forEach((slide) => {
      const pre = new Image();
      pre.onload = () => {
        setLoadedImages((prev) =>
          prev[slide.id] ? prev : { ...prev, [slide.id]: true }
        );
      };
      pre.src = slide.image;
    });
  }, []);

  const handleNext = () => {
    if (isLastStep) {
      onClose();
      return;
    }
    setStepIndex((prev) => Math.min(APK_POPUP_SLIDES.length - 1, prev + 1));
  };

  const handlePrev = () => {
    setStepIndex((prev) => Math.max(0, prev - 1));
  };

  const handleRetryImage = () => {
    setFailedImages((prev) => ({ ...prev, [currentSlide.id]: false }));
    setLoadedImages((prev) => ({ ...prev, [currentSlide.id]: false }));
    setRetryToken((prev) => ({
      ...prev,
      [currentSlide.id]: (prev[currentSlide.id] || 0) + 1,
    }));
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="VaultPay Important Notice"
      className="fixed inset-0 z-[95] flex items-center justify-center bg-[#04070E]/90 p-3 backdrop-blur-md"
    >
      <div className="relative flex w-full max-w-[395px] flex-col overflow-hidden rounded-3xl border border-amber-400/35 bg-[#0C1324] shadow-2xl shadow-black/85">
        {/* Top bar */}
        <div className="flex shrink-0 items-center justify-between border-b border-white/[0.08] px-4 py-2.5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-amber-300" />
            <span className="text-xs font-bold text-white">
              VaultPay Notice ({stepIndex + 1} / {APK_POPUP_SLIDES.length})
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-[#080D1A] text-slate-300 transition-colors hover:border-amber-400/50 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Exact Uploaded Photo Display (explicit non-collapsing block height for Android APK WebViews) */}
        <div className="relative w-full max-h-[68vh] min-h-[260px] overflow-y-auto bg-[#070B14] p-2">
          {!isLoaded && !hasFailed && (
            <div className="flex min-h-[260px] flex-col items-center justify-center gap-2 text-slate-300">
              <Loader2 className="h-7 w-7 animate-spin text-amber-400" />
              <span className="text-[11px] font-medium text-slate-400">
                Loading notice...
              </span>
            </div>
          )}

          {hasFailed ? (
            <div className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-white/10 bg-[#0F172A] p-6 text-center">
              <ShieldCheck className="h-10 w-10 text-amber-300" />
              <p className="mt-2 text-xs font-semibold text-slate-300">
                {currentSlide.alt}
              </p>
              <button
                type="button"
                onClick={handleRetryImage}
                className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-amber-400/40 bg-amber-400/15 px-3.5 py-2 text-xs font-bold text-amber-300 hover:bg-amber-400/25"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Reload Photo</span>
              </button>
            </div>
          ) : (
            <img
              key={`${currentSlide.id}-${attemptCount}`}
              src={activeSrc}
              alt={currentSlide.alt}
              onLoad={() =>
                setLoadedImages((prev) => ({
                  ...prev,
                  [currentSlide.id]: true,
                }))
              }
              onError={() =>
                setFailedImages((prev) => ({
                  ...prev,
                  [currentSlide.id]: true,
                }))
              }
              className={`mx-auto block w-full rounded-2xl object-contain transition-opacity duration-200 ${
                isLoaded
                  ? 'h-auto max-h-[64vh] opacity-100'
                  : 'h-0 overflow-hidden opacity-0'
              }`}
            />
          )}
        </div>

        {/* Bottom Progress & Controls */}
        <div className="shrink-0 space-y-3 border-t border-white/[0.08] bg-[#0C1324] px-4 py-3">
          {/* 3-step segmented indicator */}
          <div className="flex items-center gap-1.5" aria-hidden="true">
            {APK_POPUP_SLIDES.map((s, idx) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setStepIndex(idx)}
                aria-label={`Photo ${idx + 1}`}
                className={`h-1.5 flex-1 rounded-full transition-all duration-200 ${
                  idx === stepIndex
                    ? 'bg-amber-400'
                    : idx < stepIndex
                    ? 'bg-emerald-400/75'
                    : 'bg-white/15'
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            {isFirstStep ? (
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-[#080D1A] px-4 text-xs font-bold text-slate-300 transition-colors hover:border-white/25 hover:text-white whitespace-nowrap"
              >
                Skip
              </button>
            ) : (
              <button
                type="button"
                onClick={handlePrev}
                className="inline-flex h-11 shrink-0 items-center justify-center gap-1 rounded-xl border border-white/10 bg-[#080D1A] px-4 text-xs font-bold text-slate-200 transition-colors hover:border-white/25 hover:text-white whitespace-nowrap"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Back</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleNext}
              className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-400 to-amber-300 px-5 text-xs font-extrabold text-[#070B14] shadow-lg shadow-amber-500/20 transition-transform hover:brightness-105 active:scale-[0.98] whitespace-nowrap"
            >
              <span>{isLastStep ? 'Open App' : 'Next'}</span>
              {isLastStep ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <ArrowRight className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
