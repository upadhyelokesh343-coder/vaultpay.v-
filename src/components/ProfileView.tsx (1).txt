import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Shield,
  PlusCircle,
  ClipboardCheck,
  ArrowUpRight,
  Users,
  MessageCircle,
  Lock,
  ChevronRight,
  ArrowLeft,
  Search,
  RefreshCw,
  Clock,
  CheckCircle2,
  XCircle,
  Send,
  ImagePlus,
  X,
  CheckCheck,
  Copy,
  ShieldCheck,
  LogOut,
  Phone,
  Trash2,
  Check,
  Gift,
  Share2,
} from 'lucide-react';
import { AdminOrder, WithdrawRequest, AdminUserRecord, AdminChatThread, AgentAccount, ReferralRecord } from '../types/wallet';
import { formatINR, formatTimestamp, COMMISSION_RATE, normalizeIndianMobile } from '../utils/formatters';
import { useLanguage } from '../i18n/LanguageContext';
import { compressImageFileToDataUrl } from '../utils/imageHelper';
import { registerFallbackAccount } from '../utils/clientFallbackStore';

interface ProfileViewProps {
  isAdmin?: boolean;
  referredBy?: string | null;
  referrals?: ReferralRecord[];
  referralBonusEarned?: number;
  walletBalance: number;
  totalPaid: number;
  totalWithdrawal: number;
  defaultPaymentLink: string;
  adminOrders: AdminOrder[];
  withdrawRequests: WithdrawRequest[];
  adminUsers: AdminUserRecord[];
  adminChatThreads: AdminChatThread[];
  authAccount: {
    userId: string;
    mobileNumber: string;
    username: string;
    referredBy: string | null;
    referralCode: string;
    createdAt: string;
  } | null;
  profile: {
    username: string;
    userId: string;
    mobileNumber?: string;
    upiId: string;
    bankName: string;
    accountLast4: string;
  };
  onSaveProfile: (profile: {
    username: string;
    upiId: string;
    bankName: string;
    accountLast4: string;
  }) => void;
  onAddAdminOrder: (amountInr: number, customLink?: string) => { ok: boolean; error?: string };
  onRemoveAdminOrder: (orderId: string) => void;
  onUpdateWithdrawStatus: (withdrawalId: string, status: 'Success' | 'Rejected') => void;
  onUpdatePaymentSubmissionStatus: (submissionId: string, status: 'success' | 'rejected') => void;
  onRefreshAdminUsers: () => void;
  onRefreshAdminMessages: () => void;
  onRefreshAdminOrders?: () => void;
  onRefreshAdminWithdrawals?: () => void;
  onRefreshReferrals?: () => void;
  onSendAdminChatReply: (
    userId: string,
    text: string,
    imageData?: string
  ) => Promise<{ ok: boolean; error?: string }>;
  onMarkAdminChatRead: (userId: string) => void;
  onResetUserPassword: (
    userId: string,
    newPassword: string
  ) => Promise<{ ok: boolean; error?: string }>;
  onLogoutAccount?: () => void;
  onApproveOrder?: (orderId: string) => void;
  onRejectOrder?: (orderId: string) => void;
  onApproveWithdrawal?: (withdrawalId: string) => void;
  onRejectWithdrawal?: (withdrawalId: string) => void;
}

type ProfileScreen =
  | 'main'
  | 'admin_menu'
  | 'admin_add_order'
  | 'admin_approvals'
  | 'admin_withdrawals'
  | 'admin_users'
  | 'admin_messages';

function getAvatarColor(seed: string): string {
  const palette = [
    'bg-emerald-500/20 text-emerald-300 border-emerald-400/35',
    'bg-sky-500/20 text-sky-300 border-sky-400/35',
    'bg-amber-500/20 text-amber-300 border-amber-400/35',
    'bg-purple-500/20 text-purple-300 border-purple-400/35',
    'bg-rose-500/20 text-rose-300 border-rose-400/35',
  ];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  return palette[Math.abs(hash) % palette.length];
}

function getInitials(name: string): string {
  const clean = name.trim();
  if (!clean) return 'U';
  const parts = clean.split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}

function formatChatTime(ts?: string): string {
  if (!ts) return '';
  const parts = ts.split(' ');
  if (parts.length >= 2) {
    const timeParts = parts[1].split(':');
    if (timeParts.length >= 2) {
      return `${timeParts[0]}:${timeParts[1]}`;
    }
  }
  return ts;
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  isAdmin,
  referredBy = null,
  referrals = [],
  referralBonusEarned = 0,
  walletBalance,
  totalPaid,
  totalWithdrawal,
  defaultPaymentLink,
  adminOrders,
  withdrawRequests,
  adminUsers,
  adminChatThreads,
  authAccount,
  profile,
  onSaveProfile,
  onAddAdminOrder,
  onRemoveAdminOrder,
  onUpdateWithdrawStatus,
  onUpdatePaymentSubmissionStatus,
  onRefreshAdminUsers,
  onRefreshAdminMessages,
  onRefreshAdminOrders,
  onRefreshAdminWithdrawals,
  onRefreshReferrals,
  onSendAdminChatReply,
  onMarkAdminChatRead,
  onResetUserPassword,
  onLogoutAccount,
}) => {
  const { lang, t } = useLanguage();
  const [screen, setScreen] = useState<ProfileScreen>('main');

  // Referral Copy Feedback State
  const [refCodeCopied, setRefCodeCopied] = useState(false);
  const [refLinkCopied, setRefLinkCopied] = useState(false);

  // Profile Edit Form State
  const [username, setUsername] = useState(profile.username);
  const [upiId, setUpiId] = useState(profile.upiId);
  const [bankName, setBankName] = useState(profile.bankName);
  const [accountLast4, setAccountLast4] = useState(profile.accountLast4);
  const [savedFeedback, setSavedFeedback] = useState(false);

  // Admin Add Order State
  const [orderAmount, setOrderAmount] = useState('1000');
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminFeedback, setAdminFeedback] = useState<string | null>(null);

  // Admin Users Search & Password Reset State
  const [userSearch, setUserSearch] = useState('');
  const [resetTargetUserId, setResetTargetUserId] = useState<string | null>(null);
  const [resetPasswordInput, setResetPasswordInput] = useState('');
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetFeedback, setResetFeedback] = useState<string | null>(null);

  // WhatsApp-style Admin Messages State
  const [chatSearch, setChatSearch] = useState('');
  const [selectedChatUserId, setSelectedChatUserId] = useState<string | null>(null);
  const [chatReplyInput, setChatReplyInput] = useState('');
  const [pendingChatPhoto, setPendingChatPhoto] = useState<string | null>(null);
  const [chatPhotoError, setChatPhotoError] = useState<string | null>(null);
  const [chatSending, setChatSending] = useState(false);
  const [chatPreviewUrl, setChatPreviewUrl] = useState<string | null>(null);
  const [chatImgRetries, setChatImgRetries] = useState<Record<string, number>>({});
  const [chatImgFailed, setChatImgFailed] = useState<Record<string, boolean>>({});

  // Admin Agent Management State (strictly Admin-only)
  const [agentList, setAgentList] = useState<AgentAccount[]>(() => {
    try {
      const raw = window.localStorage.getItem('aurex_vault_agents_v1');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [agentMobileInput, setAgentMobileInput] = useState('');
  const [agentPasswordInput, setAgentPasswordInput] = useState('');
  const [agentSubmitting, setAgentSubmitting] = useState(false);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [agentSuccess, setAgentSuccess] = useState<string | null>(null);
  const [agentCopiedKey, setAgentCopiedKey] = useState<string | null>(null);

  const agentListRef = useRef(agentList);
  agentListRef.current = agentList;
  const deletedAgentIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    try {
      window.localStorage.setItem('aurex_vault_agents_v1', JSON.stringify(agentList));
    } catch {}
  }, [agentList]);

  const syncAdminAgents = useCallback(async () => {
    const adminMobile = authAccount?.mobileNumber || '';
    if (!isAdmin || !adminMobile) return;
    setAgentsLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8500);
    try {
      const res = await fetch('/api/admin/agents', {
        cache: 'no-store',
        headers: { 'x-admin-mobile': adminMobile },
        signal: controller.signal,
      });
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.toLowerCase().includes('application/json')) {
        const data = (await res.json()) as { agents?: AgentAccount[] };
        let serverAgents = Array.isArray(data.agents) ? data.agents : [];
        const localAgents = agentListRef.current;

        // If server lost ephemeral storage (e.g. after Vercel redeploy), restore Admin's local agents back to server
        const serverMobiles = new Set(
          serverAgents.map((a) => normalizeIndianMobile(a.mobileNumber))
        );
        const missingOnServer = localAgents.filter(
          (a) =>
            !deletedAgentIdsRef.current.has(a.id) &&
            normalizeIndianMobile(a.mobileNumber) &&
            !serverMobiles.has(normalizeIndianMobile(a.mobileNumber))
        );

        if (missingOnServer.length > 0) {
          const syncController = new AbortController();
          const syncTimer = setTimeout(() => syncController.abort(), 8500);
          try {
            const syncRes = await fetch('/api/admin/agents/sync', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-admin-mobile': adminMobile,
              },
              body: JSON.stringify({ agents: missingOnServer }),
              signal: syncController.signal,
            });
            const syncCt = syncRes.headers.get('content-type') || '';
            if (syncRes.ok && syncCt.toLowerCase().includes('application/json')) {
              const syncData = (await syncRes.json()) as { agents?: AgentAccount[] };
              if (Array.isArray(syncData.agents)) {
                serverAgents = syncData.agents;
              }
            }
          } catch {
            // keep local cache if sync fails
          } finally {
            clearTimeout(syncTimer);
          }
        }

        if (serverAgents.length > 0 || localAgents.length === 0) {
          const localByMobile = new Map(
            localAgents.map((a) => [normalizeIndianMobile(a.mobileNumber), a])
          );
          const merged = serverAgents.map((sa) => {
            const prev = localByMobile.get(normalizeIndianMobile(sa.mobileNumber));
            return {
              ...sa,
              password:
                sa.password && !sa.password.includes('•')
                  ? sa.password
                  : prev?.password && !prev.password.includes('•')
                  ? prev.password
                  : sa.password,
            };
          });
          setAgentList(merged);
        }
      }
    } catch {
      // keep local cache on network error
    } finally {
      clearTimeout(timer);
      setAgentsLoading(false);
    }
  }, [isAdmin, authAccount?.mobileNumber]);

  useEffect(() => {
    if (isAdmin) {
      void syncAdminAgents();
    }
  }, [isAdmin, screen, syncAdminAgents]);

  const handleCopyAgentUrl = (key: string, url: string) => {
    void navigator.clipboard.writeText(url);
    setAgentCopiedKey(key);
    setTimeout(() => setAgentCopiedKey((curr) => (curr === key ? null : curr)), 2000);
  };

  const handleCreateAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setAgentError(null);
    setAgentSuccess(null);
    const mobileNumber = normalizeIndianMobile(agentMobileInput);
    const pass = agentPasswordInput.trim();
    if (mobileNumber.length !== 10) {
      setAgentError('Please enter a valid 10-digit agent mobile number');
      return;
    }
    if (pass.length < 6) {
      setAgentError('Password must be at least 6 characters');
      return;
    }
    if (normalizeIndianMobile(authAccount?.mobileNumber) === mobileNumber) {
      setAgentError('Cannot use Admin mobile number for an agent');
      return;
    }

    setAgentSubmitting(true);
    const createController = new AbortController();
    const createTimer = setTimeout(() => createController.abort(), 8500);
    try {
      const res = await fetch('/api/admin/agents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-mobile': authAccount?.mobileNumber || '',
        },
        body: JSON.stringify({
          mobileNumber,
          password: pass,
        }),
        signal: createController.signal,
      });
      const ct = res.headers.get('content-type') || '';
      if (ct.toLowerCase().includes('application/json')) {
        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          agent?: AgentAccount;
        };
        if (!res.ok || !data.ok || !data.agent) {
          if (data.error === 'AGENT_EXISTS') {
            setAgentError('An agent with this mobile number already exists');
          } else if (data.error === 'CANNOT_USE_ADMIN_MOBILE') {
            setAgentError('Cannot use Admin mobile number for an agent');
          } else {
            setAgentError('Could not create agent ID. Please verify inputs.');
          }
          return;
        }
        deletedAgentIdsRef.current.delete(data.agent.id);
        setAgentList((prev) => [
          data.agent!,
          ...prev.filter((a) => a.id !== data.agent!.id && normalizeIndianMobile(a.mobileNumber) !== mobileNumber),
        ]);
        setAgentMobileInput('');
        setAgentPasswordInput('');
        setAgentSuccess(`Agent ${data.agent.id} (+91 ${mobileNumber}) created!`);
        setTimeout(() => setAgentSuccess(null), 3500);
        return;
      }
    } catch {
      // offline fallback below
    } finally {
      clearTimeout(createTimer);
      setAgentSubmitting(false);
    }

    // Offline fallback if API is unreachable
    if (agentList.some((a) => normalizeIndianMobile(a.mobileNumber) === mobileNumber)) {
      setAgentError('An agent with this mobile number already exists');
      return;
    }
    const agentId = `AGT-${Math.floor(1000 + Math.random() * 9000)}`;
    const referralCode = `AGENT-${agentId}`;
    const safeOrigin = /^https?:/i.test(window.location.origin)
      ? window.location.origin
      : 'https://vaultpayv.vercel.app';
    const newAgent: AgentAccount = {
      id: agentId,
      mobileNumber,
      password: pass,
      referralCode,
      shareUrl: `${safeOrigin}/?agent=${encodeURIComponent(referralCode)}`,
      createdAt: formatTimestamp(),
      loginsCount: 0,
      commissionEarned: 0,
    };
    setAgentList((prev) => [newAgent, ...prev]);
    setAgentMobileInput('');
    setAgentPasswordInput('');
    setAgentSuccess(`Agent ${agentId} (+91 ${mobileNumber}) created!`);
    setTimeout(() => setAgentSuccess(null), 3500);
    try {
      await registerFallbackAccount({
        mobileNumber,
        username: `Agent_${agentId}`,
        password: pass,
        confirmPassword: pass,
      });
    } catch {
      // ignore if already registered locally
    }
  };

  const handleDeleteAgent = async (agentId: string) => {
    if (!isAdmin) return;
    deletedAgentIdsRef.current.add(agentId);
    setAgentList((prev) => prev.filter((a) => a.id !== agentId));
    const delController = new AbortController();
    const delTimer = setTimeout(() => delController.abort(), 8500);
    try {
      await fetch(`/api/admin/agents/${encodeURIComponent(agentId)}`, {
        method: 'DELETE',
        headers: { 'x-admin-mobile': authAccount?.mobileNumber || '' },
        signal: delController.signal,
      });
    } catch {
      // ignore network failure
    } finally {
      clearTimeout(delTimer);
    }
  };

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatFileInputRef = useRef<HTMLInputElement>(null);

  const activeChatThread = useMemo(() => {
    if (!selectedChatUserId) return null;
    return adminChatThreads.find((th) => th.userId === selectedChatUserId) || null;
  }, [adminChatThreads, selectedChatUserId]);

  useEffect(() => {
    if (activeChatThread && chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [activeChatThread]);

  const totalUnreadMessages = useMemo(() => {
    return adminChatThreads.reduce((acc, th) => acc + th.unreadCount, 0);
  }, [adminChatThreads]);

  const pendingApprovals = useMemo(() => {
    return adminOrders.filter((o) => o.status === 'pending');
  }, [adminOrders]);

  const pendingWithdrawals = useMemo(() => {
    return withdrawRequests.filter((w) => w.status === 'Pending');
  }, [withdrawRequests]);

  const isAgentWithdrawal = useCallback((w: WithdrawRequest) => {
    return (
      w.requesterRole === 'agent' ||
      Boolean(w.agentId) ||
      /^AGT-/i.test(w.userId) ||
      /^Agent_AGT-/i.test(w.username)
    );
  }, []);

  const agentPendingWithdrawals = useMemo(() => {
    return pendingWithdrawals.filter(isAgentWithdrawal);
  }, [pendingWithdrawals, isAgentWithdrawal]);

  const handleSaveProfileSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveProfile({
      username: username.trim() || 'VaultPay User',
      upiId: upiId.trim(),
      bankName: bankName.trim(),
      accountLast4: accountLast4.trim().slice(-4),
    });
    setSavedFeedback(true);
    setTimeout(() => setSavedFeedback(false), 2000);
  };

  const payoutPreview = useMemo(() => {
    const amt = Number(orderAmount) || 0;
    const principal = Math.round((amt + Number.EPSILON) * 100) / 100;
    const commission = Math.round((principal * COMMISSION_RATE + Number.EPSILON) * 100) / 100;
    const totalReturn = Math.round((principal + commission + Number.EPSILON) * 100) / 100;
    return { principal, commission, totalReturn };
  }, [orderAmount]);

  const validAmount = payoutPreview.principal >= 100;

  const handleSendAdminOrder = (e: React.FormEvent) => {
    e.preventDefault();
    setAdminError(null);
    setAdminFeedback(null);
    if (!validAmount) {
      setAdminError(t.errMinOrder);
      return;
    }

    const res = onAddAdminOrder(payoutPreview.principal, defaultPaymentLink);
    if (!res.ok) {
      setAdminError(res.error || t.unableCreateOrder);
      return;
    }

    setAdminFeedback(t.orderSentToHomeSuffix);
    setTimeout(() => {
      setAdminFeedback(null);
      setScreen('admin_menu');
    }, 1200);
  };

  /* SCREEN 1: MAIN PROFILE VIEW */
  if (screen === 'main' || !isAdmin) {
    return (
      <div className="space-y-4 pb-6">
        {/* User Card */}
        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-[#1E293B] to-[#0F172A] p-4 shadow-xl">
          <div className="flex items-center gap-3">
            <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border text-base font-bold ${getAvatarColor(profile.userId)}`}>
              {getInitials(profile.username)}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-base font-extrabold text-white">{profile.username}</h2>
              <p className="truncate font-mono text-xs text-slate-400">
                {profile.mobileNumber ? `+91 ${profile.mobileNumber} · ` : ''}ID: {profile.userId}
              </p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 border-t border-white/[0.08] pt-3 text-center">
            <div>
              <p className="text-[10px] text-slate-400">{(t as any).walletBalance || 'Wallet Balance'}</p>
              <p className="mt-0.5 font-mono text-xs font-bold text-white">{formatINR(walletBalance)}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-400">{(t as any).totalPaid || 'Total Paid'}</p>
              <p className="mt-0.5 font-mono text-xs font-bold text-emerald-400">{formatINR(totalPaid)}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-400">{(t as any).totalWithdrawal || 'Total Withdrawal'}</p>
              <p className="mt-0.5 font-mono text-xs font-bold text-amber-300">{formatINR(totalWithdrawal)}</p>
            </div>
          </div>
        </div>

        {/* Management Console Button for Admin */}
        {isAdmin && (
          <button
            type="button"
            onClick={() => setScreen('admin_menu')}
            className="flex w-full items-center justify-between gap-3 rounded-2xl border border-amber-400/30 bg-[#0F172A] p-4 text-left transition-colors hover:border-amber-400/60 active:scale-[0.99]"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-400/30 bg-amber-400/15 text-amber-300">
                <Shield className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-bold text-white">{t.adminPanelTitle}</p>
                <p className="text-[11px] text-slate-400">{t.adminPanelDesc}</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {(pendingApprovals.length > 0 || pendingWithdrawals.length > 0) && (
                <span className="rounded-full bg-amber-400 px-2 py-0.5 font-mono text-[10px] font-bold text-[#070B14]">
                  {pendingApprovals.length + pendingWithdrawals.length}
                </span>
              )}
              <ChevronRight className="h-4 w-4 text-slate-400" />
            </div>
          </button>
        )}

        {/* Referral Code & 5-Referral ₹100 Rewards Card */}
        {(() => {
          const inviteCode = authAccount?.referralCode || `AUREX-${profile.userId}`;
          const shareOrigin = /^https?:/i.test(window.location.origin)
            ? window.location.origin
            : 'https://vaultpayv.vercel.app';
          const shareUrl = `${shareOrigin}/?ref=${inviteCode}`;
          const invitedVia = referredBy || authAccount?.referredBy;
          const joinedCount = referrals.length;
          const completedCount = referrals.filter((r) => r.status === 'completed').length;
          const joinedCycle =
            joinedCount === 0 ? 0 : joinedCount % 5 === 0 ? 5 : joinedCount % 5;
          const completedCycle =
            completedCount === 0 ? 0 : completedCount % 5 === 0 ? 5 : completedCount % 5;

          const handleCopyRefCode = async () => {
            try {
              await navigator.clipboard.writeText(inviteCode);
              setRefCodeCopied(true);
              setTimeout(() => setRefCodeCopied(false), 1800);
            } catch {
              // ignore clipboard errors
            }
          };

          const handleCopyRefLink = async () => {
            try {
              await navigator.clipboard.writeText(shareUrl);
              setRefLinkCopied(true);
              setTimeout(() => setRefLinkCopied(false), 1800);
            } catch {
              // ignore clipboard errors
            }
          };

          const handleShareRefLink = async () => {
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
            await handleCopyRefLink();
          };

          return (
            <div className="space-y-3 rounded-2xl border border-amber-400/25 bg-[#0F172A] p-4">
              <div className="flex items-center justify-between gap-2 border-b border-white/[0.08] pb-2.5">
                <div className="flex items-center gap-2">
                  <Gift className="h-4 w-4 text-amber-300" />
                  <h2 className="text-sm font-bold text-white">
                    {t.referralSectionTitle}
                  </h2>
                </div>
                <span className="rounded-lg border border-emerald-400/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                  {t.referralRuleBadge}
                </span>
              </div>

              {/* Invitation Code Row */}
              <div className="rounded-xl border border-white/[0.08] bg-[#080D1A] p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] text-slate-400">{t.yourInviteCodeLabel}</p>
                    <p className="mt-0.5 truncate font-mono text-base font-extrabold tracking-wider text-amber-300">
                      {inviteCode}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyRefCode}
                    className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-amber-400/35 bg-amber-400/15 px-2.5 text-[11px] font-bold text-amber-200 hover:bg-amber-400/25"
                  >
                    {refCodeCopied ? (
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    <span>{refCodeCopied ? t.savedBtn : 'Copy'}</span>
                  </button>
                </div>

                {invitedVia && (
                  <div className="mt-2 flex items-center justify-between border-t border-white/[0.06] pt-2 text-[11px]">
                    <span className="text-slate-400">{t.invitedByBadge}</span>
                    <span className="rounded bg-emerald-500/15 px-2 py-0.5 font-mono font-bold text-emerald-300">
                      {invitedVia}
                    </span>
                  </div>
                )}
              </div>

              {/* Shareable Link & Buttons */}
              <div className="space-y-2 rounded-xl border border-white/[0.08] bg-[#080D1A] p-3">
                <p className="text-[11px] text-slate-400">{t.shareInviteLinkLabel}</p>
                <p className="truncate rounded-lg border border-white/[0.07] bg-[#0F172A] px-2.5 py-1.5 font-mono text-[11px] text-slate-300">
                  {shareUrl}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleCopyRefLink}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-[#0F172A] px-3 text-xs font-bold text-slate-100 hover:border-amber-400/40"
                  >
                    {refLinkCopied ? (
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="h-3.5 w-3.5 text-amber-300" />
                    )}
                    <span>{refLinkCopied ? t.linkCopiedBtn : t.copyLinkBtn}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleShareRefLink}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-amber-400 px-3 text-xs font-bold text-[#070B14] hover:bg-amber-300"
                  >
                    <Share2 className="h-3.5 w-3.5" />
                    <span>{t.shareLinkBtn}</span>
                  </button>
                </div>
                <p className="text-[10px] leading-relaxed text-slate-400">
                  {t.referralRuleDesc}
                </p>
              </div>

              {/* Progress & Total Earned */}
              <div className="rounded-xl border border-white/[0.08] bg-[#080D1A] p-3">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-slate-200">
                    {t.joinedProgressLabel}
                  </span>
                  <span className="shrink-0 font-mono font-bold text-emerald-400 tabular-nums">
                    {joinedCycle} / 5{joinedCount > 5 ? ` (${joinedCount})` : ''}
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
                  <div
                    style={{ width: `${(joinedCycle / 5) * 100}%` }}
                    className="h-full bg-gradient-to-r from-emerald-500 to-amber-300 transition-all duration-300"
                  />
                </div>
                <div className="mt-2.5 flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">
                    {t.orderCompletedLabel}:{' '}
                    <span className="font-mono font-semibold text-slate-200 tabular-nums">
                      {completedCycle} / 5
                    </span>
                  </span>
                  <span className="font-mono font-bold text-amber-300 tabular-nums">
                    {t.referralEarnedLabel}: {formatINR(referralBonusEarned)}
                  </span>
                </div>
              </div>

              {/* Referred Friends List */}
              <div className="rounded-xl border border-white/[0.08] bg-[#080D1A] p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold text-slate-200">
                    {t.referralTrackerTitle} ({referrals.length})
                  </p>
                  {onRefreshReferrals && (
                    <button
                      type="button"
                      onClick={() => onRefreshReferrals()}
                      aria-label="Refresh referrals"
                      className="inline-flex h-6 items-center gap-1 rounded-lg border border-white/10 bg-[#0F172A] px-2 text-[10px] font-semibold text-amber-300 hover:border-amber-400/40"
                    >
                      <RefreshCw className="h-3 w-3" />
                      <span>Refresh</span>
                    </button>
                  )}
                </div>
                {referrals.length === 0 ? (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
                    {t.noReferralsYet}
                  </p>
                ) : (
                  <div className="mt-2 max-h-40 divide-y divide-white/[0.06] overflow-y-auto">
                    {referrals.map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center justify-between gap-2 py-2 text-[11px] first:pt-0 last:pb-0"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-white">
                            {r.inviteeName}
                          </p>
                          <p className="truncate font-mono text-[10px] text-slate-500">
                            ID: {r.inviteeId} · {r.registeredAt}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-bold ${
                            r.status === 'completed'
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : 'bg-amber-400/15 text-amber-300'
                          }`}
                        >
                          {r.status === 'completed'
                            ? t.refStatusCompleted
                            : t.refStatusRegistered}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* Profile & Bank / UPI Settings Form */}
        <form onSubmit={handleSaveProfileSubmit} className="rounded-2xl border border-white/10 bg-[#0F172A] p-4 space-y-3.5">
          <div className="flex items-center justify-between border-b border-white/[0.08] pb-2.5">
            <h2 className="text-sm font-bold text-white">{t.profileSettingsTitle}</h2>
            {savedFeedback && (
              <span className="text-xs font-bold text-emerald-400">{t.savedBtn}</span>
            )}
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-300">{t.usernameLabel}</label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="mt-1 h-9 w-full rounded-xl border border-white/10 bg-[#080D1A] px-3 text-xs text-white focus:border-amber-400 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-300">{t.upiIdLabel}</label>
            <input
              type="text"
              value={upiId}
              onChange={(e) => setUpiId(e.target.value)}
              placeholder="username@okhdfcbank"
              className="mt-1 h-9 w-full rounded-xl border border-white/10 bg-[#080D1A] px-3 text-xs text-white focus:border-amber-400 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-medium text-slate-300">{t.bankNameLabel}</label>
              <input
                type="text"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                placeholder="State Bank of India"
                className="mt-1 h-9 w-full rounded-xl border border-white/10 bg-[#080D1A] px-3 text-xs text-white focus:border-amber-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-300">{t.last4Label}</label>
              <input
                type="text"
                maxLength={4}
                value={accountLast4}
                onChange={(e) => setAccountLast4(e.target.value)}
                placeholder="4321"
                className="mt-1 h-9 w-full rounded-xl border border-white/10 bg-[#080D1A] px-3 font-mono text-xs text-white focus:border-amber-400 focus:outline-none"
              />
            </div>
          </div>

          <button
            type="submit"
            className="inline-flex h-9 w-full items-center justify-center rounded-xl bg-slate-800 text-xs font-bold text-white hover:bg-slate-700"
          >
            {t.saveBtn}
          </button>
        </form>

        {onLogoutAccount && (
          <button
            type="button"
            onClick={onLogoutAccount}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-rose-500/30 bg-rose-500/10 py-3 text-xs font-bold text-rose-300 transition-colors hover:bg-rose-500/20"
          >
            <LogOut className="h-4 w-4" />
            <span>{(t as any).logoutBtn || 'Sign Out'}</span>
          </button>
        )}
      </div>
    );
  }

  /* SCREEN 2: ADMIN MENU */
  if (screen === 'admin_menu') {
    return (
      <div className="space-y-3.5">
        <button
          type="button"
          onClick={() => setScreen('main')}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/10 bg-[#0F172A] px-3 text-xs font-semibold text-slate-200 hover:border-amber-400/35"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>{t.backToProfile}</span>
        </button>

        <div className="rounded-2xl border border-amber-400/25 bg-[#0F172A] p-4 space-y-4">
          <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-amber-300" />
              <h2 className="text-sm font-bold text-white">{t.adminControlsTitle}</h2>
            </div>
            <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-bold text-emerald-300">
              <Lock className="h-3 w-3" />
              {t.fixed11Badge}
            </span>
          </div>

          {/* Create Agent ID Feature for Admin ONLY */}
          <div className="rounded-xl border border-purple-400/30 bg-[#080D1A] p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-purple-300" />
                <h3 className="text-xs font-bold text-white">Create Agent ID & Password</h3>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void syncAdminAgents()}
                  aria-label="Refresh agents"
                  className="flex h-6 w-6 items-center justify-center rounded-lg border border-white/10 bg-[#0F172A] text-purple-300 hover:border-purple-400/40"
                >
                  <RefreshCw className={`h-3 w-3 ${agentsLoading ? 'animate-spin' : ''}`} />
                </button>
                <span className="rounded bg-purple-500/15 px-2 py-0.5 font-mono text-[10px] font-bold text-purple-300">
                  {agentList.length} Agents
                </span>
              </div>
            </div>
            <form onSubmit={handleCreateAgent} className="space-y-2.5">
              <div className="relative">
                <Phone className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  required
                  value={agentMobileInput}
                  onChange={(e) => setAgentMobileInput(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  placeholder="Agent 10-digit Mobile Number"
                  className="h-9 w-full rounded-xl border border-white/10 bg-[#0F172A] pr-3 pl-9 font-mono text-xs text-white placeholder:text-slate-500 focus:border-purple-400 focus:outline-none"
                />
              </div>
              <input
                type="password"
                required
                value={agentPasswordInput}
                onChange={(e) => setAgentPasswordInput(e.target.value)}
                placeholder="Agent Password 🔑 (min 6 chars)"
                className="h-9 w-full rounded-xl border border-white/10 bg-[#0F172A] px-3 text-xs text-white placeholder:text-slate-500 focus:border-purple-400 focus:outline-none"
              />
              {agentError && <p className="text-[10px] font-medium text-rose-400">{agentError}</p>}
              {agentSuccess && <p className="text-[10px] font-medium text-emerald-400">{agentSuccess}</p>}
              <button
                type="submit"
                disabled={agentSubmitting}
                className="inline-flex h-9 w-full items-center justify-center rounded-xl bg-purple-500 text-xs font-bold text-white hover:bg-purple-400 disabled:opacity-50"
              >
                {agentSubmitting ? 'Creating Agent...' : 'Create Agent ID & Password'}
              </button>
            </form>

            {agentList.length > 0 && (
              <div className="divide-y divide-white/[0.06] border-t border-white/[0.08] pt-2">
                {agentList.map((a) => (
                  <div key={a.id} className="space-y-1.5 py-2.5 text-[11px]">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-mono font-bold text-white">
                          +91 {a.mobileNumber || a.email}{' '}
                          <span className="text-purple-300">({a.id})</span>
                        </p>
                        <p className="truncate font-mono text-[10px] text-slate-400">
                          Pass: {a.password}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleCopyAgentUrl(a.id, a.shareUrl)}
                          className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/30 bg-emerald-500/15 px-2 py-1 text-[10px] font-bold text-emerald-300 hover:bg-emerald-500/25"
                        >
                          <Copy className="h-3 w-3" />
                          <span>{agentCopiedKey === a.id ? 'Copied!' : 'Copy URL'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteAgent(a.id)}
                          aria-label={`Remove ${a.id}`}
                          className="rounded-lg border border-rose-400/30 bg-rose-500/10 p-1 text-rose-300 hover:bg-rose-500/20"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
                      <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-sky-300">
                        Joined: {a.loginsCount ?? 0}
                      </span>
                      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-300">
                        Success: {a.approvedCount ?? 0}
                      </span>
                      <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-rose-300">
                        Failed: {a.rejectedCount ?? 0}
                      </span>
                      <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-amber-300">
                        5%: {formatINR(a.commissionEarned ?? 0)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2.5">
            {/* Button 1: Add Order */}
            <button
              type="button"
              onClick={() => setScreen('admin_add_order')}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-[#080D1A] p-3.5 text-left transition-colors hover:border-amber-400/45 active:scale-[0.99]"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-400/30 bg-amber-400/15 text-amber-300">
                  <PlusCircle className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-bold text-white">{t.addOrderTitle}</p>
                  <p className="text-[11px] text-slate-400">{t.addOrderDesc}</p>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-slate-400" />
            </button>

            {/* Button 2: Approve / Reject User Payments */}
            <button
              type="button"
              onClick={() => {
                onRefreshAdminOrders?.();
                setScreen('admin_approvals');
              }}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-[#080D1A] p-3.5 text-left transition-colors hover:border-emerald-400/45 active:scale-[0.99]"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-400/30 bg-emerald-500/15 text-emerald-300">
                  <ClipboardCheck className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-bold text-white">
                    {t.approveRejectTitle}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {t.approveRejectDesc}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {pendingApprovals.length > 0 && (
                  <span className="rounded-md bg-amber-400 px-2 py-0.5 font-mono text-[11px] font-bold text-[#070B14] tabular-nums">
                    {pendingApprovals.length}
                  </span>
                )}
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </div>
            </button>

            {/* Button 3: User Withdrawal Requests */}
            <button
              type="button"
              onClick={() => {
                onRefreshAdminWithdrawals?.();
                setScreen('admin_withdrawals');
              }}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-[#080D1A] p-3.5 text-left transition-colors hover:border-amber-400/45 active:scale-[0.99]"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-400/30 bg-amber-400/15 text-amber-300">
                  <ArrowUpRight className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-bold text-white">
                    {t.adminWithdrawalsTitle}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {t.adminWithdrawalsDesc}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {agentPendingWithdrawals.length > 0 && (
                  <span className="rounded-md border border-purple-400/50 bg-purple-500/25 px-2 py-0.5 font-mono text-[10px] font-bold text-purple-200 tabular-nums">
                    {agentPendingWithdrawals.length} Agent
                  </span>
                )}
                {pendingWithdrawals.length > 0 && (
                  <span className="rounded-md bg-amber-400 px-2 py-0.5 font-mono text-[11px] font-bold text-[#070B14] tabular-nums">
                    {pendingWithdrawals.length}
                  </span>
                )}
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </div>
            </button>

            {/* Button 4: User Profile Details */}
            <button
              type="button"
              onClick={() => {
                onRefreshAdminUsers();
                setScreen('admin_users');
              }}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-[#080D1A] p-3.5 text-left transition-colors hover:border-sky-400/45 active:scale-[0.99]"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-sky-400/30 bg-sky-500/15 text-sky-300">
                  <Users className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-bold text-white">
                    {t.adminUsersTitle}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {t.adminUsersDesc}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {adminUsers.length > 0 && (
                  <span className="rounded-md border border-sky-400/30 bg-sky-500/15 px-2 py-0.5 font-mono text-[11px] font-bold text-sky-300 tabular-nums">
                    {adminUsers.length}
                  </span>
                )}
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </div>
            </button>

            {/* Button 5: User Messages Inbox */}
            <button
              type="button"
              onClick={() => {
                onRefreshAdminMessages();
                setSelectedChatUserId(null);
                setScreen('admin_messages');
              }}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-[#080D1A] p-3.5 text-left transition-colors hover:border-[#25D366]/55 active:scale-[0.99]"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#25D366]/35 bg-[#25D366]/15 text-[#25D366]">
                  <MessageCircle className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-bold text-white">
                    {t.adminMessagesTitle}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {t.adminMessagesDesc}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {totalUnreadMessages > 0 && (
                  <span className="rounded-full bg-[#25D366] px-2 py-0.5 font-mono text-[11px] font-bold text-[#070B14] tabular-nums">
                    {totalUnreadMessages}
                  </span>
                )}
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* SCREEN 3.2: WHATSAPP-STYLE USER MESSAGES INBOX & 1-ON-1 CHAT */
  if (screen === 'admin_messages') {
    if (activeChatThread) {
      const handleChatPhotoPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setChatPhotoError(null);
        try {
          const compressed = await compressImageFileToDataUrl(file);
          setPendingChatPhoto(compressed);
        } catch {
          setChatPhotoError(t.invalidImageError);
        }
      };

      const handleSendReply = async (e: React.FormEvent) => {
        e.preventDefault();
        const clean = chatReplyInput.trim();
        const img = pendingChatPhoto;
        if ((!clean && !img) || chatSending) return;
        setChatSending(true);
        setChatPhotoError(null);
        setChatReplyInput('');
        setPendingChatPhoto(null);
        await onSendAdminChatReply(
          activeChatThread.userId,
          clean,
          img || undefined
        );
        setChatSending(false);
      };

      return (
        <>
          <div className="flex flex-col overflow-hidden rounded-2xl border border-[#25D366]/25 bg-[#0B141A]">
            {/* WhatsApp Chat Header */}
            <div className="flex items-center justify-between gap-2 border-b border-white/[0.08] bg-[#202C33] px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedChatUserId(null);
                    setPendingChatPhoto(null);
                    setChatPhotoError(null);
                  }}
                  aria-label={t.backToAdmin}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-200 hover:bg-white/10"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>

                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${getAvatarColor(
                    activeChatThread.userId
                  )}`}
                >
                  {getInitials(activeChatThread.username)}
                </div>

                <div className="min-w-0">
                  <p className="truncate text-xs font-bold text-white">
                    {activeChatThread.username}
                  </p>
                  <p className="truncate font-mono text-[10px] text-[#25D366]">
                    {activeChatThread.mobileNumber
                      ? `+91 ${activeChatThread.mobileNumber}`
                      : t.chatOnlineLabel}{' '}
                    · ID: {activeChatThread.userId}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onRefreshAdminMessages}
                aria-label="Refresh chat"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-300 hover:bg-white/10"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* WhatsApp Messages Thread */}
            <div
              ref={chatScrollRef}
              className="h-[390px] space-y-2 overflow-y-auto bg-[#0B141A] px-3 py-3"
            >
              {activeChatThread.messages.length === 0 ? (
                <div className="flex h-full items-center justify-center">
                  <p className="rounded-xl border border-white/[0.07] bg-[#182229] px-3.5 py-2 text-center text-[11px] text-slate-400">
                    {t.noMessagesYet}
                  </p>
                </div>
              ) : (
                activeChatThread.messages.map((m) => {
                  const isOutgoing = m.sender === 'agent';
                  return (
                    <div
                      key={m.id}
                      className={`flex ${isOutgoing ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[82%] rounded-2xl px-2.5 py-2 text-xs leading-relaxed shadow-sm ${
                          isOutgoing
                            ? 'rounded-tr-xs bg-[#005c4b] text-white'
                            : 'rounded-tl-xs bg-[#202C33] text-slate-100'
                        }`}
                      >
                        {m.imageUrl && (() => {
                          const imgKey = `${m.id}::${m.imageUrl}`;
                          const retryNum = chatImgRetries[imgKey] || 0;
                          const isBroken = Boolean(chatImgFailed[imgKey]);
                          const resolvedSrc =
                            retryNum > 0 && !m.imageUrl.startsWith('data:')
                              ? `${m.imageUrl}${m.imageUrl.includes('?') ? '&' : '?'}r=${retryNum}`
                              : m.imageUrl;

                          if (isBroken) {
                            return (
                              <button
                                type="button"
                                onClick={() => {
                                  setChatImgFailed((prev) => ({ ...prev, [imgKey]: false }));
                                  setChatImgRetries((prev) => ({
                                    ...prev,
                                    [imgKey]: (prev[imgKey] || 0) + 1,
                                  }));
                                }}
                                className="mb-1.5 flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-black/25 px-3 py-3 text-[11px] font-semibold text-amber-300 hover:bg-black/40"
                              >
                                <RefreshCw className="h-3.5 w-3.5" />
                                <span>Reload Photo</span>
                              </button>
                            );
                          }

                          return (
                            <div
                              onClick={() => setChatPreviewUrl(resolvedSrc)}
                              className="mb-1.5 cursor-pointer overflow-hidden rounded-xl border border-white/10"
                            >
                              <img
                                src={resolvedSrc}
                                alt="Attachment"
                                onError={() =>
                                  setChatImgFailed((prev) => ({ ...prev, [imgKey]: true }))
                                }
                                className="max-h-48 w-full object-cover transition-transform hover:scale-105"
                              />
                            </div>
                          );
                        })()}
                        {m.text && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
                        <div
                          className={`mt-1 flex items-center justify-end gap-1 font-mono text-[9px] ${
                            isOutgoing ? 'text-emerald-200/80' : 'text-slate-400'
                          }`}
                        >
                          <span>{formatChatTime(m.createdAt)}</span>
                          {isOutgoing && <CheckCheck className="h-3 w-3 text-[#53bdeb]" />}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {pendingChatPhoto && (
              <div className="flex items-center justify-between border-t border-white/[0.08] bg-[#202C33] px-3 py-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <img
                    src={pendingChatPhoto}
                    alt="Pending upload"
                    className="h-10 w-10 shrink-0 rounded-lg object-cover border border-white/15"
                  />
                  <span className="truncate text-xs font-medium text-slate-200">
                    Photo attached ready to send
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setPendingChatPhoto(null)}
                  aria-label="Remove photo"
                  className="rounded-full bg-white/10 p-1 text-slate-300 hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* WhatsApp Compose Bar with Photo Upload */}
            <form
              onSubmit={handleSendReply}
              className="flex items-center gap-2 border-t border-white/[0.08] bg-[#202C33] p-2.5"
            >
              <input
                ref={chatFileInputRef}
                type="file"
                accept="image/*"
                onChange={handleChatPhotoPick}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => chatFileInputRef.current?.click()}
                aria-label={t.attachPhotoLabel}
                title={t.attachPhotoLabel}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-[#2A3942] text-[#25D366] transition-colors hover:border-[#25D366]"
              >
                <ImagePlus className="h-4 w-4" />
              </button>
              <input
                type="text"
                value={chatReplyInput}
                onChange={(e) => setChatReplyInput(e.target.value)}
                placeholder={
                  pendingChatPhoto ? t.photoCaptionPlaceholder : t.replyPlaceholder
                }
                className="h-10 min-w-0 flex-1 rounded-full border border-white/10 bg-[#2A3942] px-4 text-xs text-white placeholder:text-slate-400 focus:border-[#25D366] focus:outline-none"
              />
              <button
                type="submit"
                disabled={chatSending || (!chatReplyInput.trim() && !pendingChatPhoto)}
                aria-label="Send reply"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#00A884] text-[#070B14] transition-transform hover:bg-[#25D366] active:scale-95 disabled:opacity-45"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
          </div>

          {chatPreviewUrl && (
            <div
              role="dialog"
              aria-modal="true"
              onClick={() => setChatPreviewUrl(null)}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="relative max-h-[85vh] max-w-[410px]"
              >
                <button
                  type="button"
                  onClick={() => setChatPreviewUrl(null)}
                  aria-label={t.closePreviewLabel}
                  className="absolute -top-3 -right-3 flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-[#0F172A] text-white shadow-lg"
                >
                  <X className="h-4 w-4" />
                </button>
                <img
                  src={chatPreviewUrl}
                  alt="Full view"
                  className="max-h-[82vh] w-auto rounded-2xl border border-white/15 object-contain shadow-2xl"
                />
              </div>
            </div>
          )}
        </>
      );
    }

    const q = chatSearch.trim().toLowerCase();
    const filteredThreads = adminChatThreads.filter((th) => {
      if (!q) return true;
      return (
        th.username.toLowerCase().includes(q) ||
        th.mobileNumber.includes(q) ||
        th.userId.toLowerCase().includes(q) ||
        (th.lastMessage ?? '').toLowerCase().includes(q)
      );
    });

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setScreen('admin_menu')}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/10 bg-[#0F172A] px-3 text-xs font-semibold text-slate-200 hover:border-amber-400/35"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>{t.backToAdmin}</span>
          </button>

          <button
            type="button"
            onClick={onRefreshAdminMessages}
            aria-label="Refresh messages"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/10 bg-[#0F172A] px-3 text-xs font-semibold text-slate-200 hover:border-[#25D366]/45"
          >
            <RefreshCw className="h-3.5 w-3.5 text-[#25D366]" />
            <span className="font-mono text-[11px]">{adminChatThreads.length}</span>
          </button>
        </div>

        <div className="overflow-hidden rounded-2xl border border-[#25D366]/25 bg-[#111B21]">
          <div className="border-b border-white/[0.08] bg-[#202C33] px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-[#25D366]" />
                <h2 className="text-sm font-bold text-white">
                  {t.adminMessagesTitle}
                </h2>
              </div>
              {totalUnreadMessages > 0 && (
                <span className="rounded-full bg-[#25D366] px-2 py-0.5 font-mono text-[10px] font-bold text-[#070B14]">
                  {totalUnreadMessages} {t.newBadge}
                </span>
              )}
            </div>

            <div className="relative mt-2.5">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={chatSearch}
                onChange={(e) => setChatSearch(e.target.value)}
                placeholder={t.messagesSearchPlaceholder}
                className="h-9 w-full rounded-xl border border-white/10 bg-[#111B21] pr-3 pl-9 text-xs text-white placeholder:text-slate-400 focus:border-[#25D366] focus:outline-none"
              />
            </div>
          </div>

          <div className="max-h-[460px] divide-y divide-white/[0.06] overflow-y-auto">
            {filteredThreads.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-400">
                {t.noMessagesYet}
              </p>
            ) : (
              filteredThreads.map((th) => {
                const lastMsg = th.messages[th.messages.length - 1];
                const lastFromAgent = lastMsg?.sender === 'agent';
                return (
                  <button
                    key={th.userId}
                    type="button"
                    onClick={() => {
                      setSelectedChatUserId(th.userId);
                      if (th.unreadCount > 0) {
                        onMarkAdminChatRead(th.userId);
                      }
                    }}
                    className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-[#202C33]/75 active:bg-[#202C33]"
                  >
                    <div
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${getAvatarColor(
                        th.userId
                      )}`}
                    >
                      {getInitials(th.username)}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-xs font-bold text-white">
                          {th.username}
                        </p>
                        <span
                          className={`shrink-0 font-mono text-[10px] ${
                            th.unreadCount > 0 ? 'font-bold text-[#25D366]' : 'text-slate-400'
                          }`}
                        >
                          {formatChatTime(th.lastTime)}
                        </span>
                      </div>

                      <div className="mt-0.5 flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-1 text-[11px] text-slate-400">
                          {lastMsg ? (
                            <>
                              {lastFromAgent && (
                                <CheckCheck className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                              )}
                              <span
                                className={`truncate ${
                                  th.unreadCount > 0 ? 'font-semibold text-slate-200' : ''
                                }`}
                              >
                                {th.lastMessage}
                              </span>
                            </>
                          ) : (
                            <span className="truncate text-slate-500">
                              {th.mobileNumber ? `+91 ${th.mobileNumber} · ` : ''}
                              {t.tapToStartChat}
                            </span>
                          )}
                        </div>

                        {th.unreadCount > 0 && (
                          <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[#25D366] px-1.5 font-mono text-[10px] font-bold text-[#070B14] tabular-nums">
                            {th.unreadCount}
                          </span>
                        )}
                      </div>

                      <p className="mt-0.5 truncate font-mono text-[10px] text-slate-500">
                        {th.mobileNumber ? `+91 ${th.mobileNumber} · ` : ''}ID: {th.userId}
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>
    );
  }

  /* SCREEN 3.5: ADMIN USERS PROFILE DIRECTORY */
  if (screen === 'admin_users') {
    const cleanAdminUsers = adminUsers.filter((u) => u.userId !== '415061');
    const seenMobs = new Set(
      cleanAdminUsers
        .map((u) => normalizeIndianMobile(u.mobileNumber))
        .filter((m) => m.length === 10)
    );
    const mergedUsers: AdminUserRecord[] = [...cleanAdminUsers];
    if (
      authAccount &&
      authAccount.userId !== '415061' &&
      !mergedUsers.some((u) => u.userId === authAccount.userId) &&
      !seenMobs.has(normalizeIndianMobile(authAccount.mobileNumber))
    ) {
      mergedUsers.unshift({
        userId: authAccount.userId,
        mobileNumber: authAccount.mobileNumber,
        username: authAccount.username,
        hasPassword: true,
        referralCode: authAccount.referralCode,
        referredBy: authAccount.referredBy,
        createdAt: authAccount.createdAt,
        walletBalance: 0,
        totalPaid: 0,
        totalWithdrawal: 0,
        upiId: profile.upiId,
      });
    }

    const q = userSearch.trim().toLowerCase();
    const filteredUsers = mergedUsers.filter((u) => {
      if (!q) return true;
      return (
        u.username.toLowerCase().includes(q) ||
        u.mobileNumber.includes(q) ||
        u.userId.toLowerCase().includes(q) ||
        u.referralCode.toLowerCase().includes(q) ||
        (u.referredBy ?? '').toLowerCase().includes(q)
      );
    });

    const handleResetPasswordSubmit = async (e: React.FormEvent, targetId: string) => {
      e.preventDefault();
      setResetError(null);
      setResetFeedback(null);
      setResetSubmitting(true);
      const res = await onResetUserPassword(targetId, resetPasswordInput);
      setResetSubmitting(false);
      if (!res.ok) {
        setResetError(res.error ?? t.errAuthGeneric);
        return;
      }
      setResetFeedback(t.passwordUpdatedMsg);
      setResetPasswordInput('');
      setTimeout(() => {
        setResetTargetUserId(null);
        setResetFeedback(null);
      }, 1100);
    };

    return (
      <div className="space-y-3.5">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setScreen('admin_menu')}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/10 bg-[#0F172A] px-3 text-xs font-semibold text-slate-200 hover:border-amber-400/35"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>{t.backToAdmin}</span>
          </button>

          <button
            type="button"
            onClick={onRefreshAdminUsers}
            aria-label="Refresh users"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/10 bg-[#0F172A] px-3 text-xs font-semibold text-slate-200 hover:border-sky-400/40"
          >
            <RefreshCw className="h-3.5 w-3.5 text-sky-300" />
            <span className="font-mono text-[11px]">{mergedUsers.length}</span>
          </button>
        </div>

        <div className="rounded-2xl border border-sky-400/25 bg-[#0F172A] p-4">
          <div className="flex items-center justify-between border-b border-white/[0.08] pb-2.5">
            <div className="flex items-center gap-1.5">
              <Users className="h-4 w-4 text-sky-300" />
              <h2 className="text-sm font-bold text-white">
                {t.adminUsersTitle} ({filteredUsers.length})
              </h2>
            </div>
          </div>

          <div className="relative mt-3">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder={t.adminUsersSearchPlaceholder}
              className="h-9 w-full rounded-xl border border-white/10 bg-[#080D1A] pr-3 pl-9 text-xs text-white placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
            />
          </div>

          {filteredUsers.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-500">
              {(t as any).noUsersRegisteredYet || 'No users registered yet.'}
            </p>
          ) : (
            <div className="mt-3 divide-y divide-white/[0.06]">
              {filteredUsers.map((u) => {
                const isResetting = resetTargetUserId === u.userId;
                return (
                  <div key={u.userId} className="space-y-2 py-3 first:pt-1 last:pb-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 space-y-0.5">
                        <p className="truncate text-xs font-bold text-white">
                          {u.username}
                        </p>
                        <p className="font-mono text-[11px] text-sky-300">
                          +91 {u.mobileNumber} · ID: {u.userId}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="rounded bg-sky-500/15 px-2 py-0.5 font-mono text-[10px] font-bold text-sky-300">
                          {formatINR(u.walletBalance)}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setResetTargetUserId(isResetting ? null : u.userId);
                            setResetPasswordInput('');
                            setResetError(null);
                            setResetFeedback(null);
                          }}
                          className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-[10px] font-bold text-amber-300 hover:bg-amber-400/20"
                        >
                          {isResetting ? t.cancelBtn : t.resetPasswordBtn}
                        </button>
                      </div>
                    </div>

                    {/* Verified Login & Referral Credentials Box */}
                    <div className="grid grid-cols-1 gap-1.5 rounded-xl border border-white/[0.07] bg-[#080D1A] px-2.5 py-2 text-[11px]">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-slate-400">
                          {t.userPasswordLabel}{' '}
                          <span className="font-mono font-bold text-amber-300">
                            {u.password ? u.password : t.passwordEncryptedLabel}
                          </span>
                        </span>
                        <span className="font-mono text-[10px] text-slate-300">
                          {t.userOwnRefCodeLabel}{' '}
                          <span className="font-bold text-sky-300">
                            {u.referralCode}
                          </span>
                        </span>
                      </div>

                      {u.referredBy ? (
                        <div className="flex items-center justify-between gap-2 border-t border-white/[0.05] pt-1">
                          <span className="text-[10px] text-emerald-300/90">
                            {t.invitedByBadge}
                          </span>
                          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-300">
                            {u.referredBy}
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2 border-t border-white/[0.05] pt-1 text-[10px] text-slate-500">
                          <span>{t.userDirectJoinLabel}</span>
                          <span>—</span>
                        </div>
                      )}
                    </div>

                    {isResetting && (
                      <form
                        onSubmit={(e) => handleResetPasswordSubmit(e, u.userId)}
                        className="rounded-xl border border-amber-400/30 bg-[#080D1A] p-2.5 space-y-2"
                      >
                        <p className="text-[11px] font-semibold text-amber-300">
                          Reset Password for {u.username}
                        </p>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={resetPasswordInput}
                            onChange={(e) => {
                              setResetPasswordInput(e.target.value);
                              if (resetError) setResetError(null);
                            }}
                            placeholder={t.newPasswordPlaceholder}
                            className="h-8 flex-1 rounded-lg border border-white/15 bg-[#080D1A] px-2.5 text-xs text-white placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
                          />
                          <button
                            type="submit"
                            disabled={resetSubmitting}
                            className="h-8 shrink-0 rounded-lg bg-amber-400 px-3 text-[11px] font-bold text-[#070B14] hover:bg-amber-300 disabled:opacity-50"
                          >
                            {t.savePasswordBtn}
                          </button>
                        </div>
                        {resetError && (
                          <p className="text-[10px] font-medium text-rose-400">
                            {resetError}
                          </p>
                        )}
                        {resetFeedback && (
                          <p className="text-[10px] font-medium text-emerald-400">
                            {resetFeedback}
                          </p>
                        )}
                      </form>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400">
                      <span>
                        {t.paidLabel}: {formatINR(u.totalPaid, false)} · {t.withdrawLabel}:{' '}
                        {formatINR(u.totalWithdrawal, false)}
                      </span>
                      {u.linkedAppName && (
                        <span className="text-emerald-400">
                          {t.linkedAppLabel} {u.linkedAppName}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500">
                      <span>
                        {t.joinedAtLabel} {u.createdAt}
                      </span>
                      {u.upiId && (
                        <span className="font-mono text-slate-400">
                          {u.upiId}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  /* SCREEN 3: ADD ORDER SCREEN */
  if (screen === 'admin_add_order') {
    return (
      <div className="space-y-3.5">
        <button
          type="button"
          onClick={() => setScreen('admin_menu')}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/10 bg-[#0F172A] px-3 text-xs font-semibold text-slate-200 hover:border-amber-400/35"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>{t.backToAdmin}</span>
        </button>

        <form
          onSubmit={handleSendAdminOrder}
          className="space-y-3.5 rounded-2xl border border-amber-400/25 bg-[#0F172A] p-4"
        >
          <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
            <div>
              <h2 className="text-sm font-bold text-white">{t.addNewOrderTitle}</h2>
              <p className="text-[11px] text-slate-400">{t.fixedCommissionHint}</p>
            </div>
            <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-bold text-emerald-300">
              <Lock className="h-3 w-3" />
              {t.fixed11Badge}
            </span>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-300">
              {t.orderAmountInrLabel}
            </label>
            <div className="relative mt-1">
              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-sm font-bold text-slate-400">
                ₹
              </span>
              <input
                type="number"
                min="100"
                step="any"
                value={orderAmount}
                onChange={(e) => setOrderAmount(e.target.value)}
                placeholder="1000"
                className="h-10 w-full rounded-xl border border-white/10 bg-[#080D1A] pr-3 pl-7 font-mono text-sm font-bold text-white focus:border-amber-400 focus:outline-none tabular-nums"
              />
            </div>
            <div className="mt-2 grid grid-cols-4 gap-1.5">
              {[500, 1000, 3000, 5000].map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setOrderAmount(String(amt))}
                  className={`h-8 rounded-lg border font-mono text-[11px] font-semibold tabular-nums ${
                    Number(orderAmount) === amt
                      ? 'border-amber-400/60 bg-amber-400/20 text-amber-300'
                      : 'border-white/10 bg-[#080D1A] text-slate-300'
                  }`}
                >
                  ₹{amt}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-emerald-400/20 bg-[#080D1A] p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-300">
              <ShieldCheck className="h-4 w-4 shrink-0" />
              <span>{t.paymentLinkUrlLabel}</span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
              {t.autoGatewayOrderNote}
            </p>
            <p className="mt-2 border-t border-white/[0.06] pt-2 text-[11px] text-slate-300">
              {t.walletReceivesHint}{' '}
              <strong className="font-mono text-emerald-400">
                {formatINR(payoutPreview.totalReturn, false)}
              </strong>{' '}
              ({formatINR(payoutPreview.principal, false)} + 11%)
            </p>
          </div>

          {adminError && <p className="text-[11px] font-medium text-rose-400">{adminError}</p>}
          {adminFeedback && (
            <div className="flex items-center gap-1.5 rounded-lg bg-emerald-500/15 px-3 py-2 text-[11px] font-medium text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              <span>{adminFeedback}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={!validAmount}
            className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-400 to-amber-300 px-4 text-xs font-bold text-[#070B14] transition-transform active:scale-[0.98] disabled:opacity-40"
          >
            <Send className="h-3.5 w-3.5" />
            <span>
              {lang === 'zh'
                ? `${t.sendOrderBtn} (${formatINR(payoutPreview.principal, false)})`
                : `Send ${formatINR(payoutPreview.principal, false)} Order`}
            </span>
          </button>
        </form>
      </div>
    );
  }

  /* SCREEN 4: USER WITHDRAWAL REQUESTS SCREEN */
  if (screen === 'admin_withdrawals') {
    const getMethodLabel = (method: WithdrawRequest['method']) => {
      if (method === 'bank') return t.withdrawMethodBank;
      if (method === 'mobile') return t.withdrawMethodMobile;
      return t.withdrawMethodUpi;
    };

    return (
      <div className="space-y-3.5">
        <button
          type="button"
          onClick={() => setScreen('admin_menu')}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/10 bg-[#0F172A] px-3 text-xs font-semibold text-slate-200 hover:border-amber-400/35"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>{t.backToAdmin}</span>
        </button>

        {/* Pending Withdrawals Card */}
        <div className="rounded-2xl border border-amber-400/25 bg-[#0F172A] p-4">
          <div className="flex items-center justify-between gap-2 border-b border-white/[0.08] pb-2.5">
            <div className="flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-amber-300" />
              <h2 className="text-sm font-bold text-amber-300">
                {t.pendingWithdrawalsTitle} ({pendingWithdrawals.length})
              </h2>
            </div>
            <div className="flex items-center gap-1.5">
              {agentPendingWithdrawals.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-lg border border-purple-400/50 bg-purple-500/25 px-2 py-0.5 text-[10px] font-extrabold text-purple-200">
                  <ShieldCheck className="h-3 w-3 text-purple-300" />
                  <span>{agentPendingWithdrawals.length} Agent</span>
                </span>
              )}
              {onRefreshAdminWithdrawals && (
                <button
                  type="button"
                  onClick={() => onRefreshAdminWithdrawals()}
                  aria-label="Refresh withdrawals"
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-[#080D1A] text-amber-300 hover:border-amber-400/40"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {pendingWithdrawals.length === 0 ? (
            <p className="py-5 text-center text-xs text-slate-500">
              {t.noPendingWithdrawals}
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {pendingWithdrawals.map((w) => {
                const isAgentReq = isAgentWithdrawal(w);
                return (
                  <div
                    key={w.id}
                    className={`space-y-2.5 rounded-2xl p-3.5 ${
                      isAgentReq
                        ? 'border-2 border-purple-400/65 bg-gradient-to-br from-purple-500/20 via-[#191233] to-[#0B0D1D] shadow-lg shadow-purple-950/35'
                        : 'border border-white/[0.08] bg-[#0B1120]'
                    }`}
                  >
                    {isAgentReq && (
                      <div className="flex items-center justify-between gap-2 border-b border-purple-400/25 pb-2">
                        <span className="inline-flex items-center gap-1 rounded-md bg-purple-500 px-2 py-0.5 text-[10px] font-extrabold tracking-wide text-white">
                          <ShieldCheck className="h-3 w-3" />
                          <span>AGENT WITHDRAWAL</span>
                        </span>
                        <span className="rounded border border-purple-400/40 bg-purple-500/20 px-2 py-0.5 font-mono text-[10px] font-bold text-purple-200">
                          Agent ID: {w.agentId || w.userId}
                        </span>
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <span
                          className={`font-mono text-lg font-bold tabular-nums ${
                            isAgentReq ? 'text-purple-100' : 'text-white'
                          }`}
                        >
                          {formatINR(w.amount)}
                        </span>
                        <span
                          className={`ml-2 rounded border px-1.5 py-0.5 text-[10px] font-bold ${
                            isAgentReq
                              ? 'border-purple-400/45 bg-purple-500/20 text-purple-200'
                              : 'border-amber-400/30 bg-amber-400/10 text-amber-300'
                          }`}
                        >
                          {getMethodLabel(w.method)}
                        </span>
                      </div>
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                          isAgentReq
                            ? 'bg-fuchsia-500/25 text-fuchsia-200'
                            : 'bg-amber-400/15 text-amber-300'
                        }`}
                      >
                        {t.statusPending}
                      </span>
                    </div>

                    <div
                      className={`space-y-1.5 rounded-xl border p-3 text-[11px] ${
                        isAgentReq
                          ? 'border-purple-400/35 bg-[#120D24]/90'
                          : 'border-white/[0.08] bg-[#080D1A]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-slate-300">
                        <span className="font-semibold text-white">
                          {w.username} (ID: {w.userId})
                        </span>
                        {w.userMobile && (
                          <span className="font-mono text-sky-400">
                            +91 {w.userMobile}
                          </span>
                        )}
                      </div>
                      <div
                        className={`font-mono font-bold ${
                          isAgentReq ? 'text-purple-200' : 'text-emerald-300'
                        }`}
                      >
                        {w.accountDetailSummary}
                      </div>
                      <p className="text-[10px] text-slate-400">
                        Requested: {w.createdAt}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 pt-0.5">
                      <button
                        type="button"
                        onClick={() => onUpdateWithdrawStatus(w.id, 'Success')}
                        className="inline-flex h-9 flex-1 items-center justify-center gap-1 rounded-xl bg-emerald-500 px-3 text-xs font-bold text-[#070B14] hover:bg-emerald-400"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        <span>{(t as any).approveBtn || 'Approve'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onUpdateWithdrawStatus(w.id, 'Rejected')}
                        className="inline-flex h-9 flex-1 items-center justify-center gap-1 rounded-xl bg-rose-500/20 border border-rose-400/30 px-3 text-xs font-bold text-rose-300 hover:bg-rose-500/30"
                      >
                        <XCircle className="h-4 w-4" />
                        <span>{t.rejectBtn}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* All Withdrawals History */}
        <div className="rounded-2xl border border-white/10 bg-[#0F172A] p-4">
          <p className="text-xs font-bold text-slate-200">
            {t.allWithdrawalsTitle} ({withdrawRequests.length})
          </p>
          <div className="mt-2.5 space-y-2">
            {withdrawRequests.length === 0 ? (
              <p className="py-4 text-center text-xs text-slate-500">
                {t.noWithdrawalsYet}
              </p>
            ) : (
              withdrawRequests.map((w) => {
                const isAgentReq = isAgentWithdrawal(w);
                return (
                  <div
                    key={w.id}
                    className={`flex items-start justify-between gap-2 rounded-xl px-3 py-2.5 ${
                      isAgentReq
                        ? 'border border-purple-400/50 bg-purple-500/12'
                        : 'border border-white/[0.06] bg-[#080D1A]/60'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {isAgentReq && (
                          <span className="rounded bg-purple-500 px-1.5 py-0.5 text-[9px] font-extrabold text-white">
                            AGENT
                          </span>
                        )}
                        <span className="font-mono text-xs font-bold text-white tabular-nums">
                          {formatINR(w.amount)}
                        </span>
                        <span
                          className={`text-[10px] font-semibold ${
                            isAgentReq ? 'text-purple-200' : 'text-amber-300'
                          }`}
                        >
                          {getMethodLabel(w.method)}
                        </span>
                      </div>
                      <p
                        className={`mt-0.5 truncate font-mono text-[11px] font-semibold ${
                          isAgentReq ? 'text-purple-200' : 'text-emerald-300'
                        }`}
                      >
                        {w.accountDetailSummary}
                      </p>
                      <p className="mt-0.5 text-[10px] text-slate-400">
                        {w.username} · ID {w.agentId || w.userId} · {w.createdAt}
                      </p>
                    </div>

                    <span
                      className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-bold ${
                        w.status === 'Success'
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : w.status === 'Rejected'
                          ? 'bg-rose-500/15 text-rose-300'
                          : isAgentReq
                          ? 'bg-purple-500/25 text-purple-200'
                          : 'bg-amber-400/15 text-amber-300'
                      }`}
                    >
                      {w.status === 'Success' && t.statusSuccess}
                      {w.status === 'Rejected' && t.statusRejected}
                      {w.status === 'Pending' && t.statusPending}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    );
  }

  /* SCREEN 5: APPROVE / REJECT USER PAYMENTS SCREEN */
  return (
    <div className="space-y-3.5">
      <button
        type="button"
        onClick={() => setScreen('admin_menu')}
        className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/10 bg-[#0F172A] px-3 text-xs font-semibold text-slate-200 hover:border-amber-400/35"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        <span>{t.backToAdmin}</span>
      </button>

      {/* Pending Approvals Card */}
      <div className="rounded-2xl border border-amber-400/25 bg-[#0F172A] p-4">
        <div className="flex items-center justify-between gap-2 border-b border-white/[0.08] pb-2.5">
          <div className="flex items-center gap-1.5">
            <Clock className="h-4 w-4 text-amber-300" />
            <h2 className="text-sm font-bold text-amber-300">
              {t.pendingApprovalsTitle} ({pendingApprovals.length})
            </h2>
          </div>
          {onRefreshAdminOrders && (
            <button
              type="button"
              onClick={() => onRefreshAdminOrders()}
              aria-label="Refresh order approvals"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-[#080D1A] text-amber-300 hover:border-amber-400/40"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {pendingApprovals.length === 0 ? (
          <p className="py-5 text-center text-xs text-slate-500">
            {t.noPaidOrdersWaiting}
          </p>
        ) : (
          <div className="mt-2 divide-y divide-white/[0.07]">
            {pendingApprovals.map((order) => (
              <div
                key={order.id}
                className="space-y-2 py-3 first:pt-2 last:pb-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <span className="font-mono text-base font-bold text-white tabular-nums">
                      {formatINR(order.amount)}
                    </span>
                    <span className="ml-2 font-mono text-xs text-amber-400">
                      {order.orderCode}
                    </span>
                  </div>
                  <span className="rounded bg-amber-400/15 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                    {t.statusPending}
                  </span>
                </div>

                <div className="space-y-1 rounded-xl border border-white/[0.08] bg-[#080D1A] p-2.5 text-[11px]">
                  <p className="font-semibold text-slate-200">
                    User: {order.userName || 'User'} (ID: {order.userUid || '—'})
                    {order.userMobile ? ` · +91 ${order.userMobile}` : ''}
                  </p>
                  {order.referredBy && (
                    <p className="font-mono text-[10px] font-bold text-purple-300">
                      Agent / Ref: {order.referredBy}
                    </p>
                  )}
                  <p className="font-mono text-emerald-400">
                    Order / UTR Ref: {order.utrRef || '—'}
                  </p>
                  <p className="text-[10px] text-slate-500">Submitted: {order.createdAt}</p>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      const targetId = order.submissionId || order.id;
                      if (targetId) {
                        onUpdatePaymentSubmissionStatus(targetId, 'success');
                      }
                    }}
                    className="inline-flex h-9 flex-1 items-center justify-center gap-1 rounded-xl bg-emerald-500 px-3 text-xs font-bold text-[#070B14] hover:bg-emerald-400"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    <span>{(t as any).approveBtn || 'Approve'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const targetId = order.submissionId || order.id;
                      if (targetId) {
                        onUpdatePaymentSubmissionStatus(targetId, 'rejected');
                      }
                    }}
                    className="inline-flex h-9 flex-1 items-center justify-center gap-1 rounded-xl bg-rose-500/20 border border-rose-400/30 px-3 text-xs font-bold text-rose-300 hover:bg-rose-500/30"
                  >
                    <XCircle className="h-4 w-4" />
                    <span>{t.rejectBtn}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
