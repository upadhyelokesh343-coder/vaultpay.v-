import React, { useState, useRef, useEffect } from 'react';
import { Bell, Check, Copy, CheckCheck, User, Languages } from 'lucide-react';
import { AppNotification, NavTab, UserProfile } from '../types/wallet';
import { useLanguage } from '../i18n/LanguageContext';
import { localizeNotification } from '../i18n/localizeRecords';

interface TopHeaderProps {
  profile: UserProfile;
  notifications: AppNotification[];
  onSelectTab: (tab: NavTab) => void;
  onMarkNotificationsRead: () => void;
}

export const TopHeader: React.FC<TopHeaderProps> = ({
  profile,
  notifications,
  onSelectTab,
  onMarkNotificationsRead,
}) => {
  const { lang, t, toggleLang } = useLanguage();
  const [copied, setCopied] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setNotifOpen(false);
      }
    }
    if (notifOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [notifOpen]);

  const handleCopyId = async () => {
    try {
      await navigator.clipboard.writeText(profile.userId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      const el = document.createElement('textarea');
      el.value = profile.userId;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.07] bg-[#070B14]/95 backdrop-blur-md">
      <div className="flex h-14 items-center justify-between gap-2 px-3.5">
        {/* Left: User Avatar, Username, Copyable ID */}
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={() => onSelectTab('my')}
            aria-label={t.openProfileAdmin}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-400/25 bg-gradient-to-br from-[#16223D] to-[#0D1528] text-amber-300 transition-colors hover:border-amber-400/50"
          >
            <User className="h-4 w-4" />
          </button>

          <div className="min-w-0">
            <span className="block truncate text-sm font-semibold tracking-tight text-slate-50">
              {profile.username}
            </span>
            <div className="flex items-center gap-1 text-[11px] text-slate-400">
              <span className="font-mono tabular-nums">ID: {profile.userId}</span>
              <button
                type="button"
                onClick={handleCopyId}
                aria-label={t.copyUserId}
                className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[11px] font-medium text-amber-300 hover:bg-amber-400/10"
              >
                {copied ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-400" />
                    <span className="text-emerald-400">{t.copied}</span>
                  </>
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Right: Top Language Toggle Button + Notification Bell */}
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={toggleLang}
            aria-label={t.switchLangAria}
            className="inline-flex h-9 items-center gap-1 rounded-xl border border-amber-400/35 bg-[#10182C] px-2.5 text-xs font-bold text-amber-300 transition-colors hover:border-amber-400/60 hover:bg-[#16223D] active:scale-[0.97]"
          >
            <Languages className="h-3.5 w-3.5 shrink-0" />
            <span>{t.switchLangLabel}</span>
          </button>

          <div className="relative shrink-0" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setNotifOpen((prev) => !prev)}
              aria-label={`${t.notifications} (${unreadCount})`}
              className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-[#10182C] text-slate-200 transition-colors hover:border-amber-400/35 hover:text-amber-300"
            >
              <Bell className="h-4 w-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-400 px-1 font-mono text-[10px] font-bold text-[#070B14] tabular-nums">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {notifOpen && (
              <div className="absolute right-0 mt-2 w-72 overflow-hidden rounded-2xl border border-white/10 bg-[#0F172A] shadow-2xl shadow-black/70">
                <div className="flex items-center justify-between border-b border-white/[0.08] px-3.5 py-2.5">
                  <span className="text-xs font-semibold text-slate-100">
                    {t.notifications}
                  </span>
                  {unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={onMarkNotificationsRead}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 hover:text-emerald-300"
                    >
                      <CheckCheck className="h-3 w-3" />
                      {t.markRead}
                    </button>
                  )}
                </div>
                <div className="max-h-64 divide-y divide-white/[0.06] overflow-y-auto">
                  {notifications.length === 0 ? (
                    <p className="px-3.5 py-5 text-center text-xs text-slate-400">
                      {t.noNotifications}
                    </p>
                  ) : (
                    notifications.slice(0, 8).map((n) => {
                      const localized = localizeNotification(n, lang);
                      return (
                        <div
                          key={n.id}
                          className={`px-3.5 py-2.5 ${n.read ? 'opacity-70' : 'bg-amber-400/[0.04]'}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-xs font-semibold text-slate-100">
                              {localized.title}
                            </p>
                            {!n.read && (
                              <span className="shrink-0 text-[10px] font-medium text-amber-300">
                                {t.newBadge}
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-300">
                            {localized.message}
                          </p>
                          <p className="mt-1 font-mono text-[10px] text-slate-500 tabular-nums">
                            {n.timestamp}
                          </p>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
