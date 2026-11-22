import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  Clock,
  Copy,
  Link2,
  LogOut,
  Phone,
  RefreshCw,
  Share2,
  ShieldCheck,
  Smartphone,
  TrendingUp,
  UserCheck,
  Users,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import {
  AgentDashboardData,
  AuthAccount,
  WithdrawMethod,
  WithdrawRequest,
} from '../types/wallet';
import {
  MIN_AGENT_WITHDRAW_AMOUNT,
  formatINR,
  formatTimestamp,
  generateRefId,
  roundCurrency,
} from '../utils/formatters';
import {
  getFallbackOrderSubmissions,
  getFallbackWithdrawals,
  saveFallbackWithdrawal,
} from '../utils/clientFallbackStore';

interface AgentDashboardViewProps {
  authAccount: AuthAccount;
  onLogout: () => void;
}

export const AgentDashboardView: React.FC<AgentDashboardViewProps> = ({
  authAccount,
  onLogout,
}) => {
  const [data, setData] = useState<AgentDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'orders' | 'users' | 'withdrawals'>('orders');
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'pending' | 'rejected'>('all');

  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [withdrawMethod, setWithdrawMethod] = useState<WithdrawMethod>('upi');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [upiId, setUpiId] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifscCode, setIfscCode] = useState('');
  const [mobileInput, setMobileInput] = useState(
    (authAccount.mobileNumber || '').replace(/\D/g, '').slice(-10)
  );
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawSuccess, setWithdrawSuccess] = useState<string | null>(null);
  const [submittingWithdraw, setSubmittingWithdraw] = useState(false);

  const fetchDashboard = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const qs = new URLSearchParams();
      if (authAccount.mobileNumber) qs.set('mobile', authAccount.mobileNumber);
      if (authAccount.agentId) qs.set('agentId', authAccount.agentId);
      const res = await fetch(`/api/agent/dashboard?${qs.toString()}`, {
        cache: 'no-store',
        headers: {
          'x-agent-mobile': authAccount.mobileNumber || '',
        },
      });
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.toLowerCase().includes('application/json')) {
        const json = (await res.json()) as AgentDashboardData & { ok?: boolean };
        if (json && json.agent) {
          setData(json);
          return;
        }
      }

      // Offline / ephemeral fallback from localStorage
      const refCode = (authAccount.referralCode || `AGENT-${authAccount.agentId || authAccount.userId}`).toUpperCase();
      const candidateCodes = new Set(
        [
          refCode,
          authAccount.agentId ? `AGENT-${authAccount.agentId}`.toUpperCase() : '',
          authAccount.userId ? `AUREX-${authAccount.userId}`.toUpperCase() : '',
          authAccount.userId ? `AGENT-${authAccount.userId}`.toUpperCase() : '',
        ].filter(Boolean)
      );
      const rawRefs = window.localStorage.getItem('aurex_vault_fb_referrals_v1');
      const allRefs = rawRefs ? (JSON.parse(rawRefs) as Array<{ referrerCode?: string; inviteeId?: string; inviteeName?: string; registeredAt?: string; status?: 'registered' | 'completed' }>) : [];
      const joinedMap = new Map<
        string,
        {
          userId: string;
          username: string;
          mobileNumber?: string;
          joinedAt: string;
          status: 'registered' | 'completed';
        }
      >();
      for (const r of allRefs) {
        if (candidateCodes.has((r.referrerCode || '').toUpperCase()) && r.inviteeId) {
          joinedMap.set(r.inviteeId, {
            userId: r.inviteeId,
            username: r.inviteeName || 'User',
            joinedAt: r.registeredAt || '',
            status: r.status || 'registered',
          });
        }
      }

      const rawWallet = window.localStorage.getItem('aurex_vault_wallet_v5');
      const parsedWallet = rawWallet ? (JSON.parse(rawWallet) as { adminOrders?: Array<{ id: string; submissionId?: string; orderCode: string; userUid?: string; userName?: string; userMobile?: string; amount: number; utrRef?: string; referredBy?: string | null; status: string; paidAt?: string; createdAt: string }> }) : null;
      const walletOrders = Array.isArray(parsedWallet?.adminOrders) ? parsedWallet!.adminOrders : [];
      const fbSubs = getFallbackOrderSubmissions();

      const combinedRaw = [
        ...fbSubs.map((s) => ({
          id: s.id,
          orderId: s.orderId,
          orderCode: s.orderCode,
          userUid: s.userUid,
          userName: s.userName,
          userMobile: s.userMobile,
          amount: Number(s.amount || 0),
          utrRef: s.utrRef || '—',
          referredBy: s.referredBy ?? null,
          status: s.status,
          paidAt: s.paidAt || s.createdAt,
          createdAt: s.createdAt,
        })),
        ...walletOrders
          .filter((o) => o.status !== 'active')
          .map((o) => ({
            id: o.submissionId || o.id,
            orderId: o.id,
            orderCode: o.orderCode,
            userUid: o.userUid || '—',
            userName: o.userName || 'User',
            userMobile: o.userMobile,
            amount: Number(o.amount || 0),
            utrRef: o.utrRef || '—',
            referredBy: o.referredBy ?? null,
            status: (o.status === 'success' || o.status === 'rejected' ? o.status : 'pending') as 'pending' | 'success' | 'rejected',
            paidAt: o.paidAt || o.createdAt,
            createdAt: o.createdAt,
          })),
      ];

      const seenOrderIds = new Set<string>();
      const matchedOrders = combinedRaw
        .filter((o) => {
          if (seenOrderIds.has(o.id)) return false;
          seenOrderIds.add(o.id);
          return (
            candidateCodes.has((o.referredBy || '').toUpperCase()) ||
            (o.userUid && joinedMap.has(o.userUid))
          );
        })
        .map((o) => {
          if (o.userUid && o.userUid !== '—') {
            const existing = joinedMap.get(o.userUid);
            joinedMap.set(o.userUid, {
              userId: o.userUid,
              username: existing?.username || o.userName || 'User',
              mobileNumber: existing?.mobileNumber || o.userMobile,
              joinedAt: existing?.joinedAt || o.createdAt,
              status:
                o.status === 'success' || existing?.status === 'completed'
                  ? 'completed'
                  : 'registered',
            });
          }
          return {
            ...o,
            commissionEarned:
              o.status === 'success'
                ? Math.round((Number(o.amount || 0) * 0.05 + Number.EPSILON) * 100) / 100
                : 0,
          };
        });

      const joinedUsers = Array.from(joinedMap.values());
      const approved = matchedOrders.filter((o) => o.status === 'success');
      const rejected = matchedOrders.filter((o) => o.status === 'rejected');
      const pending = matchedOrders.filter((o) => o.status === 'pending');
      const approvedVolume = approved.reduce((sum, o) => sum + o.amount, 0);
      const commissionEarned = roundCurrency(approvedVolume * 0.05);

      const resolvedAgentId = authAccount.agentId || authAccount.userId;
      const fbRaw = [
        ...getFallbackWithdrawals(resolvedAgentId, false),
        ...(authAccount.userId && authAccount.userId !== resolvedAgentId
          ? getFallbackWithdrawals(authAccount.userId, false)
          : []),
      ];
      const seenWdr = new Set<string>();
      const fbWithdrawals = fbRaw.filter((w) => {
        if (seenWdr.has(w.id)) return false;
        seenWdr.add(w.id);
        return (
          w.requesterRole === 'agent' ||
          Boolean(w.agentId) ||
          w.userId === resolvedAgentId
        );
      });
      const withdrawnTotal = roundCurrency(
        fbWithdrawals
          .filter((w) => w.status !== 'Rejected')
          .reduce((sum, w) => sum + Number(w.amount || 0), 0)
      );
      const availableBalance = Math.max(
        0,
        roundCurrency(commissionEarned - withdrawnTotal)
      );

      setData({
        agent: {
          id: resolvedAgentId,
          mobileNumber: authAccount.mobileNumber,
          referralCode: refCode,
          shareUrl: `${window.location.origin}/?agent=${encodeURIComponent(refCode)}`,
          createdAt: authAccount.createdAt,
        },
        joinedUsers,
        joinedCount: joinedUsers.length,
        orders: matchedOrders,
        totalOrdersCount: matchedOrders.length,
        approvedCount: approved.length,
        rejectedCount: rejected.length,
        pendingCount: pending.length,
        approvedVolume,
        commissionEarned,
        withdrawnTotal,
        availableBalance,
        withdrawals: fbWithdrawals,
      });
    } catch {
      // ignore fallback parse errors
    } finally {
      setLoading(false);
      if (isManual) setRefreshing(false);
    }
  }, [authAccount.mobileNumber, authAccount.agentId, authAccount.referralCode, authAccount.userId, authAccount.createdAt]);

  useEffect(() => {
    void fetchDashboard(false);
    const interval = setInterval(() => {
      void fetchDashboard(false);
    }, 5000);
    const onFocus = () => void fetchDashboard(false);
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [fetchDashboard]);

  const fallbackShareUrl = useMemo(() => {
    const code = authAccount.referralCode || `AGENT-${authAccount.userId}`;
    return typeof window !== 'undefined'
      ? `${window.location.origin}/?agent=${encodeURIComponent(code)}`
      : `/?agent=${encodeURIComponent(code)}`;
  }, [authAccount.referralCode, authAccount.userId]);

  const shareUrl = data?.agent.shareUrl || fallbackShareUrl;
  const agentId = data?.agent.id || authAccount.agentId || authAccount.userId;

  const handleCopyUrl = () => {
    void navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleNativeShare = async () => {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: 'VaultPay Agent Invite Link',
          text: 'Join VaultPay using my official agent link:',
          url: shareUrl,
        });
        return;
      } catch {
        // user cancelled or unavailable -> fallback to copy
      }
    }
    handleCopyUrl();
  };

  const orders = data?.orders ?? [];
  const joinedUsers = data?.joinedUsers ?? [];
  const agentWithdrawals = data?.withdrawals ?? [];
  const commissionEarned = data?.commissionEarned ?? 0;
  const withdrawnTotal =
    data?.withdrawnTotal ??
    roundCurrency(
      agentWithdrawals
        .filter((w) => w.status !== 'Rejected')
        .reduce((sum, w) => sum + Number(w.amount || 0), 0)
    );
  const availableBalance =
    data?.availableBalance ??
    Math.max(0, roundCurrency(commissionEarned - withdrawnTotal));

  const filteredOrders = useMemo(() => {
    if (statusFilter === 'all') return orders;
    return orders.filter((o) => o.status === statusFilter);
  }, [orders, statusFilter]);

  const openWithdrawModal = () => {
    setWithdrawError(null);
    setWithdrawSuccess(null);
    setWithdrawAmount(
      availableBalance >= MIN_AGENT_WITHDRAW_AMOUNT
        ? String(availableBalance)
        : String(MIN_AGENT_WITHDRAW_AMOUNT)
    );
    setMobileInput((authAccount.mobileNumber || '').replace(/\D/g, '').slice(-10));
    setShowWithdrawModal(true);
  };

  const handleAgentWithdrawSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setWithdrawError(null);

    const parsedAmount = roundCurrency(Number(withdrawAmount));
    if (!Number.isFinite(parsedAmount) || parsedAmount < MIN_AGENT_WITHDRAW_AMOUNT) {
      setWithdrawError(`Minimum agent withdrawal is ₹${MIN_AGENT_WITHDRAW_AMOUNT}.`);
      return;
    }
    if (parsedAmount > availableBalance + 0.01) {
      setWithdrawError(
        `Insufficient available balance (Available: ${formatINR(availableBalance)}).`
      );
      return;
    }

    const cleanUpi = upiId.trim();
    const cleanBank = bankName.trim();
    const cleanAcc = accountNumber.trim();
    const cleanIfsc = ifscCode.trim().toUpperCase();
    const cleanMobile = mobileInput.replace(/\D/g, '').slice(-10);

    let accountDetailSummary = '';
    if (withdrawMethod === 'upi') {
      if (!cleanUpi || !cleanUpi.includes('@')) {
        setWithdrawError('Please enter a valid UPI ID (e.g. name@okicici).');
        return;
      }
      accountDetailSummary = `UPI ID: ${cleanUpi}`;
    } else if (withdrawMethod === 'bank') {
      if (!cleanBank || cleanAcc.length < 6) {
        setWithdrawError('Please enter valid Bank Name and Account Number.');
        return;
      }
      accountDetailSummary = cleanIfsc
        ? `${cleanBank} · A/C ${cleanAcc} · IFSC ${cleanIfsc}`
        : `${cleanBank} · A/C ${cleanAcc}`;
    } else {
      if (cleanMobile.length !== 10) {
        setWithdrawError('Please enter a valid 10-digit Mobile Number.');
        return;
      }
      accountDetailSummary = `Mobile: +91 ${cleanMobile}`;
    }

    const wdrId = generateRefId('WDR');
    const txId = `tx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const createdAt = formatTimestamp();
    const payload: WithdrawRequest = {
      id: wdrId,
      txId,
      userId: agentId,
      agentId,
      requesterRole: 'agent',
      username: authAccount.username || `Agent_${agentId}`,
      userMobile: authAccount.mobileNumber,
      amount: parsedAmount,
      method: withdrawMethod,
      upiId: withdrawMethod === 'upi' ? cleanUpi : undefined,
      bankName: withdrawMethod === 'bank' ? cleanBank : undefined,
      accountNumber: withdrawMethod === 'bank' ? cleanAcc : undefined,
      ifscCode: withdrawMethod === 'bank' && cleanIfsc ? cleanIfsc : undefined,
      mobileNumber: withdrawMethod === 'mobile' ? cleanMobile : undefined,
      accountDetailSummary,
      status: 'Pending',
      createdAt,
    };

    setSubmittingWithdraw(true);
    try {
      const res = await fetch('/api/withdrawals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const ct = res.headers.get('content-type') || '';
      if (ct.toLowerCase().includes('application/json')) {
        const json = (await res.json()) as {
          ok?: boolean;
          error?: string;
          withdrawal?: WithdrawRequest;
        };
        if (!res.ok) {
          const errMap: Record<string, string> = {
            MIN_AGENT_WITHDRAW_200: `Minimum agent withdrawal is ₹${MIN_AGENT_WITHDRAW_AMOUNT}.`,
            INSUFFICIENT_AGENT_BALANCE: `Insufficient available balance (${formatINR(availableBalance)}).`,
            INVALID_UPI: 'Please enter a valid UPI ID.',
            INVALID_BANK: 'Please enter valid bank details.',
            INVALID_MOBILE: 'Please enter a valid 10-digit mobile number.',
          };
          setWithdrawError(
            errMap[json.error || ''] || 'Could not submit withdrawal request.'
          );
          return;
        }
        saveFallbackWithdrawal(json.withdrawal || payload);
      } else {
        saveFallbackWithdrawal(payload);
      }
    } catch {
      saveFallbackWithdrawal(payload);
    } finally {
      setSubmittingWithdraw(false);
    }

    setWithdrawSuccess(`Withdrawal of ${formatINR(parsedAmount)} sent to Admin!`);
    setActiveTab('withdrawals');
    void fetchDashboard(true);
    setTimeout(() => {
      setShowWithdrawModal(false);
      setWithdrawSuccess(null);
    }, 1100);
  };

  return (
    <div className="min-h-screen bg-[#04070E] text-slate-100">
      <div className="relative mx-auto min-h-screen max-w-[430px] border-x border-white/[0.06] bg-[#070B14] pb-10 shadow-2xl shadow-black">
        {/* Top Agent Header */}
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-white/[0.08] bg-[#070B14]/95 px-4 py-3 backdrop-blur-md">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-purple-400/35 bg-purple-500/15 text-purple-300">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="text-sm font-extrabold tracking-tight text-white">
                  Agent Panel
                </h1>
                <span className="rounded-md border border-purple-400/30 bg-purple-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-purple-300">
                  {agentId}
                </span>
              </div>
              <p className="font-mono text-[10px] text-slate-400">
                +91 {authAccount.mobileNumber} · 5% Commission
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void fetchDashboard(true)}
              aria-label="Refresh Agent Data"
              className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-[#0F172A] text-slate-300 hover:border-purple-400/40 hover:text-white"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex h-8 items-center gap-1 rounded-xl border border-rose-500/30 bg-rose-500/10 px-2.5 text-[11px] font-bold text-rose-300 hover:bg-rose-500/20"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Logout</span>
            </button>
          </div>
        </header>

        <main className="space-y-3.5 px-3.5 pt-4">
          {/* Agent Wallet Hero Card */}
          <section className="rounded-2xl border border-amber-400/30 bg-gradient-to-br from-[#1A243D] via-[#0F172A] to-[#0B1120] p-4 shadow-xl space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-amber-300" />
                <span className="text-xs font-bold text-slate-200">
                  Agent Commission Wallet
                </span>
              </div>
              <span className="rounded-lg border border-emerald-400/30 bg-emerald-500/15 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-300">
                5% Per Success Order
              </span>
            </div>

            <div className="flex items-baseline justify-between gap-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Available to Withdraw
                </p>
                <p className="mt-0.5 font-mono text-3xl font-extrabold tracking-tight text-amber-300 tabular-nums">
                  {formatINR(availableBalance)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-slate-400">Referral Code</p>
                <p className="font-mono text-xs font-bold text-purple-300">
                  {data?.agent.referralCode || authAccount.referralCode}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 rounded-xl border border-white/[0.08] bg-[#080D1A]/80 p-2.5 text-[10px]">
              <div>
                <p className="text-slate-400">Total Earned</p>
                <p className="mt-0.5 font-mono font-bold text-emerald-300 tabular-nums">
                  {formatINR(commissionEarned)}
                </p>
              </div>
              <div>
                <p className="text-slate-400">Withdrawn / Hold</p>
                <p className="mt-0.5 font-mono font-bold text-purple-300 tabular-nums">
                  {formatINR(withdrawnTotal)}
                </p>
              </div>
              <div>
                <p className="text-slate-400">Success Volume</p>
                <p className="mt-0.5 font-mono font-bold text-white tabular-nums">
                  {formatINR(data?.approvedVolume ?? 0)}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={openWithdrawModal}
              className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-400 to-amber-300 px-4 text-xs font-extrabold text-[#070B14] shadow-lg shadow-amber-500/20 transition-transform hover:brightness-105 active:scale-[0.99]"
            >
              <ArrowUpRight className="h-4 w-4" />
              <span>Withdraw Commission (Min ₹{MIN_AGENT_WITHDRAW_AMOUNT})</span>
            </button>
          </section>

          {/* Shareable Agent URL Card */}
          <section className="rounded-2xl border border-purple-400/25 bg-[#0F172A] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Link2 className="h-4 w-4 text-purple-300" />
                <h2 className="text-xs font-bold text-white">Your Shareable Agent Link</h2>
              </div>
              <span className="text-[10px] font-semibold text-emerald-400">
                Auto-tracks logins & payments
              </span>
            </div>

            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#080D1A] p-2.5">
              <input
                type="text"
                readOnly
                value={shareUrl}
                aria-label="Shareable Agent URL"
                className="w-full bg-transparent font-mono text-[11px] text-slate-200 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleCopyUrl}
                className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-emerald-500 px-2.5 text-[11px] font-bold text-[#070B14] hover:bg-emerald-400"
              >
                <Copy className="h-3.5 w-3.5" />
                <span>{copied ? 'Copied!' : 'Copy'}</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => void handleNativeShare()}
              className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-purple-400/30 bg-purple-500/15 text-xs font-bold text-purple-200 hover:bg-purple-500/25"
            >
              <Share2 className="h-3.5 w-3.5" />
              <span>Share Link With Users</span>
            </button>
          </section>

          {/* Key Analytics Grid */}
          <section className="grid grid-cols-2 gap-2.5">
            <div className="rounded-2xl border border-sky-400/25 bg-[#0F172A] p-3">
              <div className="flex items-center justify-between text-sky-300">
                <span className="text-[11px] font-medium text-slate-400">Users Joined</span>
                <Users className="h-4 w-4" />
              </div>
              <p className="mt-1 font-mono text-xl font-extrabold text-white tabular-nums">
                {data?.joinedCount ?? 0}
              </p>
              <p className="text-[10px] text-sky-400">Logged in via your URL</p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-[#0F172A] p-3">
              <div className="flex items-center justify-between text-purple-300">
                <span className="text-[11px] font-medium text-slate-400">Total Payments</span>
                <TrendingUp className="h-4 w-4" />
              </div>
              <p className="mt-1 font-mono text-xl font-extrabold text-white tabular-nums">
                {data?.totalOrdersCount ?? 0}
              </p>
              <p className="text-[10px] text-slate-400">
                Pending: {data?.pendingCount ?? 0}
              </p>
            </div>

            <div className="rounded-2xl border border-emerald-400/25 bg-[#0F172A] p-3">
              <div className="flex items-center justify-between text-emerald-400">
                <span className="text-[11px] font-medium text-slate-400">Success Payments</span>
                <CheckCircle2 className="h-4 w-4" />
              </div>
              <p className="mt-1 font-mono text-xl font-extrabold text-emerald-300 tabular-nums">
                {data?.approvedCount ?? 0}
              </p>
              <p className="text-[10px] text-emerald-400">5% Wallet Credited</p>
            </div>

            <div className="rounded-2xl border border-rose-400/25 bg-[#0F172A] p-3">
              <div className="flex items-center justify-between text-rose-400">
                <span className="text-[11px] font-medium text-slate-400">Failed / Rejected</span>
                <XCircle className="h-4 w-4" />
              </div>
              <p className="mt-1 font-mono text-xl font-extrabold text-rose-300 tabular-nums">
                {data?.rejectedCount ?? 0}
              </p>
              <p className="text-[10px] text-rose-400">Rejected by Admin</p>
            </div>
          </section>

          {/* Switch Tabs: Orders vs Joined Users vs Withdrawals */}
          <div className="grid grid-cols-3 gap-1.5 rounded-xl border border-white/10 bg-[#0F172A] p-1">
            <button
              type="button"
              onClick={() => setActiveTab('orders')}
              className={`h-9 rounded-lg text-[11px] font-bold transition-colors ${
                activeTab === 'orders'
                  ? 'bg-amber-400 text-[#070B14]'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Orders ({orders.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('users')}
              className={`h-9 rounded-lg text-[11px] font-bold transition-colors ${
                activeTab === 'users'
                  ? 'bg-amber-400 text-[#070B14]'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Users ({joinedUsers.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('withdrawals')}
              className={`h-9 rounded-lg text-[11px] font-bold transition-colors ${
                activeTab === 'withdrawals'
                  ? 'bg-purple-500 text-white'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Withdraws ({agentWithdrawals.length})
            </button>
          </div>

          {activeTab === 'orders' ? (
            <section className="rounded-2xl border border-white/10 bg-[#0F172A] p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xs font-bold text-white">
                  Referral Payment Records
                </h2>
                <div className="flex items-center gap-1">
                  {(['all', 'success', 'pending', 'rejected'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setStatusFilter(st)}
                      className={`rounded-lg px-2 py-1 text-[10px] font-bold capitalize ${
                        statusFilter === st
                          ? 'bg-purple-500 text-white'
                          : 'bg-[#080D1A] text-slate-400 hover:text-white'
                      }`}
                    >
                      {st === 'rejected' ? 'Failed' : st}
                    </button>
                  ))}
                </div>
              </div>

              {loading && !data ? (
                <p className="py-6 text-center text-xs text-slate-400">
                  Loading agent transactions...
                </p>
              ) : filteredOrders.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-500">
                  No payments recorded under your link yet.
                </p>
              ) : (
                <div className="divide-y divide-white/[0.07]">
                  {filteredOrders.map((ord) => {
                    const isSuccess = ord.status === 'success';
                    const isRejected = ord.status === 'rejected';
                    return (
                      <div key={ord.id} className="space-y-1.5 py-3 first:pt-1 last:pb-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-xs font-bold text-white">
                                {ord.orderCode}
                              </span>
                              <span
                                className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-bold ${
                                  isSuccess
                                    ? 'bg-emerald-500/15 text-emerald-300'
                                    : isRejected
                                    ? 'bg-rose-500/15 text-rose-300'
                                    : 'bg-amber-400/15 text-amber-300'
                                }`}
                              >
                                {isSuccess && <CheckCircle2 className="h-2.5 w-2.5" />}
                                {isRejected && <XCircle className="h-2.5 w-2.5" />}
                                {!isSuccess && !isRejected && <Clock className="h-2.5 w-2.5" />}
                                {isSuccess ? 'Success' : isRejected ? 'Failed / Rejected' : 'Pending'}
                              </span>
                            </div>
                            <p className="mt-0.5 text-[11px] text-slate-300">
                              {ord.userName} (ID: {ord.userUid})
                            </p>
                          </div>

                          <div className="text-right">
                            <p className="font-mono text-sm font-bold text-white tabular-nums">
                              {formatINR(ord.amount)}
                            </p>
                            <p
                              className={`font-mono text-[10px] font-bold ${
                                isSuccess
                                  ? 'text-amber-300'
                                  : isRejected
                                  ? 'text-rose-400'
                                  : 'text-slate-400'
                              }`}
                            >
                              {isSuccess
                                ? `+${formatINR(ord.commissionEarned)} (5%)`
                                : isRejected
                                ? '₹0.00 (Rejected)'
                                : 'Awaiting Admin'}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center justify-between font-mono text-[10px] text-slate-500">
                          <span>UTR: {ord.utrRef || '—'}</span>
                          <span>{ord.paidAt || ord.createdAt}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          ) : activeTab === 'users' ? (
            <section className="rounded-2xl border border-white/10 bg-[#0F172A] p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-bold text-white">
                  Users Joined via Your Link
                </h2>
                <UserCheck className="h-4 w-4 text-sky-300" />
              </div>

              {joinedUsers.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-500">
                  No users have joined using your link yet. Share your link to invite users!
                </p>
              ) : (
                <div className="divide-y divide-white/[0.07]">
                  {joinedUsers.map((u) => (
                    <div
                      key={u.userId}
                      className="flex items-center justify-between gap-2 py-2.5 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-bold text-white">{u.username}</p>
                        <p className="font-mono text-[10px] text-slate-400">
                          ID: {u.userId}
                          {u.mobileNumber ? ` · +91 ${u.mobileNumber}` : ''}
                        </p>
                        <p className="text-[10px] text-slate-500">Joined: {u.joinedAt}</p>
                      </div>
                      <span
                        className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-bold ${
                          u.status === 'completed'
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : 'bg-sky-500/15 text-sky-300'
                        }`}
                      >
                        {u.status === 'completed' ? 'Paid & Approved' : 'Joined'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ) : (
            <section className="rounded-2xl border border-purple-400/25 bg-[#0F172A] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-bold text-white">
                  Agent Withdrawal History
                </h2>
                <button
                  type="button"
                  onClick={openWithdrawModal}
                  className="inline-flex h-7 items-center gap-1 rounded-lg bg-purple-500 px-2.5 text-[10px] font-bold text-white hover:bg-purple-400"
                >
                  <ArrowUpRight className="h-3 w-3" />
                  <span>New Withdraw</span>
                </button>
              </div>

              {agentWithdrawals.length === 0 ? (
                <div className="py-6 text-center space-y-2">
                  <p className="text-xs text-slate-500">
                    No withdrawal requests yet. Minimum withdrawal starts at ₹{MIN_AGENT_WITHDRAW_AMOUNT}.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-white/[0.07]">
                  {agentWithdrawals.map((w) => {
                    const isSuccess = w.status === 'Success';
                    const isRejected = w.status === 'Rejected';
                    return (
                      <div key={w.id} className="space-y-1 py-3 first:pt-1 last:pb-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-bold text-white tabular-nums">
                              {formatINR(w.amount)}
                            </span>
                            <span className="rounded border border-purple-400/30 bg-purple-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-purple-200">
                              {w.method}
                            </span>
                          </div>
                          <span
                            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold ${
                              isSuccess
                                ? 'bg-emerald-500/15 text-emerald-300'
                                : isRejected
                                ? 'bg-rose-500/15 text-rose-300'
                                : 'bg-amber-400/15 text-amber-300'
                            }`}
                          >
                            {isSuccess && <CheckCircle2 className="h-2.5 w-2.5" />}
                            {isRejected && <XCircle className="h-2.5 w-2.5" />}
                            {!isSuccess && !isRejected && <Clock className="h-2.5 w-2.5" />}
                            <span>
                              {isSuccess
                                ? 'Approved · Paid'
                                : isRejected
                                ? 'Rejected · Refunded'
                                : 'Pending Admin'}
                            </span>
                          </span>
                        </div>
                        <p className="font-mono text-[11px] font-semibold text-emerald-300">
                          {w.accountDetailSummary}
                        </p>
                        <div className="flex items-center justify-between font-mono text-[10px] text-slate-500">
                          <span>ID: {w.id}</span>
                          <span>{w.createdAt}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}
        </main>
      </div>

      {/* Agent Withdrawal Modal */}
      {showWithdrawModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Withdraw Agent Commission"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4"
        >
          <div className="max-h-[92vh] w-full max-w-[410px] overflow-y-auto rounded-t-3xl border border-purple-400/35 bg-[#0F172A] shadow-2xl sm:rounded-3xl">
            <div className="mx-auto mt-2.5 h-1 w-9 rounded-full bg-slate-700 sm:hidden" />

            <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <ArrowUpRight className="h-4 w-4 text-purple-300" />
                <span>Withdraw Commission</span>
              </div>
              <button
                type="button"
                onClick={() => setShowWithdrawModal(false)}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white/[0.06] hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-4">
              {withdrawSuccess ? (
                <div className="flex flex-col items-center py-6 text-center">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
                    <CheckCircle2 className="h-6 w-6" />
                  </div>
                  <p className="mt-3 text-sm font-bold text-white">{withdrawSuccess}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Admin will see your Agent Withdrawal in purple highlight.
                  </p>
                </div>
              ) : (
                <form onSubmit={(e) => void handleAgentWithdrawSubmit(e)} noValidate className="space-y-3">
                  <div className="flex items-center justify-between rounded-xl border border-purple-400/25 bg-[#080D1A] px-3 py-2 text-xs">
                    <span className="text-slate-400">Available Commission</span>
                    <span className="font-mono font-bold text-amber-300 tabular-nums">
                      {formatINR(availableBalance)}
                    </span>
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-medium text-slate-300">
                        Amount (Min ₹{MIN_AGENT_WITHDRAW_AMOUNT})
                      </label>
                      {availableBalance > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setWithdrawAmount(String(availableBalance));
                            setWithdrawError(null);
                          }}
                          className="text-[11px] font-semibold text-purple-300 hover:text-purple-200"
                        >
                          Use Max
                        </button>
                      )}
                    </div>
                    <div className="relative mt-1">
                      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-sm font-bold text-slate-400">
                        ₹
                      </span>
                      <input
                        type="number"
                        step="any"
                        value={withdrawAmount}
                        onChange={(e) => {
                          setWithdrawAmount(e.target.value);
                          if (withdrawError) setWithdrawError(null);
                        }}
                        placeholder="200"
                        className="h-10 w-full rounded-xl border border-white/10 bg-[#080D1A] pr-3 pl-7 font-mono text-base font-bold text-white focus:border-purple-400 focus:outline-none tabular-nums"
                      />
                    </div>

                    <div className="mt-2 grid grid-cols-4 gap-1.5">
                      {[200, 500, 1000].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => {
                            setWithdrawAmount(String(preset));
                            setWithdrawError(null);
                          }}
                          className="h-7 rounded-lg border border-white/10 bg-[#080D1A] font-mono text-[11px] font-bold text-slate-300 hover:border-purple-400/50 hover:text-white"
                        >
                          ₹{preset}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          setWithdrawAmount(String(availableBalance));
                          setWithdrawError(null);
                        }}
                        className="h-7 rounded-lg border border-purple-400/30 bg-purple-500/15 font-mono text-[11px] font-bold text-purple-200 hover:bg-purple-500/25"
                      >
                        MAX
                      </button>
                    </div>
                  </div>

                  {/* Payout Method Switch */}
                  <div>
                    <p className="text-[11px] font-medium text-slate-300 mb-1.5">
                      Payout Method
                    </p>
                    <div className="grid grid-cols-3 gap-1.5 rounded-xl border border-white/10 bg-[#080D1A] p-1">
                      <button
                        type="button"
                        onClick={() => {
                          setWithdrawMethod('upi');
                          setWithdrawError(null);
                        }}
                        className={`inline-flex h-8 items-center justify-center gap-1 rounded-lg text-[11px] font-bold ${
                          withdrawMethod === 'upi'
                            ? 'bg-purple-500 text-white'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        <Smartphone className="h-3.5 w-3.5" />
                        <span>UPI ID</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setWithdrawMethod('bank');
                          setWithdrawError(null);
                        }}
                        className={`inline-flex h-8 items-center justify-center gap-1 rounded-lg text-[11px] font-bold ${
                          withdrawMethod === 'bank'
                            ? 'bg-purple-500 text-white'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        <Building2 className="h-3.5 w-3.5" />
                        <span>Bank</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setWithdrawMethod('mobile');
                          setWithdrawError(null);
                        }}
                        className={`inline-flex h-8 items-center justify-center gap-1 rounded-lg text-[11px] font-bold ${
                          withdrawMethod === 'mobile'
                            ? 'bg-purple-500 text-white'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        <Phone className="h-3.5 w-3.5" />
                        <span>Mobile</span>
                      </button>
                    </div>
                  </div>

                  {withdrawMethod === 'upi' && (
                    <div>
                      <label className="text-[11px] font-medium text-slate-300">
                        UPI ID
                      </label>
                      <input
                        type="text"
                        value={upiId}
                        onChange={(e) => setUpiId(e.target.value)}
                        placeholder="agentname@okhdfcbank"
                        className="mt-1 h-9 w-full rounded-xl border border-white/10 bg-[#080D1A] px-3 text-xs text-white focus:border-purple-400 focus:outline-none"
                      />
                    </div>
                  )}

                  {withdrawMethod === 'bank' && (
                    <div className="space-y-2">
                      <div>
                        <label className="text-[11px] font-medium text-slate-300">
                          Bank Name
                        </label>
                        <input
                          type="text"
                          value={bankName}
                          onChange={(e) => setBankName(e.target.value)}
                          placeholder="State Bank of India"
                          className="mt-1 h-9 w-full rounded-xl border border-white/10 bg-[#080D1A] px-3 text-xs text-white focus:border-purple-400 focus:outline-none"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[11px] font-medium text-slate-300">
                            Account Number
                          </label>
                          <input
                            type="text"
                            value={accountNumber}
                            onChange={(e) => setAccountNumber(e.target.value)}
                            placeholder="1234567890"
                            className="mt-1 h-9 w-full rounded-xl border border-white/10 bg-[#080D1A] px-3 font-mono text-xs text-white focus:border-purple-400 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] font-medium text-slate-300">
                            IFSC Code
                          </label>
                          <input
                            type="text"
                            value={ifscCode}
                            onChange={(e) => setIfscCode(e.target.value)}
                            placeholder="SBIN0001234"
                            className="mt-1 h-9 w-full rounded-xl border border-white/10 bg-[#080D1A] px-3 font-mono text-xs uppercase text-white focus:border-purple-400 focus:outline-none"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {withdrawMethod === 'mobile' && (
                    <div>
                      <label className="text-[11px] font-medium text-slate-300">
                        10-Digit Payout Mobile Number
                      </label>
                      <input
                        type="tel"
                        maxLength={10}
                        value={mobileInput}
                        onChange={(e) =>
                          setMobileInput(e.target.value.replace(/\D/g, '').slice(0, 10))
                        }
                        placeholder="9876543210"
                        className="mt-1 h-9 w-full rounded-xl border border-white/10 bg-[#080D1A] px-3 font-mono text-xs text-white focus:border-purple-400 focus:outline-none"
                      />
                    </div>
                  )}

                  {withdrawError && (
                    <div className="flex items-start gap-2 rounded-xl border border-rose-500/35 bg-rose-500/15 px-3 py-2 text-[11px] text-rose-200">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
                      <span>{withdrawError}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={submittingWithdraw}
                    className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-purple-500 to-fuchsia-500 px-4 text-xs font-extrabold text-white shadow-lg shadow-purple-500/25 hover:brightness-110 disabled:opacity-50"
                  >
                    <ArrowUpRight className="h-4 w-4" />
                    <span>
                      {submittingWithdraw ? 'Submitting...' : 'Submit Agent Withdrawal'}
                    </span>
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
