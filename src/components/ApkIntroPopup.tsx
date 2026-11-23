import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, ShieldCheck, X } from 'lucide-react';

interface ApkIntroPopupProps {
  onClose: () => void;
}

const SLIDES = [
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

export const ApkIntroPopup: React.FC<ApkIntroPopupProps> = ({ onClose }) => {
  const [stepIndex, setStepIndex] = useState(0);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});

  const currentSlide = SLIDES[stepIndex];
  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === SLIDES.length - 1;

  const handleNext = () => {
    if (isLastStep) {
      onClose();
      return;
    }
    setStepIndex((prev) => Math.min(SLIDES.length - 1, prev + 1));
  };

  const handlePrev = () => {
    setStepIndex((prev) => Math.max(0, prev - 1));
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="VaultPay Important Notice"
      className="fixed inset-0 z-[95] flex items-center justify-center bg-[#04070E]/88 p-3 backdrop-blur-md"
    >
      <div className="relative flex max-h-[94vh] w-full max-w-[395px] flex-col overflow-hidden rounded-3xl border border-amber-400/35 bg-[#0C1324] shadow-2xl shadow-black/85">
        {/* Top bar */}
        <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-2.5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-amber-300" />
            <span className="text-xs font-bold text-white">
              VaultPay Notice ({stepIndex + 1} / {SLIDES.length})
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

        {/* Exact Uploaded Photo Display (uncropped & unmodified) */}
        <div className="relative flex-1 overflow-y-auto bg-[#070B14] p-2">
          {failedImages[currentSlide.id] ? (
            <div className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border border-white/10 bg-[#0F172A] p-6 text-center">
              <ShieldCheck className="h-10 w-10 text-amber-300" />
              <p className="mt-2 text-xs font-semibold text-slate-300">
                {currentSlide.alt}
              </p>
            </div>
          ) : (
            <img
              key={currentSlide.id}
              src={currentSlide.image}
              alt={currentSlide.alt}
              referrerPolicy="no-referrer"
              onError={() =>
                setFailedImages((prev) => ({ ...prev, [currentSlide.id]: true }))
              }
              className="mx-auto block h-auto max-h-[68vh] w-full rounded-2xl object-contain"
            />
          )}
        </div>

        {/* Bottom Progress & Controls */}
        <div className="space-y-3 border-t border-white/[0.08] bg-[#0C1324] px-4 py-3">
          {/* 3-step segmented indicator */}
          <div className="flex items-center gap-1.5" aria-hidden="true">
            {SLIDES.map((s, idx) => (
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
                className="inline-flex h-11 items-center justify-center rounded-xl border border-white/10 bg-[#080D1A] px-4 text-xs font-bold text-slate-300 transition-colors hover:border-white/25 hover:text-white whitespace-nowrap shrink-0"
              >
                Skip
              </button>
            ) : (
              <button
                type="button"
                onClick={handlePrev}
                className="inline-flex h-11 items-center justify-center gap-1 rounded-xl border border-white/10 bg-[#080D1A] px-4 text-xs font-bold text-slate-200 transition-colors hover:border-white/25 hover:text-white whitespace-nowrap shrink-0"
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
