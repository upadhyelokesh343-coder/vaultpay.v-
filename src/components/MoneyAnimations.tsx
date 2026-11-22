import React, { useEffect, useRef, useState } from 'react';

const INTRO_SHOWER: Array<{
  left: string;
  kind: 'coin' | 'note';
  size: number;
  delay: string;
  duration: string;
  drift: string;
}> = [
  { left: '6%', kind: 'coin', size: 22, delay: '0s', duration: '1.35s', drift: '-18px' },
  { left: '14%', kind: 'note', size: 28, delay: '0.28s', duration: '1.5s', drift: '14px' },
  { left: '22%', kind: 'coin', size: 26, delay: '0.12s', duration: '1.25s', drift: '-12px' },
  { left: '30%', kind: 'coin', size: 19, delay: '0.55s', duration: '1.4s', drift: '16px' },
  { left: '38%', kind: 'note', size: 30, delay: '0.18s', duration: '1.55s', drift: '-20px' },
  { left: '46%', kind: 'coin', size: 24, delay: '0.4s', duration: '1.2s', drift: '10px' },
  { left: '54%', kind: 'coin', size: 21, delay: '0.06s', duration: '1.3s', drift: '-14px' },
  { left: '62%', kind: 'note', size: 28, delay: '0.62s', duration: '1.45s', drift: '18px' },
  { left: '70%', kind: 'coin', size: 27, delay: '0.24s', duration: '1.28s', drift: '-16px' },
  { left: '78%', kind: 'coin', size: 20, delay: '0.48s', duration: '1.38s', drift: '12px' },
  { left: '86%', kind: 'note', size: 28, delay: '0.15s', duration: '1.52s', drift: '-15px' },
  { left: '93%', kind: 'coin', size: 23, delay: '0.35s', duration: '1.26s', drift: '14px' },
  { left: '10%', kind: 'coin', size: 18, delay: '0.78s', duration: '1.32s', drift: '16px' },
  { left: '26%', kind: 'note', size: 26, delay: '0.92s', duration: '1.48s', drift: '-12px' },
  { left: '42%', kind: 'coin', size: 22, delay: '0.72s', duration: '1.18s', drift: '20px' },
  { left: '58%', kind: 'note', size: 27, delay: '0.86s', duration: '1.42s', drift: '-18px' },
  { left: '74%', kind: 'coin', size: 24, delay: '0.68s', duration: '1.22s', drift: '14px' },
  { left: '89%', kind: 'coin', size: 19, delay: '0.95s', duration: '1.36s', drift: '-16px' },
];

const GoldCoinBadge: React.FC<{ size?: number }> = ({ size = 22 }) => (
  <span
    style={{ width: size, height: size, fontSize: Math.round(size * 0.54) }}
    className="inline-flex items-center justify-center rounded-full border border-yellow-200/90 bg-gradient-to-br from-yellow-200 via-amber-400 to-amber-700 font-extrabold text-[#451A03] shadow-[0_2px_8px_rgba(245,158,11,0.65)]"
  >
    ₹
  </span>
);

const EmeraldNoteBadge: React.FC<{ width?: number }> = ({ width = 28 }) => (
  <span
    style={{
      width,
      height: Math.round((width * 17) / 28),
      fontSize: Math.max(9, Math.round(width * 0.38)),
    }}
    className="inline-flex items-center justify-center rounded-[4px] border border-emerald-200/80 bg-gradient-to-br from-emerald-300 via-emerald-500 to-emerald-800 font-black text-amber-100 shadow-[0_2px_8px_rgba(16,185,129,0.55)]"
  >
    ₹
  </span>
);

interface LaunchIntroOverlayProps {
  onFinish: () => void;
}

export const LaunchIntroOverlay: React.FC<LaunchIntroOverlayProps> = ({
  onFinish,
}) => {
  const [fading, setFading] = useState(false);
  const onFinishRef = useRef(onFinish);
  const dismissedRef = useRef(false);

  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) {
      onFinishRef.current();
      return;
    }

    const fadeTimer = window.setTimeout(() => {
      setFading(true);
    }, 5000);

    const doneTimer = window.setTimeout(() => {
      if (!dismissedRef.current) {
        dismissedRef.current = true;
        onFinishRef.current();
      }
    }, 5450);

    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(doneTimer);
    };
  }, []);

  const handleDismiss = () => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    setFading(true);
    window.setTimeout(() => onFinishRef.current(), 220);
  };

  return (
    <div
      onClick={handleDismiss}
      role="presentation"
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-[#04070E]/96 backdrop-blur-md transition-opacity duration-300 ${
        fading ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute h-80 w-80 rounded-full bg-amber-400/20 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute translate-y-16 h-64 w-64 rounded-full bg-emerald-500/15 blur-3xl"
      />

      {/* Fast continuous rising golden coins & cash notes shower (APK launch only) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 mx-auto max-w-[430px] overflow-hidden"
      >
        {INTRO_SHOWER.map((item, idx) => (
          <span
            key={idx}
            style={
              {
                left: item.left,
                '--drift': item.drift,
                animationDelay: item.delay,
                animationDuration: item.duration,
              } as React.CSSProperties
            }
            className="vp-intro-coin-rise absolute bottom-[-40px]"
          >
            {item.kind === 'note' ? (
              <EmeraldNoteBadge width={item.size} />
            ) : (
              <GoldCoinBadge size={item.size} />
            )}
          </span>
        ))}
      </div>

      {/* Center VaultPay Medallion */}
      <div className="relative z-10 flex flex-col items-center px-6 text-center">
        <div className="relative flex h-28 w-28 items-center justify-center">
          <span
            aria-hidden="true"
            className="vp-intro-halo absolute inset-0 rounded-full border-2 border-amber-400/55"
          />
          <span
            aria-hidden="true"
            className="vp-intro-halo-delayed absolute -inset-4 rounded-full border border-emerald-400/35"
          />
          <div className="vp-intro-medallion flex h-22 w-22 items-center justify-center rounded-3xl border border-amber-300/60 bg-gradient-to-br from-[#1B2A4E] via-[#0F172A] to-[#080D1A] shadow-2xl shadow-amber-500/30">
            <div className="vp-intro-spin">
              <GoldCoinBadge size={52} />
            </div>
          </div>
        </div>

        <h1 className="vp-intro-text mt-5 text-3xl font-extrabold tracking-tight text-white">
          Vault<span className="text-amber-300">Pay</span>
        </h1>
        <p className="vp-intro-text mt-1 text-xs font-semibold tracking-wide text-emerald-300">
          Instant Cashback · Secure Wallet
        </p>

        {/* Gold shimmer 5.0s progress bar */}
        <div className="mt-5 h-1.5 w-44 overflow-hidden rounded-full bg-white/10">
          <div className="vp-intro-progress h-full rounded-full bg-gradient-to-r from-amber-400 via-yellow-200 to-emerald-400" />
        </div>

        <p className="mt-4 text-[11px] font-medium text-slate-400">
          Tap anywhere to enter
        </p>
      </div>
    </div>
  );
};
