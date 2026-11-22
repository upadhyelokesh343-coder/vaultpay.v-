import React from 'react';
import { Link2, ClipboardCheck, Users, History } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';

interface QuickActionsGridProps {
  onOpenOrders: () => void;
  onOpenDailyTask: () => void;
  onOpenReferral: () => void;
  onOpenOrderHistory: () => void;
}

export const QuickActionsGrid: React.FC<QuickActionsGridProps> = ({
  onOpenOrders,
  onOpenDailyTask,
  onOpenReferral,
  onOpenOrderHistory,
}) => {
  const { t } = useLanguage();

  const actions = [
    {
      id: 'paylink',
      label: t.actionOrderLinks,
      icon: Link2,
      accentClass: 'text-emerald-300 border-emerald-400/20 bg-emerald-500/10',
      onClick: onOpenOrders,
    },
    {
      id: 'task',
      label: t.actionDailyTask,
      icon: ClipboardCheck,
      accentClass: 'text-amber-300 border-amber-400/20 bg-amber-400/10',
      onClick: onOpenDailyTask,
    },
    {
      id: 'team',
      label: t.actionTeam,
      icon: Users,
      accentClass: 'text-sky-300 border-sky-400/20 bg-sky-500/10',
      onClick: onOpenReferral,
    },
    {
      id: 'history',
      label: t.actionHistory,
      icon: History,
      accentClass: 'text-slate-200 border-white/15 bg-white/[0.06]',
      onClick: onOpenOrderHistory,
    },
  ];

  return (
    <section aria-label={t.quickActionsAria} className="grid grid-cols-4 gap-2">
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.id}
            type="button"
            onClick={action.onClick}
            className="flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-white/[0.07] bg-[#0F172A] px-1.5 py-2.5 text-center transition-colors hover:border-amber-400/35 hover:bg-[#131E38] active:scale-[0.97]"
          >
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-xl border ${action.accentClass}`}
            >
              <Icon className="h-4 w-4" />
            </div>
            <span className="text-[11px] leading-tight font-medium text-slate-200">
              {action.label}
            </span>
          </button>
        );
      })}
    </section>
  );
};
