import { useCallback, useEffect, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  AdminChatThread,
  AdminOrder,
  AdminUserRecord,
  AppNotification,
  AuthAccount,
  ChatMessage,
  LinkedPaymentApp,
  ReferralRecord,
  Transaction,
  UserProfile,
  WalletState,
  WithdrawMethod,
  WithdrawRequest,
} from '../types/wallet';
import {
  calculateCommission,
  COMMISSION_RATE,
  formatINR,
  formatTimestamp,
  generateRefId,
  isAdminMobile,
  MIN_WITHDRAW_AMOUNT,
  normalizeIndianMobile,
  roundCurrency,
} from '../utils/formatters';
import { Language, translations } from '../i18n/translations';
import {
  completeFallbackReferral,
  getFallbackAccountPassword,
  getFallbackAdminThreads,
  getFallbackAdminUsers,
  getFallbackOrderSubmissions,
  getFallbackReferrals,
  getFallbackUserMessages,
  getFallbackWallet,
  getFallbackWithdrawals,
  loginFallbackAccount,
  markFallbackAdminChatRead,
  mirrorVerifiedAccountToFallback,
  normalizeReferralCode,
  registerFallbackAccount,
  registerFallbackReferral,
  resetFallbackUserPassword,
  saveFallbackOrderSubmission,
  saveFallbackWallet,
  saveFallbackWithdrawal,
  sendFallbackAdminReply,
  sendFallbackUserMessage,
  updateFallbackOrderSubmissionStatus,
  updateFallbackWithdrawalStatus,
} from '../utils/clientFallbackStore';

type SafeJsonResult<T> =
  | { available: true; ok: boolean; status: number; data: T }
  | { available: false; status: number };

async function safeFetchJson<T>(
  url: string,
  init?: RequestInit
): Promise<SafeJsonResult<T>> {
  const timeoutMs = String(init?.body || '').includes('data:image/') ? 20000 : 8500;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      ...init,
      signal: init?.signal ?? controller.signal,
    });
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('application/json')) {
      return { available: false, status: res.status };
    }
    const data = (await res.json()) as T;
    return { available: true, ok: res.ok, status: res.status, data };
  } catch {
    return { available: false, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

const STORAGE_KEY = 'aurex_vault_wallet_v5';
const PENDING_REF_KEY = 'aurex_vault_pending_ref_v1';
const OUTBOX_STORAGE_KEY = 'aurex_vault_sync_outbox_v1';
const REMOVED_ORDERS_KEY = 'aurex_vault_removed_orders_v1';

interface OutboxOrderSubmission {
  id: string;
  orderId: string;
  orderCode: string;
  userUid: string;
  userName: string;
  userMobile?: string;
  amount: number;
  paymentLink: string;
  utrRef: string;
  referredBy: string | null;
  paidAt: string;
  createdAt: string;
}

interface OutboxUserMessage {
  id: string;
  userId: string;
  username: string;
  mobileNumber: string;
  text: string;
  imageData?: string;
  createdAt: string;
}

interface OutboxAdminReply {
  id: string;
  targetUserId: string;
  text: string;
  imageData?: string;
  createdAt: string;
}

interface OutboxDecision {
  id: string;
  status: 'Success' | 'Rejected' | 'success' | 'rejected';
}

interface OutboxReferralCompletion {
  inviteeId: string;
  referrerCode: string;
}

interface OutboxAccountRestore {
  userId: string;
  mobileNumber: string;
  username: string;
  password?: string;
  referralCode: string;
  referredBy: string | null;
  createdAt: string;
  wallet?: Partial<WalletState>;
}

interface SyncOutbox {
  withdrawals: WithdrawRequest[];
  orderSubmissions: OutboxOrderSubmission[];
  userMessages: OutboxUserMessage[];
  adminReplies: OutboxAdminReply[];
  withdrawalDecisions: OutboxDecision[];
  orderDecisions: OutboxDecision[];
  adminOrders: AdminOrder[];
  removedOrderIds: string[];
  referralCompletions: OutboxReferralCompletion[];
  accountRestores: OutboxAccountRestore[];
}

const EMPTY_OUTBOX: SyncOutbox = {
  withdrawals: [],
  orderSubmissions: [],
  userMessages: [],
  adminReplies: [],
  withdrawalDecisions: [],
  orderDecisions: [],
  adminOrders: [],
  removedOrderIds: [],
  referralCompletions: [],
  accountRestores: [],
};

let memoryOutboxCache: SyncOutbox | null = null;

function readSyncOutbox(): SyncOutbox {
  if (memoryOutboxCache) return memoryOutboxCache;
  try {
    const raw = window.localStorage.getItem(OUTBOX_STORAGE_KEY);
    if (!raw) {
      memoryOutboxCache = { ...EMPTY_OUTBOX };
      return memoryOutboxCache;
    }
    const parsed = JSON.parse(raw) as Partial<SyncOutbox>;
    memoryOutboxCache = {
      withdrawals: Array.isArray(parsed.withdrawals) ? parsed.withdrawals : [],
      orderSubmissions: Array.isArray(parsed.orderSubmissions) ? parsed.orderSubmissions : [],
      userMessages: Array.isArray(parsed.userMessages) ? parsed.userMessages : [],
      adminReplies: Array.isArray(parsed.adminReplies) ? parsed.adminReplies : [],
      withdrawalDecisions: Array.isArray(parsed.withdrawalDecisions) ? parsed.withdrawalDecisions : [],
      orderDecisions: Array.isArray(parsed.orderDecisions) ? parsed.orderDecisions : [],
      adminOrders: Array.isArray(parsed.adminOrders) ? parsed.adminOrders : [],
      removedOrderIds: Array.isArray(parsed.removedOrderIds) ? parsed.removedOrderIds : [],
      referralCompletions: Array.isArray(parsed.referralCompletions) ? parsed.referralCompletions : [],
      accountRestores: Array.isArray(parsed.accountRestores) ? parsed.accountRestores : [],
    };
    return memoryOutboxCache;
  } catch {
    memoryOutboxCache = { ...EMPTY_OUTBOX };
    return memoryOutboxCache;
  }
}

function writeSyncOutbox(next: SyncOutbox): void {
  memoryOutboxCache = next;
  try {
    window.localStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota overflow; memoryOutboxCache still preserves items in current session
  }
}

function updateSyncOutbox(updater: (prev: SyncOutbox) => SyncOutbox): SyncOutbox {
  const prev = readSyncOutbox();
  const next = updater({
    withdrawals: [...prev.withdrawals],
    orderSubmissions: [...prev.orderSubmissions],
    userMessages: [...prev.userMessages],
    adminReplies: [...prev.adminReplies],
    withdrawalDecisions: [...prev.withdrawalDecisions],
    orderDecisions: [...prev.orderDecisions],
    adminOrders: [...prev.adminOrders],
    removedOrderIds: [...prev.removedOrderIds],
    referralCompletions: [...prev.referralCompletions],
    accountRestores: [...prev.accountRestores],
  });
  writeSyncOutbox(next);
  return next;
}

const DEFAULT_PROFILE: UserProfile = {
  username: 'User_73',
  userId: '415061',
  upiId: 'user73@okaxis',
  bankName: 'HDFC Priority Bank',
  accountLast4: '8842',
};

const DEFAULT_PAY_LINK = 'sunpay://auto';

const INITIAL_ADMIN_ORDERS: AdminOrder[] = [
  {
    id: 'adm-ord-1000',
    orderCode: 'ORD-1001',
    amount: 1000,
    paymentLink: DEFAULT_PAY_LINK,
    commissionRate: COMMISSION_RATE,
    createdAt: '2026-11-16 15:57:56',
    status: 'active',
  },
];

const INITIAL_STATE: WalletState = {
  walletBalance: 0,
  totalPaid: 0,
  totalWithdrawal: 0,
  totalCashbackEarned: 0,
  completedOrdersCount: 0,
  dailyCheckInDate: null,
  streakDays: 0,
  defaultPaymentLink: DEFAULT_PAY_LINK,
  linkedPaymentApp: null,
  adminOrders: INITIAL_ADMIN_ORDERS,
  withdrawRequests: [],
  referredBy: null,
  referrals: [],
  referralBonusEarned: 0,
  referralMilestonesPaid: 0,
  profile: DEFAULT_PROFILE,
  transactions: [
    {
      id: 'tx-seed-1',
      type: 'order_payout',
      title: 'Order Payment Link',
      titleZh: '订单支付链接',
      subtitle: 'Link Session Expired',
      subtitleZh: '链接会话已过期',
      amount: 1000,
      status: 'Closed',
      timestamp: '2026-11-16 15:57:56',
      referenceId: 'PAY-330914',
    },
  ],
  notifications: [
    {
      id: 'notif-welcome',
      title: 'Link Your Payment App',
      titleZh: '绑定您的支付应用',
      message:
        'Verify PhonePe, Paytm, or Google Pay in the Payment tab to start receiving orders.',
      messageZh:
        '请在“支付”页面验证 PhonePe、Paytm 或 Google Pay 后即可开始接收订单。',
      timestamp: '2026-11-16 16:00:00',
      read: false,
      kind: 'system',
    },
  ],
};

function readPendingRef(): string | null {
  try {
    return normalizeReferralCode(window.localStorage.getItem(PENDING_REF_KEY));
  } catch {
    return null;
  }
}

function savePendingRef(ref: string | null): void {
  try {
    const normalized = normalizeReferralCode(ref);
    if (normalized) {
      window.localStorage.setItem(PENDING_REF_KEY, normalized);
    } else {
      window.localStorage.removeItem(PENDING_REF_KEY);
    }
  } catch {
    // ignore
  }
}

function readRefFromUrl(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const hashQueryIdx = window.location.hash.indexOf('?');
    const hashParams =
      hashQueryIdx >= 0
        ? new URLSearchParams(window.location.hash.slice(hashQueryIdx + 1))
        : null;
    const raw =
      params.get('agent') ||
      params.get('ref') ||
      params.get('code') ||
      params.get('invite') ||
      hashParams?.get('agent') ||
      hashParams?.get('ref') ||
      hashParams?.get('code') ||
      hashParams?.get('invite') ||
      '';
    const ref = normalizeReferralCode(raw);
    if (!ref) return null;
    savePendingRef(ref);
    const cleanUrl = `${window.location.pathname}${window.location.hash}`;
    window.history.replaceState({}, '', cleanUrl);
    return ref;
  } catch {
    return null;
  }
}

function generateUniqueUserId(excludeRef: string | null): string {
  let candidate = String(Math.floor(100000 + Math.random() * 899999));
  while (`AUREX-${candidate}` === excludeRef || candidate === '415061') {
    candidate = String(Math.floor(100000 + Math.random() * 899999));
  }
  return candidate;
}

function deriveNumericIdFromUid(uid: string): string {
  let hash = 0;
  for (let i = 0; i < uid.length; i += 1) {
    hash = (hash * 31 + uid.charCodeAt(i)) % 900000;
  }
  return String(100000 + Math.abs(hash));
}

function makeDocId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function formatCloudTimestamp(val: unknown, fallback: string): string {
  if (val instanceof Timestamp) {
    return formatTimestamp(val.toDate());
  }
  if (typeof val === 'string' && val.trim()) {
    return val;
  }
  return fallback;
}

function loadInitialState(): WalletState {
  const urlRef = readRefFromUrl();
  const pendingRef = urlRef || readPendingRef();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      if (pendingRef) {
        const newId = generateUniqueUserId(pendingRef);
        const suffix = newId.slice(-2);
        return {
          ...INITIAL_STATE,
          referredBy: pendingRef,
          profile: {
            ...DEFAULT_PROFILE,
            userId: newId,
            username: `User_${suffix}`,
            upiId: `user${suffix}@okaxis`,
          },
        };
      }
      return INITIAL_STATE;
    }
    const parsed = JSON.parse(raw) as Partial<WalletState>;
    const profile: UserProfile = {
      ...DEFAULT_PROFILE,
      ...(parsed.profile ?? {}),
    };

    // If user clicked a referral link (?ref=AUREX-...) in browser while a different session was cached,
    // reset authAccount so the Login / Sign Up page opens first with the referral code pre-filled.
    if (
      urlRef &&
      parsed.authAccount &&
      urlRef !== parsed.authAccount.referralCode
    ) {
      return {
        ...INITIAL_STATE,
        authAccount: null,
        referredBy: urlRef,
      };
    }

    const canAttachRef =
      !parsed.referredBy &&
      pendingRef &&
      pendingRef !== `AUREX-${profile.userId}`;
    return {
      ...INITIAL_STATE,
      ...parsed,
      profile,
      linkedPaymentApp: parsed.linkedPaymentApp ?? null,
      adminOrders: Array.isArray(parsed.adminOrders)
        ? parsed.adminOrders.map((o) => ({
            ...o,
            paymentLink:
              !o?.paymentLink ||
              o.paymentLink === 'bladepay://auto' ||
              o.paymentLink === 'silkpay://auto'
                ? DEFAULT_PAY_LINK
                : o.paymentLink,
          }))
        : INITIAL_STATE.adminOrders,
      withdrawRequests: Array.isArray(parsed.withdrawRequests)
        ? parsed.withdrawRequests
        : [],
      referredBy:
        !parsed.authAccount && pendingRef
          ? pendingRef
          : canAttachRef
          ? pendingRef
          : parsed.referredBy ?? null,
      referrals: Array.isArray(parsed.referrals)
        ? parsed.referrals
        : INITIAL_STATE.referrals,
      referralBonusEarned:
        typeof parsed.referralBonusEarned === 'number'
          ? parsed.referralBonusEarned
          : 0,
      referralMilestonesPaid:
        typeof parsed.referralMilestonesPaid === 'number'
          ? parsed.referralMilestonesPaid
          : 0,
      transactions: Array.isArray(parsed.transactions)
        ? parsed.transactions
        : INITIAL_STATE.transactions,
      notifications: Array.isArray(parsed.notifications)
        ? parsed.notifications
        : INITIAL_STATE.notifications,
    };
  } catch {
    return INITIAL_STATE;
  }
}

function walletActivityScore(w?: Partial<WalletState> | null): number {
  if (!w || typeof w !== 'object') return -1;
  const nonSeedTx = Array.isArray(w.transactions)
    ? w.transactions.filter((tx) => tx && tx.id !== 'tx-seed-1').length
    : 0;
  const customOrPaidOrders = Array.isArray(w.adminOrders)
    ? w.adminOrders.filter(
        (o) => o && (o.id !== 'adm-ord-1000' || o.status !== 'active')
      ).length
    : 0;
  return (
    nonSeedTx * 10 +
    (Array.isArray(w.withdrawRequests) ? w.withdrawRequests.length : 0) * 10 +
    customOrPaidOrders * 6 +
    Number(w.completedOrdersCount ?? 0) * 5 +
    (w.linkedPaymentApp ? 4 : 0) +
    (Number(w.totalPaid ?? 0) > 0 ? 5 : 0) +
    (Number(w.walletBalance ?? 0) > 0 ? 4 : 0) +
    Number(w.streakDays ?? 0)
  );
}

function mergeRestoredWallets(
  serverWallet?: Partial<WalletState> | null,
  localWallet?: Partial<WalletState> | null
): { merged: Partial<WalletState> | null; preferLocalOverServer: boolean } {
  if (!serverWallet && !localWallet) {
    return { merged: null, preferLocalOverServer: false };
  }
  if (!serverWallet) {
    return { merged: localWallet ?? null, preferLocalOverServer: true };
  }
  if (!localWallet) {
    return { merged: serverWallet, preferLocalOverServer: false };
  }

  const sScore = walletActivityScore(serverWallet);
  const lScore = walletActivityScore(localWallet);
  const preferLocalOverServer = lScore > sScore;
  const primary = preferLocalOverServer ? localWallet : serverWallet;
  const secondary = preferLocalOverServer ? serverWallet : localWallet;

  const orderMap = new Map<string, AdminOrder>();
  const ingestOrders = (list?: AdminOrder[]) => {
    if (!Array.isArray(list)) return;
    for (const o of list) {
      if (!o?.id) continue;
      const prev = orderMap.get(o.id);
      if (!prev) {
        orderMap.set(o.id, o);
      } else {
        const prevDone = prev.status === 'success' || prev.status === 'rejected';
        const nextActive = o.status === 'active';
        orderMap.set(o.id, {
          ...prev,
          ...o,
          status: prevDone && (nextActive || o.status === 'pending') ? prev.status : o.status,
        });
      }
    }
  };
  ingestOrders(secondary.adminOrders);
  ingestOrders(primary.adminOrders);

  const txMap = new Map<string, Transaction>();
  const ingestTx = (list?: Transaction[]) => {
    if (!Array.isArray(list)) return;
    for (const tx of list) {
      if (!tx?.id) continue;
      const prev = txMap.get(tx.id);
      if (!prev) {
        txMap.set(tx.id, tx);
      } else {
        const keepFinal =
          (prev.status === 'Success' || prev.status === 'Rejected') &&
          tx.status === 'Pending'
            ? prev.status
            : tx.status;
        txMap.set(tx.id, { ...prev, ...tx, status: keepFinal });
      }
    }
  };
  ingestTx(secondary.transactions);
  ingestTx(primary.transactions);

  const notifMap = new Map<string, AppNotification>();
  for (const n of [...(secondary.notifications || []), ...(primary.notifications || [])]) {
    if (n?.id) notifMap.set(n.id, n);
  }

  const refMap = new Map<string, ReferralRecord>();
  for (const r of [...(secondary.referrals || []), ...(primary.referrals || [])]) {
    if (!r?.inviteeId) continue;
    const prev = refMap.get(r.inviteeId);
    if (!prev || r.status === 'completed') {
      refMap.set(r.inviteeId, prev ? { ...prev, ...r } : r);
    }
  }

  const wdrMap = new Map<string, WithdrawRequest>();
  for (const w of [...(secondary.withdrawRequests || []), ...(primary.withdrawRequests || [])]) {
    if (!w?.id) continue;
    const prev = wdrMap.get(w.id);
    if (!prev || (prev.status === 'Pending' && w.status !== 'Pending')) {
      wdrMap.set(w.id, prev ? { ...prev, ...w } : w);
    }
  }

  const secProfile = secondary.profile ?? DEFAULT_PROFILE;
  const priProfile = primary.profile ?? DEFAULT_PROFILE;

  const mergedOrders =
    orderMap.size > 0 ? Array.from(orderMap.values()) : INITIAL_STATE.adminOrders;
  const mergedTxs =
    txMap.size > 0 ? Array.from(txMap.values()) : INITIAL_STATE.transactions;
  const mergedWdrs = Array.from(wdrMap.values());

  // Reconcile balance & earnings against settled transactions so stale 0-balance state can never wipe credited earnings
  let successOrderReturn = 0;
  let successOrderPrincipal = 0;
  let successOrderCommission = 0;
  let successOrderCount = 0;
  let successBonuses = 0;
  let referralBonusFromTxs = 0;
  let txWithdrawalDebit = 0;

  for (const tx of mergedTxs) {
    if (!tx) continue;
    if (tx.type === 'order_payout' && tx.status === 'Success') {
      successOrderReturn += Number(tx.amount ?? 0);
      const p = Number(tx.paidAmount ?? roundCurrency(Number(tx.amount ?? 0) / 1.11));
      const c = Number(tx.commissionAmount ?? roundCurrency(Number(tx.amount ?? 0) - p));
      successOrderPrincipal += p;
      successOrderCommission += c;
      successOrderCount += 1;
    } else if ((tx.type === 'daily_bonus' || tx.type === 'referral_bonus') && tx.status === 'Success') {
      successBonuses += Number(tx.amount ?? 0);
      if (tx.type === 'referral_bonus') {
        referralBonusFromTxs += Number(tx.amount ?? 0);
      }
    } else if (tx.type === 'withdrawal' && tx.status !== 'Rejected') {
      txWithdrawalDebit += Number(tx.amount ?? 0);
    }
  }

  const wdrDebit =
    mergedWdrs.length > 0
      ? mergedWdrs.reduce(
          (acc, w) => (w && w.status !== 'Rejected' ? acc + Number(w.amount ?? 0) : acc),
          0
        )
      : txWithdrawalDebit;
  const ledgerFloor = Math.max(
    0,
    roundCurrency(successOrderReturn + successBonuses - wdrDebit)
  );
  const priBal = Number(primary.walletBalance ?? 0);
  const secBal = Number(secondary.walletBalance ?? 0);
  const reconciledBalance = Math.max(
    priBal,
    ledgerFloor,
    priBal === 0 && secBal > 0 && wdrDebit === 0 ? secBal : 0
  );

  return {
    preferLocalOverServer: preferLocalOverServer || reconciledBalance > Number(serverWallet.walletBalance ?? 0),
    merged: {
      ...INITIAL_STATE,
      ...secondary,
      ...primary,
      walletBalance: reconciledBalance,
      totalPaid: Math.max(
        Number(primary.totalPaid ?? 0),
        Number(secondary.totalPaid ?? 0),
        roundCurrency(successOrderPrincipal)
      ),
      totalCashbackEarned: Math.max(
        Number(primary.totalCashbackEarned ?? 0),
        Number(secondary.totalCashbackEarned ?? 0),
        roundCurrency(successOrderCommission + referralBonusFromTxs)
      ),
      completedOrdersCount: Math.max(
        Number(primary.completedOrdersCount ?? 0),
        Number(secondary.completedOrdersCount ?? 0),
        successOrderCount
      ),
      referralBonusEarned: Math.max(
        Number(primary.referralBonusEarned ?? 0),
        Number(secondary.referralBonusEarned ?? 0),
        roundCurrency(referralBonusFromTxs)
      ),
      referralMilestonesPaid: Math.max(
        Number(primary.referralMilestonesPaid ?? 0),
        Number(secondary.referralMilestonesPaid ?? 0),
        Math.floor(referralBonusFromTxs / 100)
      ),
      linkedPaymentApp: primary.linkedPaymentApp ?? secondary.linkedPaymentApp ?? null,
      defaultPaymentLink: primary.defaultPaymentLink || secondary.defaultPaymentLink || DEFAULT_PAY_LINK,
      adminOrders: mergedOrders,
      transactions: mergedTxs,
      notifications:
        notifMap.size > 0
          ? Array.from(notifMap.values())
          : INITIAL_STATE.notifications,
      referrals: Array.from(refMap.values()),
      withdrawRequests: mergedWdrs,
      profile: {
        ...DEFAULT_PROFILE,
        ...secProfile,
        ...priProfile,
        upiId:
          priProfile.upiId && priProfile.upiId !== DEFAULT_PROFILE.upiId
            ? priProfile.upiId
            : secProfile.upiId || priProfile.upiId,
        bankName:
          priProfile.bankName && priProfile.bankName !== DEFAULT_PROFILE.bankName
            ? priProfile.bankName
            : secProfile.bankName || priProfile.bankName,
        accountLast4:
          priProfile.accountLast4 && priProfile.accountLast4 !== DEFAULT_PROFILE.accountLast4
            ? priProfile.accountLast4
            : secProfile.accountLast4 || priProfile.accountLast4,
      },
    },
  };
}

interface CloudSubmissionDoc {
  id: string;
  orderId: string;
  orderCode: string;
  userUid: string;
  userName: string;
  amount: number;
  paymentLink: string;
  utrRef: string;
  status: 'pending' | 'success' | 'rejected';
  paidAt?: string;
}

interface UseWalletStoreOptions {
  user?: User | null;
  authReady?: boolean;
  isAdmin?: boolean;
}

export interface WithdrawDetailsInput {
  method: WithdrawMethod;
  upiId?: string;
  bankName?: string;
  accountNumber?: string;
  ifscCode?: string;
  mobileNumber?: string;
}

const USER_MESSAGES_CACHE_KEY = 'aurex_vault_user_messages_v1';
const ADMIN_THREADS_CACHE_KEY = 'aurex_vault_admin_threads_v1';
const WITHDRAWALS_CACHE_KEY = 'aurex_vault_withdrawals_cache_v1';
const ADMIN_SUBMISSIONS_CACHE_KEY = 'aurex_vault_admin_submissions_v1';
const USER_SUBMISSIONS_CACHE_KEY = 'aurex_vault_user_submissions_v1';
const ADMIN_USERS_CACHE_KEY = 'aurex_vault_admin_users_v1';
const REFERRALS_CACHE_KEY = 'aurex_vault_referrals_cache_v1';

function readRemovedOrderIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(REMOVED_ORDERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeRemovedOrderIds(ids: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(REMOVED_ORDERS_KEY, JSON.stringify(ids.slice(-200)));
  } catch {
    // ignore quota errors
  }
}

interface CachedOrderSub {
  id: string;
  orderId: string;
  orderCode: string;
  userUid: string;
  userName: string;
  userMobile?: string;
  amount: number;
  paymentLink: string;
  utrRef: string;
  referredBy: string | null;
  status: 'pending' | 'success' | 'rejected';
  paidAt: string;
  createdAt: string;
}

function readCachedWithdrawals(scopeKey: string): WithdrawRequest[] {
  if (!scopeKey || typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(`${WITHDRAWALS_CACHE_KEY}_${scopeKey}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCachedWithdrawals(scopeKey: string, list: WithdrawRequest[]): void {
  if (!scopeKey || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      `${WITHDRAWALS_CACHE_KEY}_${scopeKey}`,
      JSON.stringify(list.slice(0, 150))
    );
  } catch {
    // ignore quota errors
  }
}

function readCachedAdminSubmissions(): CachedOrderSub[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(ADMIN_SUBMISSIONS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCachedAdminSubmissions(list: CachedOrderSub[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      ADMIN_SUBMISSIONS_CACHE_KEY,
      JSON.stringify(list.slice(0, 200))
    );
  } catch {
    // ignore quota errors
  }
}

function updateCachedAdminSubmissionStatus(
  id: string,
  status: 'success' | 'rejected'
): void {
  if (typeof window === 'undefined') return;
  const current = readCachedAdminSubmissions();
  if (current.length === 0) return;
  let changed = false;
  const next = current.map((s) => {
    if ((s.id === id || s.orderId === id) && s.status !== status) {
      changed = true;
      return { ...s, status };
    }
    return s;
  });
  if (changed) {
    writeCachedAdminSubmissions(next);
  }
}

function readCachedUserSubmissions(uid?: string): CachedOrderSub[] {
  if (!uid || typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(`${USER_SUBMISSIONS_CACHE_KEY}_${uid}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCachedUserSubmissions(uid: string | undefined, list: CachedOrderSub[]): void {
  if (!uid || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      `${USER_SUBMISSIONS_CACHE_KEY}_${uid}`,
      JSON.stringify(list.slice(0, 150))
    );
  } catch {
    // ignore quota errors
  }
}

function readCachedAdminUsers(): AdminUserRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(ADMIN_USERS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seenMobiles = new Set<string>();
    return (parsed as AdminUserRecord[]).filter((u) => {
      if (!u || !u.userId || u.userId === '415061' || u.userId === '882836') return false;
      const mob = normalizeIndianMobile(u.mobileNumber);
      if (mob && seenMobiles.has(mob)) return false;
      if (mob) seenMobiles.add(mob);
      return true;
    });
  } catch {
    return [];
  }
}

function writeCachedAdminUsers(list: AdminUserRecord[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      ADMIN_USERS_CACHE_KEY,
      JSON.stringify(list.slice(0, 250))
    );
  } catch {
    // ignore quota errors
  }
}

function readCachedReferrals(uid?: string): ReferralRecord[] {
  if (!uid || typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(`${REFERRALS_CACHE_KEY}_${uid}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCachedReferrals(uid: string | undefined, list: ReferralRecord[]): void {
  if (!uid || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      `${REFERRALS_CACHE_KEY}_${uid}`,
      JSON.stringify(list.slice(0, 200))
    );
  } catch {
    // ignore quota errors
  }
}

function readCachedUserMessages(uid?: string): ChatMessage[] {
  if (!uid || typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(`${USER_MESSAGES_CACHE_KEY}_${uid}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCachedUserMessages(uid: string | undefined, msgs: ChatMessage[]): void {
  if (!uid || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      `${USER_MESSAGES_CACHE_KEY}_${uid}`,
      JSON.stringify(msgs.slice(-150))
    );
  } catch {
    // ignore quota errors cleanly
  }
}

function readCachedAdminThreads(mobile?: string): AdminChatThread[] {
  if (!isAdminMobile(mobile) || typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(ADMIN_THREADS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCachedAdminThreads(mobile: string | undefined, threads: AdminChatThread[]): void {
  if (!isAdminMobile(mobile) || typeof window === 'undefined') return;
  try {
    const trimmed = threads.map((th) => ({
      ...th,
      messages: th.messages.slice(-80),
    }));
    window.localStorage.setItem(ADMIN_THREADS_CACHE_KEY, JSON.stringify(trimmed));
  } catch {
    // ignore quota errors cleanly
  }
}

export function useWalletStore(
  lang: Language = 'zh',
  options: UseWalletStoreOptions = {}
) {
  const { user = null, authReady = false, isAdmin = false } = options;
  const [state, setState] = useState<WalletState>(loadInitialState);
  const [adminUsers, setAdminUsers] = useState<AdminUserRecord[]>(() => {
    const init = loadInitialState();
    return isAdminMobile(init.authAccount?.mobileNumber) ? readCachedAdminUsers() : [];
  });
  const [userMessages, setUserMessages] = useState<ChatMessage[]>(() => {
    const init = loadInitialState();
    const uid = init.authAccount?.userId || init.profile.userId;
    return readCachedUserMessages(uid);
  });
  const [adminChatThreads, setAdminChatThreads] = useState<AdminChatThread[]>(() => {
    const init = loadInitialState();
    return readCachedAdminThreads(init.authAccount?.mobileNumber);
  });
  const [cloudReady, setCloudReady] = useState(false);
  const t = translations[lang];

  const stateRef = useRef(state);
  stateRef.current = state;

  const templatesRef = useRef<AdminOrder[]>([]);
  const submissionsRef = useRef<CloudSubmissionDoc[]>([]);
  const milestoneSyncLockRef = useRef(false);
  const flushingOutboxPromiseRef = useRef<Promise<void> | null>(null);
  const removedOrderIdsRef = useRef<Set<string>>(new Set(readRemovedOrderIds()));
  const pendingOrderDecisionRef = useRef<
    Map<string, { status: 'success' | 'rejected'; expiresAt: number }>
  >(new Map());
  const pendingWithdrawalDecisionRef = useRef<
    Map<string, { status: 'Success' | 'Rejected'; expiresAt: number }>
  >(new Map());
  const markReadCooldownRef = useRef<Map<string, number>>(new Map());
  const syncedAdminLocalUsersSigRef = useRef<string>('');
  const passwordResetOverrideRef = useRef<Map<string, { password: string; expiresAt: number }>>(
    new Map()
  );

  const isCloudUser = Boolean(authReady && user);

  useEffect(() => {
    const uid = state.authAccount?.userId || state.profile.userId;
    if (uid && userMessages.length > 0) {
      writeCachedUserMessages(uid, userMessages);
    }
  }, [state.authAccount?.userId, state.profile.userId, userMessages]);

  useEffect(() => {
    if (isAdminMobile(state.authAccount?.mobileNumber) && adminChatThreads.length > 0) {
      writeCachedAdminThreads(state.authAccount?.mobileNumber, adminChatThreads);
    }
  }, [state.authAccount?.mobileNumber, adminChatThreads]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore storage errors
    }
    const accountId = state.authAccount?.userId;
    const isAdminAccount = isAdminMobile(state.authAccount?.mobileNumber);
    if (accountId && !isCloudUser) {
      saveFallbackWallet(accountId, state, state.authAccount?.mobileNumber);
      void safeFetchJson(`/api/wallet/${encodeURIComponent(accountId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: state }),
      }).then((res) => {
        if (res.available && res.ok && isAdminAccount && adminUsers.length === 0) {
          void syncAdminUsersFromServer();
        }
      });
    }
  }, [state, isCloudUser]);

  const rebuildMergedOrders = useCallback(
    (uid: string) => {
      const templates = templatesRef.current;
      const subs = submissionsRef.current;

      const userSubmittedTemplateIds = new Set(
        subs.filter((s) => s.userUid === uid).map((s) => s.orderId)
      );

      const activeTemplates: AdminOrder[] = templates
        .filter((tpl) => tpl.status === 'active' && !userSubmittedTemplateIds.has(tpl.id))
        .map((tpl) => ({ ...tpl }));

      const submissionOrders: AdminOrder[] = subs.map((s) => ({
        id: s.id,
        submissionId: s.id,
        userUid: s.userUid,
        userName: s.userName,
        orderCode: s.orderCode,
        amount: s.amount,
        paymentLink: s.paymentLink,
        commissionRate: COMMISSION_RATE,
        createdAt: s.paidAt || formatTimestamp(),
        paidAt: s.paidAt,
        utrRef: s.utrRef,
        status: s.status,
      }));

      setState((prev) => ({
        ...prev,
        adminOrders: [...submissionOrders, ...activeTemplates],
      }));
    },
    []
  );

  // Register referral attribution in Firestore if referredBy exists & payment app is linked
  const ensureCloudReferralRegistered = useCallback(
    async (
      currentUser: User,
      referredByCode: string | null,
      inviteeName: string
    ) => {
      if (!referredByCode) return;
      const myRefDocRef = doc(db, 'referrals', currentUser.uid);
      try {
        const existingRef = await getDoc(myRefDocRef);
        if (existingRef.exists()) return;

        const codeSnap = await getDoc(doc(db, 'referral_codes', referredByCode));
        if (!codeSnap.exists()) return;

        const codeData = codeSnap.data() as { ownerUid?: string };
        if (!codeData.ownerUid || codeData.ownerUid === currentUser.uid) return;

        const now = formatTimestamp();
        await setDoc(myRefDocRef, {
          referrerUid: codeData.ownerUid,
          referrerCode: referredByCode,
          inviteeUid: currentUser.uid,
          inviteeName: inviteeName.slice(0, 64) || 'User',
          registeredAt: now,
          status: 'registered',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(
          err,
          OperationType.WRITE,
          `referrals/${currentUser.uid}`
        );
      }
    },
    []
  );

  // Bootstrap & real-time sync with Cloud Firestore when authenticated
  useEffect(() => {
    if (!authReady || !user) {
      setCloudReady(false);
      return;
    }

    let cancelled = false;
    const unsubscribers: Array<() => void> = [];

    const setupCloudSync = async () => {
      const uid = user.uid;
      const walletRef = doc(db, 'wallets', uid);
      const privateRef = doc(db, 'wallets', uid, 'private', 'info');
      const localSnapshot = stateRef.current;

      try {
        const walletSnap = await getDoc(walletRef);

        if (!walletSnap.exists()) {
          // Pick a unique userId & referralCode for this cloud account
          let chosenUserId = localSnapshot.profile.userId || deriveNumericIdFromUid(uid);
          let candidateCode = `AUREX-${chosenUserId}`;
          const codeSnap = await getDoc(doc(db, 'referral_codes', candidateCode));
          if (codeSnap.exists() && codeSnap.data().ownerUid !== uid) {
            chosenUserId = deriveNumericIdFromUid(uid);
            candidateCode = `AUREX-${chosenUserId}`;
          }

          const displayName =
            user.displayName?.trim().slice(0, 64) ||
            localSnapshot.profile.username ||
            `User_${chosenUserId.slice(-2)}`;

          const referredByValid =
            localSnapshot.referredBy &&
            localSnapshot.referredBy !== candidateCode
              ? localSnapshot.referredBy.slice(0, 32)
              : undefined;

          const walletPayload: Record<string, unknown> = {
            uid,
            username: displayName,
            userId: chosenUserId,
            referralCode: candidateCode,
            walletBalance: Math.max(0, roundCurrency(localSnapshot.walletBalance)),
            totalPaid: Math.max(0, roundCurrency(localSnapshot.totalPaid)),
            totalWithdrawal: Math.max(
              0,
              roundCurrency(localSnapshot.totalWithdrawal)
            ),
            totalCashbackEarned: Math.max(
              0,
              roundCurrency(localSnapshot.totalCashbackEarned)
            ),
            completedOrdersCount: Math.max(0, localSnapshot.completedOrdersCount),
            referralBonusEarned: Math.max(
              0,
              roundCurrency(localSnapshot.referralBonusEarned)
            ),
            referralMilestonesPaid: Math.max(
              0,
              localSnapshot.referralMilestonesPaid
            ),
            streakDays: Math.max(0, localSnapshot.streakDays),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };

          if (referredByValid) {
            walletPayload.referredBy = referredByValid;
          }
          if (localSnapshot.dailyCheckInDate) {
            walletPayload.dailyCheckInDate = localSnapshot.dailyCheckInDate;
          }
          if (localSnapshot.linkedPaymentApp) {
            walletPayload.linkedAppId = localSnapshot.linkedPaymentApp.appId;
            walletPayload.linkedAppName = localSnapshot.linkedPaymentApp.appName;
            walletPayload.linkedAt = localSnapshot.linkedPaymentApp.linkedAt;
          }

          // Create parent wallet document FIRST (satisfies existsAfter Master Gate)
          await setDoc(walletRef, walletPayload);

          // Create isolated private PII document
          const privatePayload: Record<string, unknown> = {
            uid,
            upiId: localSnapshot.profile.upiId,
            bankName: localSnapshot.profile.bankName,
            accountLast4: localSnapshot.profile.accountLast4.slice(0, 4),
            updatedAt: serverTimestamp(),
          };
          const mobileToSave =
            localSnapshot.linkedPaymentApp?.mobileNumber ||
            localSnapshot.profile.mobileNumber ||
            localSnapshot.authAccount?.mobileNumber;
          if (mobileToSave) {
            privatePayload.mobileNumber = mobileToSave;
          }
          await setDoc(privateRef, privatePayload);

          // Register referral code lookup
          const finalCodeSnap = await getDoc(
            doc(db, 'referral_codes', candidateCode)
          );
          if (!finalCodeSnap.exists()) {
            await setDoc(doc(db, 'referral_codes', candidateCode), {
              ownerUid: uid,
              code: candidateCode,
              createdAt: serverTimestamp(),
            });
          }

          // Migrate existing local transactions & notifications
          for (const tx of localSnapshot.transactions.slice(0, 25)) {
            const safeId = tx.id.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 100);
            const txDoc: Record<string, unknown> = {
              uid,
              type: tx.type,
              title: tx.title.slice(0, 120),
              subtitle: tx.subtitle.slice(0, 200),
              amount: Math.max(0, roundCurrency(tx.amount)),
              status: tx.status,
              timestamp: tx.timestamp,
              referenceId: tx.referenceId.slice(0, 40),
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            };
            if (tx.orderId) txDoc.orderId = tx.orderId;
            if (tx.titleZh) txDoc.titleZh = tx.titleZh.slice(0, 120);
            if (tx.subtitleZh) txDoc.subtitleZh = tx.subtitleZh.slice(0, 200);
            if (typeof tx.paidAmount === 'number') {
              txDoc.paidAmount = Math.max(0, roundCurrency(tx.paidAmount));
            }
            if (typeof tx.commissionAmount === 'number') {
              txDoc.commissionAmount = Math.max(
                0,
                roundCurrency(tx.commissionAmount)
              );
            }
            await setDoc(doc(db, 'wallets', uid, 'transactions', safeId), txDoc);
          }

          for (const n of localSnapshot.notifications.slice(0, 20)) {
            const safeId = n.id.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 100);
            const nDoc: Record<string, unknown> = {
              uid,
              title: n.title.slice(0, 140),
              message: n.message.slice(0, 300),
              timestamp: n.timestamp,
              read: Boolean(n.read),
              kind: n.kind,
              createdAt: serverTimestamp(),
            };
            if (n.titleZh) nDoc.titleZh = n.titleZh.slice(0, 140);
            if (n.messageZh) nDoc.messageZh = n.messageZh.slice(0, 300);
            await setDoc(doc(db, 'wallets', uid, 'notifications', safeId), nDoc);
          }

          if (referredByValid && localSnapshot.linkedPaymentApp) {
            await ensureCloudReferralRegistered(
              user,
              referredByValid,
              displayName
            );
          }
        } else {
          const existingWallet = walletSnap.data();
          const existingCode = String(existingWallet.referralCode || '');

          if (existingCode) {
            const codeDoc = await getDoc(doc(db, 'referral_codes', existingCode));
            if (!codeDoc.exists()) {
              await setDoc(doc(db, 'referral_codes', existingCode), {
                ownerUid: uid,
                code: existingCode,
                createdAt: serverTimestamp(),
              });
            }
          }

          // Attach URL referral if user hadn't been attributed yet
          if (
            !existingWallet.referredBy &&
            localSnapshot.referredBy &&
            localSnapshot.referredBy !== existingCode
          ) {
            await updateDoc(walletRef, {
              referredBy: localSnapshot.referredBy.slice(0, 32),
              updatedAt: serverTimestamp(),
            });
            if (existingWallet.linkedAppId) {
              await ensureCloudReferralRegistered(
                user,
                localSnapshot.referredBy,
                String(existingWallet.username || 'User')
              );
            }
          }
        }

      } catch (err) {
        if (!cancelled) {
          handleFirestoreError(err, OperationType.WRITE, `wallets/${uid}`);
        }
        return;
      }

      if (cancelled) return;

      // 1. Wallet main doc listener
      unsubscribers.push(
        onSnapshot(
          walletRef,
          (snap) => {
            if (!snap.exists()) return;
            const d = snap.data();
            setState((prev) => {
              const linkedApp: LinkedPaymentApp | null = d.linkedAppId
                ? {
                    appId: String(d.linkedAppId),
                    appName: String(d.linkedAppName || d.linkedAppId),
                    mobileNumber: prev.linkedPaymentApp?.mobileNumber || '',
                    linkedAt: String(d.linkedAt || ''),
                  }
                : null;
              return {
                ...prev,
                walletBalance: Number(d.walletBalance ?? 0),
                totalPaid: Number(d.totalPaid ?? 0),
                totalWithdrawal: Number(d.totalWithdrawal ?? 0),
                totalCashbackEarned: Number(d.totalCashbackEarned ?? 0),
                completedOrdersCount: Number(d.completedOrdersCount ?? 0),
                referralBonusEarned: Number(d.referralBonusEarned ?? 0),
                referralMilestonesPaid: Number(d.referralMilestonesPaid ?? 0),
                streakDays: Number(d.streakDays ?? 0),
                dailyCheckInDate:
                  typeof d.dailyCheckInDate === 'string'
                    ? d.dailyCheckInDate
                    : null,
                referredBy:
                  typeof d.referredBy === 'string' ? d.referredBy : null,
                linkedPaymentApp: linkedApp,
                profile: {
                  ...prev.profile,
                  username: String(d.username || prev.profile.username),
                  userId: String(d.userId || prev.profile.userId),
                },
              };
            });
          },
          (error) => {
            handleFirestoreError(error, OperationType.GET, `wallets/${uid}`);
          }
        )
      );

      // 2. Private PII doc listener
      unsubscribers.push(
        onSnapshot(
          privateRef,
          (snap) => {
            if (!snap.exists()) return;
            const d = snap.data();
            setState((prev) => ({
              ...prev,
              linkedPaymentApp: prev.linkedPaymentApp
                ? {
                    ...prev.linkedPaymentApp,
                    mobileNumber: String(
                      d.mobileNumber || prev.linkedPaymentApp.mobileNumber || ''
                    ),
                  }
                : prev.linkedPaymentApp,
              profile: {
                ...prev.profile,
                mobileNumber:
                  typeof d.mobileNumber === 'string' && d.mobileNumber
                    ? d.mobileNumber
                    : prev.profile.mobileNumber,
                upiId: String(d.upiId || prev.profile.upiId),
                bankName: String(d.bankName || prev.profile.bankName),
                accountLast4: String(
                  d.accountLast4 || prev.profile.accountLast4
                ),
              },
            }));
          },
          (error) => {
            handleFirestoreError(
              error,
              OperationType.GET,
              `wallets/${uid}/private/info`
            );
          }
        )
      );

      // 3. Transactions subcollection listener
      const txPath = `wallets/${uid}/transactions`;
      unsubscribers.push(
        onSnapshot(
          query(collection(db, txPath), orderBy('createdAt', 'desc')),
          (snap) => {
            const list: Transaction[] = snap.docs.map((docSnap) => {
              const d = docSnap.data();
              return {
                id: docSnap.id,
                orderId: typeof d.orderId === 'string' ? d.orderId : undefined,
                type: d.type,
                title: String(d.title || ''),
                titleZh: typeof d.titleZh === 'string' ? d.titleZh : undefined,
                subtitle: String(d.subtitle || ''),
                subtitleZh:
                  typeof d.subtitleZh === 'string' ? d.subtitleZh : undefined,
                amount: Number(d.amount ?? 0),
                paidAmount:
                  typeof d.paidAmount === 'number' ? d.paidAmount : undefined,
                commissionAmount:
                  typeof d.commissionAmount === 'number'
                    ? d.commissionAmount
                    : undefined,
                status: d.status,
                timestamp: String(
                  d.timestamp || formatCloudTimestamp(d.createdAt, '')
                ),
                referenceId: String(d.referenceId || ''),
              };
            });
            setState((prev) => ({ ...prev, transactions: list }));
          },
          (error) => {
            handleFirestoreError(error, OperationType.LIST, txPath);
          }
        )
      );

      // 4. Notifications subcollection listener
      const notifPath = `wallets/${uid}/notifications`;
      unsubscribers.push(
        onSnapshot(
          query(collection(db, notifPath), orderBy('createdAt', 'desc')),
          (snap) => {
            const list: AppNotification[] = snap.docs.map((docSnap) => {
              const d = docSnap.data();
              return {
                id: docSnap.id,
                title: String(d.title || ''),
                titleZh: typeof d.titleZh === 'string' ? d.titleZh : undefined,
                message: String(d.message || ''),
                messageZh:
                  typeof d.messageZh === 'string' ? d.messageZh : undefined,
                timestamp: String(
                  d.timestamp || formatCloudTimestamp(d.createdAt, '')
                ),
                read: Boolean(d.read),
                kind: d.kind || 'system',
              };
            });
            setState((prev) => ({ ...prev, notifications: list }));
          },
          (error) => {
            handleFirestoreError(error, OperationType.LIST, notifPath);
          }
        )
      );

      // 5. Admin orders template listener (Rule-enforced: where isActive == true for regular users)
      const adminOrdersQuery = isAdmin
        ? collection(db, 'admin_orders')
        : query(collection(db, 'admin_orders'), where('isActive', '==', true));

      unsubscribers.push(
        onSnapshot(
          adminOrdersQuery,
          (snap) => {
            templatesRef.current = snap.docs.map((docSnap) => {
              const d = docSnap.data();
              return {
                id: docSnap.id,
                orderCode: String(d.orderCode || 'ORD-1000'),
                amount: Number(d.amount ?? 0),
                paymentLink: String(d.paymentLink || ''),
                commissionRate: Number(d.commissionRate ?? COMMISSION_RATE),
                createdAt: formatCloudTimestamp(d.createdAt, formatTimestamp()),
                status: d.isActive ? 'active' : 'rejected',
              };
            });
            rebuildMergedOrders(uid);
          },
          (error) => {
            handleFirestoreError(error, OperationType.LIST, 'admin_orders');
          }
        )
      );

      // 6. Order submissions listener (Admin sees all; regular users strictly filtered by userUid)
      const submissionsQuery = isAdmin
        ? collection(db, 'order_submissions')
        : query(
            collection(db, 'order_submissions'),
            where('userUid', '==', uid)
          );

      unsubscribers.push(
        onSnapshot(
          submissionsQuery,
          (snap) => {
            submissionsRef.current = snap.docs.map((docSnap) => {
              const d = docSnap.data();
              return {
                id: docSnap.id,
                orderId: String(d.orderId || ''),
                orderCode: String(d.orderCode || ''),
                userUid: String(d.userUid || ''),
                userName: String(d.userName || 'User'),
                amount: Number(d.amount ?? 0),
                paymentLink: String(d.paymentLink || ''),
                utrRef: String(d.utrRef || ''),
                status: d.status || 'pending',
                paidAt: typeof d.paidAt === 'string' ? d.paidAt : undefined,
              };
            });
            rebuildMergedOrders(uid);
          },
          (error) => {
            handleFirestoreError(
              error,
              OperationType.LIST,
              'order_submissions'
            );
          }
        )
      );

      // 7. Referrals listener (strictly filtered by referrerUid == uid)
      unsubscribers.push(
        onSnapshot(
          query(collection(db, 'referrals'), where('referrerUid', '==', uid)),
          async (snap) => {
            const list: ReferralRecord[] = snap.docs.map((docSnap) => {
              const d = docSnap.data();
              return {
                id: docSnap.id,
                inviteeId: String(d.inviteeUid || ''),
                inviteeName: String(d.inviteeName || 'User'),
                codeUsed: String(d.referrerCode || ''),
                registeredAt: String(d.registeredAt || ''),
                completedAt:
                  typeof d.completedAt === 'string' ? d.completedAt : undefined,
                status: d.status === 'completed' ? 'completed' : 'registered',
              };
            });

            setState((prev) => ({ ...prev, referrals: list }));

            // Automatically credit ₹100 for every 5 completed referrals (verified by Admin)
            const completedCount = list.filter(
              (r) => r.status === 'completed'
            ).length;
            const totalMilestonesEarned = Math.floor(completedCount / 5);

            if (milestoneSyncLockRef.current) return;

            try {
              const freshWalletSnap = await getDoc(walletRef);
              if (!freshWalletSnap.exists()) return;
              const wd = freshWalletSnap.data();
              const alreadyPaidMilestones = Number(
                wd.referralMilestonesPaid ?? 0
              );
              const newMilestones = Math.max(
                0,
                totalMilestonesEarned - alreadyPaidMilestones
              );

              if (newMilestones > 0) {
                milestoneSyncLockRef.current = true;
                const bonusAmount = newMilestones * 100;
                const now = formatTimestamp();
                const txId = makeDocId('tx-ref');
                const notifId = makeDocId('notif-ref');

                await updateDoc(walletRef, {
                  walletBalance: roundCurrency(
                    Number(wd.walletBalance ?? 0) + bonusAmount
                  ),
                  totalCashbackEarned: roundCurrency(
                    Number(wd.totalCashbackEarned ?? 0) + bonusAmount
                  ),
                  referralBonusEarned: roundCurrency(
                    Number(wd.referralBonusEarned ?? 0) + bonusAmount
                  ),
                  referralMilestonesPaid: totalMilestonesEarned,
                  updatedAt: serverTimestamp(),
                });

                await setDoc(doc(db, 'wallets', uid, 'transactions', txId), {
                  uid,
                  type: 'referral_bonus',
                  title: 'Referral Bonus (5 Qualified)',
                  titleZh: '邀请奖励（满5位达标好友）',
                  subtitle: `${completedCount} referred users registered & completed orders`,
                  subtitleZh: `已有 ${completedCount} 位受邀好友完成注册并完成订单`,
                  amount: bonusAmount,
                  commissionAmount: bonusAmount,
                  status: 'Success',
                  timestamp: now,
                  referenceId: generateRefId('REF'),
                  createdAt: serverTimestamp(),
                  updatedAt: serverTimestamp(),
                });

                await setDoc(
                  doc(db, 'wallets', uid, 'notifications', notifId),
                  {
                    uid,
                    title: `Referral Bonus · +${formatINR(bonusAmount)} Credited`,
                    titleZh: `推广奖金到账 · +${formatINR(bonusAmount)}`,
                    message: `5 referred friends registered and completed orders. ${formatINR(bonusAmount)} added to your wallet!`,
                    messageZh: `5 位受邀好友已完成注册并完成订单，${formatINR(bonusAmount)} 已发放至您的钱包！`,
                    timestamp: now,
                    read: false,
                    kind: 'payout',
                    createdAt: serverTimestamp(),
                  }
                );
              }
            } catch (err) {
              handleFirestoreError(
                err,
                OperationType.UPDATE,
                `wallets/${uid}`
              );
            } finally {
              milestoneSyncLockRef.current = false;
            }
          },
          (error) => {
            handleFirestoreError(error, OperationType.LIST, 'referrals');
          }
        )
      );

      if (!cancelled) {
        setCloudReady(true);
      }
    };

    setupCloudSync();

    return () => {
      cancelled = true;
      unsubscribers.forEach((unsub) => unsub());
    };
  }, [
    authReady,
    user,
    isAdmin,
    rebuildMergedOrders,
    ensureCloudReferralRegistered,
  ]);

  // Local Express referral sync when not signed into Firebase
  const syncReferralsFromServer = useCallback(async () => {
    if (isCloudUser) return;
    const uid =
      stateRef.current.authAccount?.userId || stateRef.current.profile.userId;
    const myCode =
      stateRef.current.authAccount?.referralCode || (uid ? `AUREX-${uid}` : '');
    if (!myCode) return;
    const aliases = Array.from(
      new Set(
        [myCode, ...(uid ? [`AUREX-${uid}`, `AGENT-${uid}`, uid] : [])].filter(
          Boolean
        )
      )
    );
    try {
      const res = await safeFetchJson<{ referrals?: ReferralRecord[] }>(
        `/api/referrals/${encodeURIComponent(myCode)}?userId=${encodeURIComponent(
          uid || ''
        )}`
      );
      const serverList =
        res.available && res.ok && Array.isArray(res.data.referrals)
          ? res.data.referrals
          : [];
      const fbList = getFallbackReferrals(aliases);
      const cachedList = readCachedReferrals(uid);
      if (!res.available && fbList.length === 0 && cachedList.length === 0) {
        return;
      }

      setState((prev) => {
        const mergedByInvitee = new Map<string, ReferralRecord>();
        const ingest = (list: ReferralRecord[]) => {
          for (const r of list) {
            if (!r?.inviteeId || r.inviteeId === uid) continue;
            const prevRec = mergedByInvitee.get(r.inviteeId);
            if (!prevRec) {
              mergedByInvitee.set(r.inviteeId, r);
            } else {
              const isCompleted =
                prevRec.status === 'completed' || r.status === 'completed';
              mergedByInvitee.set(r.inviteeId, {
                ...prevRec,
                ...r,
                status: isCompleted ? 'completed' : 'registered',
                completedAt: r.completedAt || prevRec.completedAt,
              });
            }
          }
        };

        ingest(cachedList);
        ingest(prev.referrals);
        ingest(fbList);
        ingest(serverList);

        const mergedList = Array.from(mergedByInvitee.values()).sort((a, b) =>
          String(b.registeredAt || '').localeCompare(String(a.registeredAt || ''))
        );
        writeCachedReferrals(uid, mergedList);

        const listUnchanged =
          prev.referrals.length === mergedList.length &&
          prev.referrals.every(
            (p, idx) =>
              p.inviteeId === mergedList[idx]?.inviteeId &&
              p.status === mergedList[idx]?.status &&
              p.inviteeName === mergedList[idx]?.inviteeName
          );

        const completedCount = mergedList.filter(
          (r) => r.status === 'completed'
        ).length;
        const totalMilestonesEarned = Math.floor(completedCount / 5);
        const newMilestones = Math.max(
          0,
          totalMilestonesEarned - prev.referralMilestonesPaid
        );

        if (listUnchanged && newMilestones === 0) {
          return prev;
        }

        if (newMilestones > 0) {
          const now = formatTimestamp();
          const bonusAmount = newMilestones * 100;
          const tx: Transaction = {
            id: makeDocId('tx'),
            type: 'referral_bonus',
            title: 'Referral Bonus (5 Qualified)',
            titleZh: '邀请奖励（满5位达标好友）',
            subtitle: `${completedCount} referred users registered & completed orders`,
            subtitleZh: `已有 ${completedCount} 位受邀好友完成注册并完成订单`,
            amount: bonusAmount,
            commissionAmount: bonusAmount,
            status: 'Success',
            timestamp: now,
            referenceId: generateRefId('REF'),
          };
          const notif: AppNotification = {
            id: makeDocId('notif'),
            title: `Referral Bonus · +${formatINR(bonusAmount)} Credited`,
            titleZh: `推广奖金到账 · +${formatINR(bonusAmount)}`,
            message: `5 referred friends registered and completed orders. ${formatINR(bonusAmount)} added to your wallet!`,
            messageZh: `5 位受邀好友已完成注册并完成订单，${formatINR(bonusAmount)} 已发放至您的钱包！`,
            timestamp: now,
            read: false,
            kind: 'payout',
          };

          return {
            ...prev,
            referrals: mergedList,
            walletBalance: roundCurrency(prev.walletBalance + bonusAmount),
            totalCashbackEarned: roundCurrency(
              prev.totalCashbackEarned + bonusAmount
            ),
            referralBonusEarned: roundCurrency(
              prev.referralBonusEarned + bonusAmount
            ),
            referralMilestonesPaid: totalMilestonesEarned,
            transactions: [tx, ...prev.transactions],
            notifications: [notif, ...prev.notifications],
          };
        }

        return {
          ...prev,
          referrals: mergedList,
        };
      });
    } catch {
      // Ignore network errors cleanly
    }
  }, [isCloudUser]);

  const flushOutboxToServer = useCallback(async () => {
    if (isCloudUser) return;
    if (flushingOutboxPromiseRef.current) {
      await flushingOutboxPromiseRef.current;
      return;
    }

    const run = (async () => {
      const snapshot = readSyncOutbox();
      const hasWork =
        snapshot.accountRestores.length > 0 ||
        snapshot.withdrawals.length > 0 ||
        snapshot.orderSubmissions.length > 0 ||
        snapshot.userMessages.length > 0 ||
        snapshot.adminReplies.length > 0 ||
        snapshot.withdrawalDecisions.length > 0 ||
        snapshot.orderDecisions.length > 0 ||
        snapshot.adminOrders.length > 0 ||
        snapshot.removedOrderIds.length > 0 ||
        snapshot.referralCompletions.length > 0;
      if (!hasWork) return;

      try {
        const currentMobile = stateRef.current.authAccount?.mobileNumber || '';
        const currentUid =
          stateRef.current.authAccount?.userId || stateRef.current.profile.userId;
        const isAdm = isAdminMobile(currentMobile);

        for (const ar of snapshot.accountRestores) {
          const res = await safeFetchJson<{ ok?: boolean; account?: AuthAccount }>(
            '/api/auth/restore',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(ar),
            }
          );
          if (res.available && (res.ok || (res.status >= 400 && res.status < 500))) {
            updateSyncOutbox((ob) => ({
              ...ob,
              accountRestores: ob.accountRestores.filter(
                (x) =>
                  x.userId !== ar.userId &&
                  normalizeIndianMobile(x.mobileNumber) !==
                    normalizeIndianMobile(ar.mobileNumber)
              ),
            }));
          }
        }

        for (const w of snapshot.withdrawals) {
          const res = await safeFetchJson<{ ok?: boolean }>('/api/withdrawals', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(w),
          });
          if (res.available && (res.ok || (res.status >= 400 && res.status < 500))) {
            updateSyncOutbox((ob) => ({
              ...ob,
              withdrawals: ob.withdrawals.filter((x) => x.id !== w.id),
            }));
          }
        }

        for (const sub of snapshot.orderSubmissions) {
          const res = await safeFetchJson<{ ok?: boolean }>('/api/order-submissions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sub),
          });
          if (res.available && (res.ok || (res.status >= 400 && res.status < 500))) {
            updateSyncOutbox((ob) => ({
              ...ob,
              orderSubmissions: ob.orderSubmissions.filter((x) => x.id !== sub.id),
            }));
          }
        }

        for (const msg of snapshot.userMessages) {
          const res = await safeFetchJson<{ ok?: boolean; message?: ChatMessage }>(
            '/api/messages',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(msg),
            }
          );
          if (res.available && (res.ok || (res.status >= 400 && res.status < 500))) {
            updateSyncOutbox((ob) => ({
              ...ob,
              userMessages: ob.userMessages.filter((x) => x.id !== msg.id),
            }));
            if (res.ok && res.data.message) {
              const confirmedMsg = res.data.message;
              setUserMessages((prev) =>
                prev.map((m) => (m.id === confirmedMsg.id ? confirmedMsg : m))
              );
            }
          }
        }

        for (const rc of snapshot.referralCompletions) {
          const res = await safeFetchJson<{ ok?: boolean }>('/api/referrals/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(rc),
          });
          if (res.available && (res.ok || (res.status >= 400 && res.status < 500))) {
            updateSyncOutbox((ob) => ({
              ...ob,
              referralCompletions: ob.referralCompletions.filter(
                (x) => x.inviteeId !== rc.inviteeId
              ),
            }));
          }
        }

        if (isAdm) {
          for (const ao of snapshot.adminOrders) {
            const res = await safeFetchJson<{ ok?: boolean }>('/api/orders', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-admin-mobile': currentMobile,
              },
              body: JSON.stringify(ao),
            });
            if (res.available && (res.ok || (res.status >= 400 && res.status < 500))) {
              updateSyncOutbox((ob) => ({
                ...ob,
                adminOrders: ob.adminOrders.filter((x) => x.id !== ao.id),
              }));
            }
          }

          for (const remId of snapshot.removedOrderIds) {
            const res = await safeFetchJson<{ ok?: boolean }>(
              `/api/orders/${encodeURIComponent(remId)}`,
              {
                method: 'DELETE',
                headers: {
                  'x-admin-mobile': currentMobile,
                },
              }
            );
            if (res.available && (res.ok || (res.status >= 400 && res.status < 500))) {
              updateSyncOutbox((ob) => ({
                ...ob,
                removedOrderIds: ob.removedOrderIds.filter((x) => x !== remId),
              }));
            }
          }

          for (const rep of snapshot.adminReplies) {
            const res = await safeFetchJson<{ ok?: boolean; message?: ChatMessage }>(
              `/api/admin/messages/${encodeURIComponent(rep.targetUserId)}/reply`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-admin-mobile': currentMobile,
                },
                body: JSON.stringify({
                  id: rep.id,
                  text: rep.text,
                  createdAt: rep.createdAt,
                  ...(rep.imageData ? { imageData: rep.imageData } : {}),
                }),
              }
            );
            if (res.available && (res.ok || (res.status >= 400 && res.status < 500))) {
              updateSyncOutbox((ob) => ({
                ...ob,
                adminReplies: ob.adminReplies.filter((x) => x.id !== rep.id),
              }));
            }
          }

          const cachedWdrs = [
            ...stateRef.current.withdrawRequests,
            ...readCachedWithdrawals('admin'),
            ...getFallbackWithdrawals(currentUid, true),
          ];
          for (const wd of snapshot.withdrawalDecisions) {
            const wSnap = cachedWdrs.find((w) => w.id === wd.id);
            const res = await safeFetchJson<{ ok?: boolean }>(
              `/api/withdrawals/${encodeURIComponent(wd.id)}/status`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-admin-mobile': currentMobile,
                },
                body: JSON.stringify({
                  status: wd.status,
                  ...(wSnap ? { withdrawal: wSnap } : {}),
                }),
              }
            );
            if (
              res.available &&
              (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 404))
            ) {
              updateSyncOutbox((ob) => ({
                ...ob,
                withdrawalDecisions: ob.withdrawalDecisions.filter((x) => x.id !== wd.id),
              }));
            }
          }

          const cachedSubs = readCachedAdminSubmissions();
          const fbSubs = getFallbackOrderSubmissions();
          for (const od of snapshot.orderDecisions) {
            const orderMatch = stateRef.current.adminOrders.find(
              (o) => o.id === od.id || o.submissionId === od.id
            );
            const subSnap =
              cachedSubs.find((s) => s.id === od.id || s.orderId === od.id) ||
              fbSubs.find((s) => s.id === od.id || s.orderId === od.id) ||
              (orderMatch?.userUid
                ? {
                    id: orderMatch.submissionId || orderMatch.id,
                    orderId: orderMatch.id,
                    orderCode: orderMatch.orderCode,
                    userUid: orderMatch.userUid,
                    userName: orderMatch.userName || 'User',
                    userMobile: orderMatch.userMobile,
                    amount: orderMatch.amount,
                    paymentLink: orderMatch.paymentLink,
                    utrRef: orderMatch.utrRef || 'UTR-PENDING',
                    referredBy: orderMatch.referredBy ?? null,
                    paidAt: orderMatch.paidAt || orderMatch.createdAt,
                    createdAt: orderMatch.createdAt,
                  }
                : undefined);

            const res = await safeFetchJson<{ ok?: boolean }>(
              `/api/admin/order-submissions/${encodeURIComponent(od.id)}/status`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-admin-mobile': currentMobile,
                },
                body: JSON.stringify({
                  status: od.status,
                  ...(subSnap ? { submission: subSnap } : {}),
                }),
              }
            );
            if (
              res.available &&
              (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 404))
            ) {
              updateSyncOutbox((ob) => ({
                ...ob,
                orderDecisions: ob.orderDecisions.filter((x) => x.id !== od.id),
              }));
            }
          }
        }
      } catch {
        // keep remaining items in outbox for retry
      } finally {
        flushingOutboxPromiseRef.current = null;
      }
    })();

    flushingOutboxPromiseRef.current = run;
    await run;
  }, [isCloudUser]);

  const syncWithdrawalsFromServer = useCallback(async () => {
    try {
      await flushOutboxToServer();
      const currentMobile = stateRef.current.authAccount?.mobileNumber || '';
      const currentUserId =
        stateRef.current.authAccount?.userId || stateRef.current.profile.userId;
      const isAdm = isAdminMobile(currentMobile);
      const scopeKey = isAdm ? 'admin' : currentUserId;
      const res = await safeFetchJson<{ withdrawals?: WithdrawRequest[] }>(
        `/api/withdrawals?userId=${encodeURIComponent(currentUserId)}`,
        {
          headers: currentMobile ? { 'x-admin-mobile': currentMobile } : {},
        }
      );
      const fbWithdrawals = getFallbackWithdrawals(currentUserId, isAdm);
      const cachedWithdrawals = readCachedWithdrawals(scopeKey);
      const serverList =
        res.available && res.ok && Array.isArray(res.data.withdrawals)
          ? res.data.withdrawals
          : [];
      if (!res.available && fbWithdrawals.length === 0 && cachedWithdrawals.length === 0) {
        return;
      }

      const outboxWithdrawals = readSyncOutbox().withdrawals.filter(
        (w) => isAdm || w.userId === currentUserId || w.agentId === currentUserId
      );
      const nowMs = Date.now();

      setState((prev) => {
        const myUserId = prev.authAccount?.userId || prev.profile.userId;
        const mergedMap = new Map<string, WithdrawRequest>();

        const addIfAllowed = (w: WithdrawRequest) => {
          if (!w?.id) return;
          if (!isAdm && w.userId !== myUserId && w.agentId !== myUserId) return;
          const existing = mergedMap.get(w.id);
          if (!existing) {
            mergedMap.set(w.id, w);
          } else if (existing.status === 'Pending' && w.status !== 'Pending') {
            mergedMap.set(w.id, { ...existing, ...w });
          }
        };

        for (const w of cachedWithdrawals) addIfAllowed(w);
        for (const w of prev.withdrawRequests) addIfAllowed(w);
        for (const w of fbWithdrawals) addIfAllowed(w);

        // Overlay authoritative server withdrawals while keeping active decisions sticky
        for (const w of serverList) {
          if (!isAdm && w.userId !== myUserId && w.agentId !== myUserId) continue;
          const prevItem = mergedMap.get(w.id);
          const decision = pendingWithdrawalDecisionRef.current.get(w.id);
          if (decision && (decision.status === w.status || decision.expiresAt <= nowMs)) {
            pendingWithdrawalDecisionRef.current.delete(w.id);
          }
          let effectiveStatus = w.status;
          if (decision && decision.expiresAt > nowMs && decision.status !== w.status) {
            effectiveStatus = decision.status;
          } else if (w.status === 'Pending' && prevItem && prevItem.status !== 'Pending') {
            effectiveStatus = prevItem.status;
          }
          mergedMap.set(w.id, {
            ...w,
            status: effectiveStatus,
            processedAt: w.processedAt || prevItem?.processedAt,
          });
        }
        // Ensure any unconfirmed outbox withdrawals stay visible
        for (const w of outboxWithdrawals) {
          if (!mergedMap.has(w.id)) {
            mergedMap.set(w.id, w);
          }
        }

        const mergedList = Array.from(mergedMap.values()).sort((a, b) =>
          String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
        );
        writeCachedWithdrawals(scopeKey, mergedList);

        let nextBalance = prev.walletBalance;
        let nextTotalWithdrawal = prev.totalWithdrawal;
        let txUpdated = false;
        const extraNotifs: AppNotification[] = [];

        const nextTransactions = prev.transactions.map((tx) => {
          if (tx.type !== 'withdrawal' || tx.status !== 'Pending') return tx;
          const matched = mergedList.find(
            (w) => w.txId === tx.id && w.userId === myUserId
          );
          if (!matched || matched.status === 'Pending') return tx;

          txUpdated = true;
          if (matched.status === 'Rejected') {
            nextBalance = roundCurrency(nextBalance + matched.amount);
            nextTotalWithdrawal = Math.max(
              0,
              roundCurrency(nextTotalWithdrawal - matched.amount)
            );
            extraNotifs.push({
              id: makeDocId('notif'),
              title: 'Withdrawal Rejected · Refunded',
              titleZh: '提现已拒绝 · 余额已退回',
              message: `${formatINR(matched.amount)} withdrawal to ${matched.accountDetailSummary} was rejected and refunded.`,
              messageZh: `向 ${matched.accountDetailSummary} 提现 ${formatINR(matched.amount)} 已被拒绝，金额已退回钱包。`,
              timestamp: matched.processedAt || formatTimestamp(),
              read: false,
              kind: 'withdrawal',
            });
          } else if (matched.status === 'Success') {
            extraNotifs.push({
              id: makeDocId('notif'),
              title: 'Withdrawal Approved & Paid',
              titleZh: '提现已审核通过并打款',
              message: `${formatINR(matched.amount)} withdrawal to ${matched.accountDetailSummary} was approved.`,
              messageZh: `向 ${matched.accountDetailSummary} 提现 ${formatINR(matched.amount)} 已审核通过并打款。`,
              timestamp: matched.processedAt || formatTimestamp(),
              read: false,
              kind: 'withdrawal',
            });
          }

          return {
            ...tx,
            status: matched.status,
          };
        });

        const listSame =
          prev.withdrawRequests.length === mergedList.length &&
          prev.withdrawRequests.every(
            (p, idx) =>
              p.id === mergedList[idx]?.id &&
              p.status === mergedList[idx]?.status &&
              p.processedAt === mergedList[idx]?.processedAt
          );
        if (listSame && !txUpdated && extraNotifs.length === 0) {
          return prev;
        }

        return {
          ...prev,
          walletBalance: nextBalance,
          totalWithdrawal: nextTotalWithdrawal,
          withdrawRequests: mergedList,
          transactions: txUpdated ? nextTransactions : prev.transactions,
          notifications:
            extraNotifs.length > 0
              ? [...extraNotifs, ...prev.notifications]
              : prev.notifications,
        };
      });
    } catch {
      // Ignore network errors cleanly
    }
  }, [flushOutboxToServer]);

  const syncAdminUsersFromServer = useCallback(async () => {
    const currentMobile = stateRef.current.authAccount?.mobileNumber || '';
    if (!isAdminMobile(currentMobile)) {
      setAdminUsers([]);
      return;
    }
    try {
      const [res, fbUsers] = await Promise.all([
        safeFetchJson<{ users?: AdminUserRecord[] }>('/api/admin/users', {
          headers: { 'x-admin-mobile': currentMobile },
        }),
        getFallbackAdminUsers(),
      ]);

      const serverUsers =
        res.available && res.ok && Array.isArray(res.data.users)
          ? res.data.users
          : null;
      const cachedUsers = readCachedAdminUsers();

      // If server is online and local fallback holds accounts missing on server (or missing password), sync them to server
      if (serverUsers && fbUsers.length > 0) {
        const srvByMob = new Map<string, AdminUserRecord>();
        const srvByUid = new Map<string, AdminUserRecord>();
        for (const su of serverUsers) {
          if (!su || su.userId === '415061' || su.userId === '882836') continue;
          const m = normalizeIndianMobile(su.mobileNumber);
          if (m.length === 10) srvByMob.set(m, su);
          if (su.userId) srvByUid.set(su.userId, su);
        }

        const missingOrIncomplete = fbUsers.filter((fu) => {
          if (!fu || fu.userId === '415061' || fu.userId === '882836') return false;
          const m = normalizeIndianMobile(fu.mobileNumber);
          if (m.length !== 10) return false;
          const srvMatch = srvByMob.get(m) || srvByUid.get(fu.userId);
          if (!srvMatch) return true;
          return Boolean(fu.password && !srvMatch.password);
        });

        if (missingOrIncomplete.length > 0) {
          const sig = missingOrIncomplete
            .map((u) => `${u.userId}:${normalizeIndianMobile(u.mobileNumber)}:${u.password ? 1 : 0}`)
            .sort()
            .join('|');
          if (syncedAdminLocalUsersSigRef.current !== sig) {
            syncedAdminLocalUsersSigRef.current = sig;
            const syncPayload = missingOrIncomplete.map((u) => ({
              ...u,
              wallet: getFallbackWallet(u.userId, u.mobileNumber),
            }));
            void safeFetchJson('/api/admin/users/sync', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-admin-mobile': currentMobile,
              },
              body: JSON.stringify({ users: syncPayload }),
            });
          }
        }
      }

      const nowMs = Date.now();
      const isGenericName = (name: string): boolean => {
        const trimmed = name.trim();
        return !trimmed || trimmed === 'User' || /^User_\d{2}$/i.test(trimmed) || trimmed === 'User_73';
      };

      setAdminUsers((prev) => {
        const byKey = new Map<string, AdminUserRecord>();
        const mobToKey = new Map<string, string>();
        const uidToKey = new Map<string, string>();

        const mergeSourceList = (list: AdminUserRecord[], sourceIsServer: boolean) => {
          for (const raw of list) {
            if (!raw || !raw.userId || raw.userId === '415061') continue;
            const normMob = normalizeIndianMobile(raw.mobileNumber);
            const validMob = normMob.length === 10 ? normMob : '';
            if (raw.userId === '882836' && isAdminMobile(validMob)) {
              // Skip legacy dummy seed if we already have or will receive real Admin record
              const hasRealAdmin =
                Array.from(mobToKey.keys()).some((m) => isAdminMobile(m)) ||
                list.some(
                  (x) => x.userId !== '882836' && isAdminMobile(x.mobileNumber)
                );
              if (hasRealAdmin) continue;
            }

            const existingKey =
              (validMob ? mobToKey.get(validMob) : undefined) || uidToKey.get(raw.userId);
            const key = existingKey || (validMob ? `mob:${validMob}` : `uid:${raw.userId}`);
            const old = byKey.get(key);

            const override = passwordResetOverrideRef.current.get(raw.userId);
            const activeResetPass =
              override && override.expiresAt > nowMs ? override.password : undefined;
            if (override && override.expiresAt <= nowMs) {
              passwordResetOverrideRef.current.delete(raw.userId);
            }

            const fallbackPass =
              getFallbackAccountPassword(raw.userId) ||
              (validMob ? getFallbackAccountPassword(validMob) : undefined);

            if (!old) {
              const pwd = activeResetPass || raw.password || fallbackPass;
              const entry: AdminUserRecord = {
                ...raw,
                mobileNumber: validMob || raw.mobileNumber,
                hasPassword: Boolean(raw.hasPassword || pwd),
                ...(pwd ? { password: pwd } : {}),
                walletBalance: Math.max(raw.walletBalance || 0, 0),
                totalPaid: Math.max(raw.totalPaid || 0, 0),
                totalWithdrawal: Math.max(raw.totalWithdrawal || 0, 0),
              };
              byKey.set(key, entry);
              uidToKey.set(entry.userId, key);
              if (validMob) mobToKey.set(validMob, key);
              continue;
            }

            const preferNewId =
              (old.userId === '882836' && raw.userId !== '882836') ||
              (sourceIsServer && raw.userId !== '882836' && old.userId.startsWith('mobile_'));
            const chosenUserId = preferNewId ? raw.userId : old.userId;

            const chosenPassword =
              activeResetPass ||
              (sourceIsServer
                ? raw.password || old.password || fallbackPass
                : old.password || raw.password || fallbackPass);

            const oldActivity =
              (old.walletBalance || 0) + (old.totalPaid || 0) + (old.totalWithdrawal || 0);
            const rawActivity =
              (raw.walletBalance || 0) + (raw.totalPaid || 0) + (raw.totalWithdrawal || 0);
            const useRawWallet = sourceIsServer
              ? rawActivity > 0 || Boolean(raw.linkedAppName) || oldActivity === 0
              : rawActivity > oldActivity;

            const chosenUsername = !isGenericName(old.username)
              ? old.username
              : !isGenericName(raw.username)
              ? raw.username
              : raw.username || old.username;

            const mergedEntry: AdminUserRecord = {
              userId: chosenUserId,
              mobileNumber: validMob || old.mobileNumber || raw.mobileNumber,
              username: chosenUsername,
              hasPassword: Boolean(old.hasPassword || raw.hasPassword || chosenPassword),
              ...(chosenPassword ? { password: chosenPassword } : {}),
              referralCode:
                preferNewId || old.referralCode.startsWith('AUREX-mobile_')
                  ? raw.referralCode || `AUREX-${chosenUserId}`
                  : old.referralCode || raw.referralCode || `AUREX-${chosenUserId}`,
              referredBy: old.referredBy || raw.referredBy || null,
              createdAt: old.createdAt || raw.createdAt,
              walletBalance: Math.max(
                useRawWallet ? raw.walletBalance || 0 : old.walletBalance || 0,
                0
              ),
              totalPaid: Math.max(useRawWallet ? raw.totalPaid || 0 : old.totalPaid || 0, 0),
              totalWithdrawal: Math.max(
                useRawWallet ? raw.totalWithdrawal || 0 : old.totalWithdrawal || 0,
                0
              ),
              linkedAppName: raw.linkedAppName || old.linkedAppName,
              upiId: raw.upiId || old.upiId,
            };

            byKey.set(key, mergedEntry);
            uidToKey.set(raw.userId, key);
            uidToKey.set(mergedEntry.userId, key);
            if (validMob) mobToKey.set(validMob, key);
          }
        };

        // Monotonic merge order: cache -> current UI state -> local device fallback -> live server
        mergeSourceList(cachedUsers, false);
        mergeSourceList(prev, false);
        mergeSourceList(fbUsers, false);
        if (serverUsers) {
          mergeSourceList(serverUsers, true);
        }

        const mergedList = Array.from(byKey.values());
        if (mergedList.length > 0) {
          writeCachedAdminUsers(mergedList);
        }

        if (
          prev.length === mergedList.length &&
          prev.every(
            (p, idx) =>
              p.userId === mergedList[idx]?.userId &&
              p.username === mergedList[idx]?.username &&
              p.mobileNumber === mergedList[idx]?.mobileNumber &&
              p.password === mergedList[idx]?.password &&
              p.referralCode === mergedList[idx]?.referralCode &&
              p.walletBalance === mergedList[idx]?.walletBalance &&
              p.totalPaid === mergedList[idx]?.totalPaid &&
              p.totalWithdrawal === mergedList[idx]?.totalWithdrawal &&
              p.referredBy === mergedList[idx]?.referredBy &&
              p.linkedAppName === mergedList[idx]?.linkedAppName
          )
        ) {
          return prev;
        }
        return mergedList;
      });
    } catch {
      // Ignore network errors cleanly
    }
  }, []);

  const resetUserPassword = useCallback(
    async (
      userId: string,
      newPassword: string
    ): Promise<{ ok: boolean; error?: string }> => {
      const currentMobile = stateRef.current.authAccount?.mobileNumber || '';
      if (!isAdminMobile(currentMobile)) {
        return { ok: false, error: t.errAuthGeneric };
      }
      if (newPassword.length < 6) {
        return { ok: false, error: t.errAuthPassword };
      }
      try {
        const res = await safeFetchJson<{ ok?: boolean }>(
          `/api/admin/users/${encodeURIComponent(userId)}/reset-password`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-admin-mobile': currentMobile,
            },
            body: JSON.stringify({ newPassword }),
          }
        );
        if (!res.available) {
          const updated = await resetFallbackUserPassword(userId, newPassword);
          if (!updated) return { ok: false, error: t.errAuthGeneric };
        } else if (!res.ok) {
          return { ok: false, error: t.errAuthGeneric };
        } else {
          await resetFallbackUserPassword(userId, newPassword);
        }

        passwordResetOverrideRef.current.set(userId, {
          password: newPassword,
          expiresAt: Date.now() + 30000,
        });
        setAdminUsers((prev) => {
          const next = prev.map((u) =>
            u.userId === userId ? { ...u, hasPassword: true, password: newPassword } : u
          );
          writeCachedAdminUsers(next);
          return next;
        });

        await syncAdminUsersFromServer();
        return { ok: true };
      } catch {
        return { ok: false, error: t.errAuthGeneric };
      }
    },
    [syncAdminUsersFromServer, t.errAuthGeneric, t.errAuthPassword]
  );

  const syncUserMessagesFromServer = useCallback(async (markRead = false) => {
    const uid =
      stateRef.current.authAccount?.userId || stateRef.current.profile.userId;
    if (!uid) return;
    try {
      await flushOutboxToServer();
      const qs = markRead ? '?markRead=1' : '';
      const res = await safeFetchJson<{ messages?: ChatMessage[] }>(
        `/api/messages/${encodeURIComponent(uid)}${qs}`
      );
      const serverMsgs = !res.available
        ? getFallbackUserMessages(uid, markRead)
        : res.ok && Array.isArray(res.data.messages)
        ? res.data.messages
        : null;
      if (!serverMsgs) return;

      const outboxMsgs: ChatMessage[] = readSyncOutbox()
        .userMessages.filter((m) => m.userId === uid)
        .map((m) => ({
          id: m.id,
          userId: m.userId,
          username: m.username,
          mobileNumber: m.mobileNumber,
          sender: 'user' as const,
          text: m.text,
          ...(m.imageData ? { imageUrl: m.imageData } : {}),
          createdAt: m.createdAt,
          readByAdmin: false,
          readByUser: true,
        }));

      setUserMessages((prev) => {
        const merged = new Map<string, ChatMessage>();
        const cached = readCachedUserMessages(uid);
        for (const m of cached) {
          if (m.userId === uid) merged.set(m.id, m);
        }
        // Keep existing local messages for this user so a cold Lambda never wipes chat history
        for (const m of prev) {
          if (m.userId === uid) {
            merged.set(
              m.id,
              markRead && m.sender === 'agent' ? { ...m, readByUser: true } : m
            );
          }
        }
        for (const m of outboxMsgs) {
          if (!merged.has(m.id)) merged.set(m.id, m);
        }
        for (const m of serverMsgs) {
          const prevItem = merged.get(m.id);
          // Preserve inline data:image/ URL if we already hold it locally so images never break across Lambdas
          const preservedImg =
            prevItem?.imageUrl?.startsWith('data:image/') &&
            m.imageUrl &&
            !m.imageUrl.startsWith('data:image/')
              ? prevItem.imageUrl
              : m.imageUrl;
          merged.set(m.id, preservedImg ? { ...m, imageUrl: preservedImg } : m);
        }
        const nextList = Array.from(merged.values()).sort((a, b) =>
          String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
        );
        if (
          prev.length === nextList.length &&
          prev.every(
            (p, idx) =>
              p.id === nextList[idx].id &&
              p.readByUser === nextList[idx].readByUser &&
              p.imageUrl === nextList[idx].imageUrl &&
              p.text === nextList[idx].text
          )
        ) {
          return prev;
        }
        return nextList;
      });
    } catch {
      // Ignore network errors cleanly
    }
  }, [flushOutboxToServer]);

  const syncAdminMessagesFromServer = useCallback(async () => {
    const currentMobile = stateRef.current.authAccount?.mobileNumber || '';
    if (!isAdminMobile(currentMobile)) {
      setAdminChatThreads([]);
      return;
    }
    try {
      await flushOutboxToServer();
      const res = await safeFetchJson<{ threads?: AdminChatThread[] }>(
        '/api/admin/messages',
        {
          headers: { 'x-admin-mobile': currentMobile },
        }
      );
      const serverThreads = !res.available
        ? await getFallbackAdminThreads()
        : res.ok && Array.isArray(res.data.threads)
        ? res.data.threads
        : null;
      if (!serverThreads) return;

      const pendingReplies = readSyncOutbox().adminReplies;
      const nowMs = Date.now();

      setAdminChatThreads((prev) => {
        const baseList = prev.length > 0 ? prev : readCachedAdminThreads(currentMobile);
        const prevByUser = new Map<string, AdminChatThread>(
          baseList.map((th) => [th.userId, th])
        );
        const mergedThreads: AdminChatThread[] = serverThreads.map((srvTh) => {
          const prevTh = prevByUser.get(srvTh.userId);
          const msgMap = new Map<string, ChatMessage>();
          if (prevTh) {
            for (const m of prevTh.messages) {
              msgMap.set(m.id, m);
            }
          }
          for (const m of srvTh.messages) {
            const existing = msgMap.get(m.id);
            const preservedImg =
              existing?.imageUrl?.startsWith('data:image/') &&
              m.imageUrl &&
              !m.imageUrl.startsWith('data:image/')
                ? existing.imageUrl
                : m.imageUrl;
            msgMap.set(m.id, preservedImg ? { ...m, imageUrl: preservedImg } : m);
          }
          for (const rep of pendingReplies) {
            if (rep.targetUserId === srvTh.userId && !msgMap.has(rep.id)) {
              msgMap.set(rep.id, {
                id: rep.id,
                userId: srvTh.userId,
                username: srvTh.username,
                mobileNumber: srvTh.mobileNumber,
                sender: 'agent',
                text: rep.text,
                ...(rep.imageData ? { imageUrl: rep.imageData } : {}),
                createdAt: rep.createdAt,
                readByAdmin: true,
                readByUser: false,
              });
            }
          }
          const messages = Array.from(msgMap.values()).sort((a, b) =>
            String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
          );
          const last = messages[messages.length - 1];
          const readCooldownUntil = markReadCooldownRef.current.get(srvTh.userId) || 0;
          const unreadCount =
            readCooldownUntil > nowMs
              ? 0
              : Math.max(
                  srvTh.unreadCount,
                  messages.filter((m) => m.sender === 'user' && !m.readByAdmin).length
                );
          return {
            ...srvTh,
            unreadCount,
            messages,
            lastMessage: last
              ? last.text || (last.imageUrl ? '📷 Photo' : srvTh.lastMessage)
              : srvTh.lastMessage,
            lastTime: last ? last.createdAt : srvTh.lastTime,
          };
        });

        const seenUsers = new Set(mergedThreads.map((th) => th.userId));
        for (const prevTh of baseList) {
          if (!seenUsers.has(prevTh.userId) && prevTh.messages.length > 0) {
            mergedThreads.push(prevTh);
          }
        }

        const sorted = mergedThreads.sort((a, b) => {
          if (a.lastTime && b.lastTime) {
            return b.lastTime.localeCompare(a.lastTime);
          }
          if (a.lastTime) return -1;
          if (b.lastTime) return 1;
          return a.username.localeCompare(b.username);
        });

        if (
          prev.length === sorted.length &&
          prev.every((p, idx) => {
            const s = sorted[idx];
            return (
              p.userId === s.userId &&
              p.unreadCount === s.unreadCount &&
              p.messages.length === s.messages.length &&
              (p.messages[p.messages.length - 1]?.id || '') ===
                (s.messages[s.messages.length - 1]?.id || '') &&
              p.messages.every(
                (m, mi) =>
                  m.imageUrl === s.messages[mi]?.imageUrl &&
                  m.text === s.messages[mi]?.text &&
                  m.readByAdmin === s.messages[mi]?.readByAdmin
              )
            );
          })
        ) {
          return prev;
        }
        return sorted;
      });
    } catch {
      // Ignore network errors cleanly
    }
  }, [flushOutboxToServer]);

  const sendUserSupportMessage = useCallback(
    async (
      text: string,
      imageData?: string
    ): Promise<{ ok: boolean; error?: string }> => {
      const clean = text.trim();
      if (!clean && !imageData) return { ok: false };
      const uid =
        stateRef.current.authAccount?.userId || stateRef.current.profile.userId;
      const uname =
        stateRef.current.authAccount?.username || stateRef.current.profile.username;
      const umobile =
        stateRef.current.authAccount?.mobileNumber ||
        stateRef.current.profile.mobileNumber ||
        '';
      const msgId = makeDocId('msg');
      const createdAt = formatTimestamp();

      const optimisticMsg: ChatMessage = {
        id: msgId,
        userId: uid,
        username: uname,
        mobileNumber: umobile || '—',
        sender: 'user',
        text: clean,
        ...(imageData ? { imageUrl: imageData } : {}),
        createdAt,
        readByAdmin: false,
        readByUser: true,
      };

      setUserMessages((prev) =>
        prev.some((m) => m.id === msgId) ? prev : [...prev, optimisticMsg]
      );

      const outboxEntry: OutboxUserMessage = {
        id: msgId,
        userId: uid,
        username: uname,
        mobileNumber: umobile,
        text: clean,
        createdAt,
        ...(imageData ? { imageData } : {}),
      };
      updateSyncOutbox((ob) => ({
        ...ob,
        userMessages: [...ob.userMessages.filter((x) => x.id !== msgId), outboxEntry],
      }));

      try {
        const res = await safeFetchJson<{ message?: ChatMessage }>(
          '/api/messages',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(outboxEntry),
          }
        );
        if (!res.available) {
          const fbMsg = sendFallbackUserMessage(outboxEntry);
          setUserMessages((prev) =>
            prev.map((m) => (m.id === msgId ? fbMsg : m))
          );
          updateSyncOutbox((ob) => ({
            ...ob,
            userMessages: ob.userMessages.filter((x) => x.id !== msgId),
          }));
          if (isAdminMobile(umobile)) {
            void syncAdminMessagesFromServer();
          }
          return { ok: true };
        }
        if (!res.ok) {
          if (res.status >= 400 && res.status < 500) {
            updateSyncOutbox((ob) => ({
              ...ob,
              userMessages: ob.userMessages.filter((x) => x.id !== msgId),
            }));
            setUserMessages((prev) => prev.filter((m) => m.id !== msgId));
            return { ok: false, error: t.invalidImageError };
          }
          // Transient 5xx -> keep optimistic message + outbox for auto-retry
          return { ok: true };
        }
        updateSyncOutbox((ob) => ({
          ...ob,
          userMessages: ob.userMessages.filter((x) => x.id !== msgId),
        }));
        if (res.data.message) {
          const serverMsg = res.data.message;
          setUserMessages((prev) =>
            prev.map((m) => (m.id === msgId ? serverMsg : m))
          );
        }
        if (isAdminMobile(umobile)) {
          void syncAdminMessagesFromServer();
        }
        return { ok: true };
      } catch {
        // Keep optimistic message + outbox entry so next sync retries automatically
        return { ok: true };
      }
    },
    [syncAdminMessagesFromServer, t.invalidImageError]
  );

  const sendAdminChatReply = useCallback(
    async (
      targetUserId: string,
      text: string,
      imageData?: string
    ): Promise<{ ok: boolean; error?: string }> => {
      const currentMobile = stateRef.current.authAccount?.mobileNumber || '';
      if (!isAdminMobile(currentMobile)) {
        return { ok: false, error: t.errAuthGeneric };
      }
      const clean = text.trim();
      if (!clean && !imageData) return { ok: false };

      const msgId = makeDocId('msg');
      const createdAt = formatTimestamp();
      const optimisticReply: ChatMessage = {
        id: msgId,
        userId: targetUserId,
        username: 'Admin',
        mobileNumber: currentMobile,
        sender: 'agent',
        text: clean,
        ...(imageData ? { imageUrl: imageData } : {}),
        createdAt,
        readByAdmin: true,
        readByUser: false,
      };

      setAdminChatThreads((prev) =>
        prev.map((th) =>
          th.userId === targetUserId
            ? {
                ...th,
                unreadCount: 0,
                lastMessage: clean || '📷 Photo',
                lastTime: createdAt,
                messages: th.messages.some((m) => m.id === msgId)
                  ? th.messages
                  : [...th.messages, optimisticReply],
              }
            : th
        )
      );

      const outboxReply: OutboxAdminReply = {
        id: msgId,
        targetUserId,
        text: clean,
        createdAt,
        ...(imageData ? { imageData } : {}),
      };
      updateSyncOutbox((ob) => ({
        ...ob,
        adminReplies: [...ob.adminReplies.filter((x) => x.id !== msgId), outboxReply],
      }));

      try {
        const res = await safeFetchJson<{ ok?: boolean; message?: ChatMessage }>(
          `/api/admin/messages/${encodeURIComponent(targetUserId)}/reply`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-admin-mobile': currentMobile,
            },
            body: JSON.stringify({
              id: msgId,
              text: clean,
              createdAt,
              ...(imageData ? { imageData } : {}),
            }),
          }
        );
        if (!res.available) {
          await sendFallbackAdminReply(targetUserId, clean, imageData, msgId, createdAt);
          updateSyncOutbox((ob) => ({
            ...ob,
            adminReplies: ob.adminReplies.filter((x) => x.id !== msgId),
          }));
          await syncAdminMessagesFromServer();
          if (
            targetUserId ===
            (stateRef.current.authAccount?.userId || stateRef.current.profile.userId)
          ) {
            void syncUserMessagesFromServer();
          }
          return { ok: true };
        }
        if (!res.ok) {
          if (res.status >= 400 && res.status < 500) {
            updateSyncOutbox((ob) => ({
              ...ob,
              adminReplies: ob.adminReplies.filter((x) => x.id !== msgId),
            }));
            return { ok: false, error: t.invalidImageError };
          }
          return { ok: true };
        }
        updateSyncOutbox((ob) => ({
          ...ob,
          adminReplies: ob.adminReplies.filter((x) => x.id !== msgId),
        }));
        if (res.data.message) {
          const confirmedMsg = res.data.message;
          setAdminChatThreads((prev) =>
            prev.map((th) =>
              th.userId === targetUserId
                ? {
                    ...th,
                    messages: th.messages.map((m) =>
                      m.id === msgId ? confirmedMsg : m
                    ),
                  }
                : th
            )
          );
        }
        if (
          targetUserId ===
          (stateRef.current.authAccount?.userId || stateRef.current.profile.userId)
        ) {
          void syncUserMessagesFromServer();
        }
        return { ok: true };
      } catch {
        return { ok: true };
      }
    },
    [syncAdminMessagesFromServer, syncUserMessagesFromServer, t.errAuthGeneric, t.invalidImageError]
  );

  const markAdminChatRead = useCallback(async (targetUserId: string) => {
    const currentMobile = stateRef.current.authAccount?.mobileNumber || '';
    if (!isAdminMobile(currentMobile) || !targetUserId) return;
    markReadCooldownRef.current.set(targetUserId, Date.now() + 8000);
    setAdminChatThreads((prev) =>
      prev.map((th) =>
        th.userId === targetUserId
          ? {
              ...th,
              unreadCount: 0,
              messages: th.messages.map((m) =>
                m.sender === 'user' && !m.readByAdmin
                  ? { ...m, readByAdmin: true }
                  : m
              ),
            }
          : th
      )
    );
    markFallbackAdminChatRead(targetUserId);
    void safeFetchJson(
      `/api/admin/messages/${encodeURIComponent(targetUserId)}/read`,
      {
        method: 'POST',
        headers: { 'x-admin-mobile': currentMobile },
      }
    );
  }, []);

  const syncSharedOrdersFromServer = useCallback(async () => {
    if (isCloudUser) return;
    try {
      await flushOutboxToServer();
      const res = await safeFetchJson<{ orders?: AdminOrder[] }>('/api/orders');
      const serverOrders =
        res.available && res.ok && Array.isArray(res.data.orders) ? res.data.orders : [];
      const normalizedOrders = serverOrders.map((o) => ({
        ...o,
        paymentLink:
          !o?.paymentLink ||
          o.paymentLink === 'bladepay://auto' ||
          o.paymentLink === 'silkpay://auto'
            ? DEFAULT_PAY_LINK
            : o.paymentLink,
      }));

      const currentMobile = stateRef.current.authAccount?.mobileNumber || '';
      const currentUid =
        stateRef.current.authAccount?.userId || stateRef.current.profile.userId;
      const isAdm = isAdminMobile(currentMobile);

      let adminSubmissions: CachedOrderSub[] = [];
      let userSubmissions: CachedOrderSub[] = [];

      if (isAdm) {
        const subRes = await safeFetchJson<{ submissions?: CachedOrderSub[] }>(
          '/api/admin/order-submissions',
          { headers: { 'x-admin-mobile': currentMobile } }
        );
        const serverSubs =
          subRes.available && subRes.ok && Array.isArray(subRes.data.submissions)
            ? subRes.data.submissions
            : [];
        const cachedSubs = readCachedAdminSubmissions();
        const fbSubs = getFallbackOrderSubmissions();
        const subMap = new Map<string, CachedOrderSub>();
        const ingestSub = (s: CachedOrderSub) => {
          if (!s?.id) return;
          const prevSub = subMap.get(s.id);
          if (!prevSub) {
            subMap.set(s.id, s);
          } else {
            const keepFinal =
              prevSub.status !== 'pending' && s.status === 'pending'
                ? prevSub.status
                : s.status;
            subMap.set(s.id, { ...prevSub, ...s, status: keepFinal });
          }
        };
        for (const s of cachedSubs) ingestSub(s);
        for (const s of fbSubs) ingestSub(s);
        for (const s of serverSubs) ingestSub(s);
        adminSubmissions = Array.from(subMap.values());
        writeCachedAdminSubmissions(adminSubmissions);
      } else if (currentUid) {
        const subRes = await safeFetchJson<{ submissions?: CachedOrderSub[] }>(
          `/api/order-submissions/user/${encodeURIComponent(currentUid)}`
        );
        const cachedUserSubs = readCachedUserSubmissions(currentUid);
        const fbUserSubs = getFallbackOrderSubmissions().filter(
          (s) => s.userUid === currentUid
        );
        const serverUserSubs =
          subRes.available && subRes.ok && Array.isArray(subRes.data.submissions)
            ? subRes.data.submissions
            : [];
        const userSubMap = new Map<string, CachedOrderSub>();
        const ingestUserSub = (s: CachedOrderSub) => {
          if (!s?.id) return;
          const prevS = userSubMap.get(s.id);
          if (!prevS) {
            userSubMap.set(s.id, s);
          } else {
            const keepFinal =
              prevS.status !== 'pending' && s.status === 'pending'
                ? prevS.status
                : s.status;
            userSubMap.set(s.id, { ...prevS, ...s, status: keepFinal });
          }
        };
        for (const s of cachedUserSubs) ingestUserSub(s);
        for (const s of fbUserSubs) ingestUserSub(s);
        for (const s of serverUserSubs) ingestUserSub(s);
        userSubmissions = Array.from(userSubMap.values());
        if (userSubmissions.length > 0) {
          writeCachedUserSubmissions(currentUid, userSubmissions);
        }
      }

      const currentOutbox = readSyncOutbox();
      const outboxSubs = currentOutbox.orderSubmissions;
      const outboxAdminOrderIds = new Set(currentOutbox.adminOrders.map((ao) => ao.id));
      const serverOrderIds = new Set(normalizedOrders.map((o) => o.id));

      setState((prev) => {
        let nextOrders = [...prev.adminOrders];
        let changed = false;

        // If Admin deleted an active template order on server, prune it cleanly across sessions
        if (res.available && res.ok) {
          const prunedOrders = nextOrders.filter((o) => {
            const isRemovableTemplate =
              o &&
              o.status === 'active' &&
              !o.userUid &&
              !o.submissionId &&
              o.id !== 'adm-ord-1000' &&
              !outboxAdminOrderIds.has(o.id);
            if (isRemovableTemplate && !serverOrderIds.has(o.id)) {
              return false;
            }
            return true;
          });
          if (prunedOrders.length !== nextOrders.length) {
            nextOrders = prunedOrders;
            changed = true;
          }
        }

        const existingIds = new Set(nextOrders.map((o) => o.id));
        const missingTemplates = normalizedOrders.filter(
          (o) => !existingIds.has(o.id) && !removedOrderIdsRef.current.has(o.id)
        );
        if (missingTemplates.length > 0) {
          nextOrders = [...missingTemplates, ...nextOrders];
          changed = true;
        }

        // Keep any outbox-queued submissions visible cleanly for both Admin and User
        const mergedAdminSubs: CachedOrderSub[] = isAdm
          ? [
              ...adminSubmissions,
              ...outboxSubs
                .filter((os) => !adminSubmissions.some((as) => as.id === os.id))
                .map((os) => ({ ...os, status: 'pending' as const })),
            ]
          : [];

        // Admin: merge cross-device user payment submissions
        const nowMs = Date.now();
        for (const sub of mergedAdminSubs) {
          const decision =
            pendingOrderDecisionRef.current.get(sub.id) ||
            pendingOrderDecisionRef.current.get(sub.orderId);
          if (decision && (decision.status === sub.status || decision.expiresAt <= nowMs)) {
            pendingOrderDecisionRef.current.delete(sub.id);
            pendingOrderDecisionRef.current.delete(sub.orderId);
          }
          const idx = nextOrders.findIndex(
            (o) => o.submissionId === sub.id || o.id === sub.id
          );
          const localPrev = idx >= 0 ? nextOrders[idx] : undefined;
          let effectiveStatus = sub.status;
          if (decision && decision.expiresAt > nowMs && decision.status !== sub.status) {
            effectiveStatus = decision.status;
          } else if (
            sub.status === 'pending' &&
            localPrev &&
            (localPrev.status === 'success' || localPrev.status === 'rejected')
          ) {
            effectiveStatus = localPrev.status;
          }

          if (idx === -1) {
            nextOrders.unshift({
              id: sub.id,
              submissionId: sub.id,
              userUid: sub.userUid,
              userName: sub.userName,
              userMobile: sub.userMobile,
              orderCode: sub.orderCode,
              amount: sub.amount,
              paymentLink: sub.paymentLink || DEFAULT_PAY_LINK,
              commissionRate: COMMISSION_RATE,
              createdAt: sub.createdAt,
              paidAt: sub.paidAt,
              utrRef: sub.utrRef,
              referredBy: sub.referredBy,
              status: effectiveStatus,
            });
            changed = true;
          } else if (nextOrders[idx].status !== effectiveStatus) {
            nextOrders[idx] = { ...nextOrders[idx], status: effectiveStatus };
            changed = true;
          }
        }

        // User: reflect Admin's remote approval/rejection AND cross-session pending submissions onto user's wallet & orders
        let walletBalance = prev.walletBalance;
        let totalPaid = prev.totalPaid;
        let totalCashbackEarned = prev.totalCashbackEarned;
        let completedOrdersCount = prev.completedOrdersCount;
        let nextTransactions = prev.transactions;
        let nextNotifications = prev.notifications;

        const mergedUserSubs: CachedOrderSub[] = !isAdm
          ? [
              ...userSubmissions,
              ...outboxSubs
                .filter(
                  (os) =>
                    os.userUid === currentUid &&
                    !userSubmissions.some((us) => us.id === os.id)
                )
                .map((os) => ({ ...os, status: 'pending' as const })),
            ]
          : [];

        for (const sub of mergedUserSubs) {
          let orderIdx = nextOrders.findIndex(
            (o) => o.submissionId === sub.id || o.id === sub.id
          );
          if (orderIdx === -1) {
            orderIdx = nextOrders.findIndex(
              (o) => o.id === sub.orderId && o.status === 'active'
            );
          }

          if (orderIdx === -1) {
            nextOrders.unshift({
              id: sub.id,
              submissionId: sub.id,
              userUid: sub.userUid,
              userName: sub.userName,
              userMobile: sub.userMobile,
              orderCode: sub.orderCode,
              amount: sub.amount,
              paymentLink: sub.paymentLink || DEFAULT_PAY_LINK,
              commissionRate: COMMISSION_RATE,
              createdAt: sub.createdAt,
              paidAt: sub.paidAt,
              utrRef: sub.utrRef,
              referredBy: sub.referredBy,
              status: sub.status,
            });
            orderIdx = 0;
            changed = true;
          }

          const target = nextOrders[orderIdx];
          const targetFinal = target.status === 'success' || target.status === 'rejected';
          const effectiveSubStatus =
            targetFinal && sub.status === 'pending' ? target.status : sub.status;
          if (target.status !== effectiveSubStatus) {
            nextOrders[orderIdx] = {
              ...target,
              submissionId: sub.id,
              utrRef: sub.utrRef || target.utrRef,
              paidAt: sub.paidAt || target.paidAt,
              status: effectiveSubStatus,
            };
            changed = true;
          } else if (!target.submissionId) {
            nextOrders[orderIdx] = { ...target, submissionId: sub.id };
            changed = true;
          }

          const alreadyFinalizedTx = nextTransactions.some(
            (tx) =>
              (tx.orderId === sub.id ||
                tx.orderId === target.id ||
                tx.orderId === sub.orderId) &&
              (tx.status === 'Success' || tx.status === 'Rejected')
          );

          if (effectiveSubStatus === 'success' && !alreadyFinalizedTx) {
            const { principal, commission, totalReturn } = calculateCommission(sub.amount);
            walletBalance = roundCurrency(walletBalance + totalReturn);
            totalPaid = roundCurrency(totalPaid + principal);
            totalCashbackEarned = roundCurrency(totalCashbackEarned + commission);
            completedOrdersCount += 1;
            let matchedPendingTx = false;
            nextTransactions = nextTransactions.map((tx) => {
              if (
                (tx.orderId === sub.id ||
                  tx.orderId === target.id ||
                  tx.orderId === sub.orderId) &&
                tx.status === 'Pending'
              ) {
                matchedPendingTx = true;
                return {
                  ...tx,
                  orderId: sub.id,
                  status: 'Success' as const,
                  title: 'Order Approved · +11% Payout',
                  titleZh: '订单已通过 · +11% 返现到账',
                  subtitle: `Paid ${formatINR(principal, false)} + 11% (${formatINR(commission, false)}) Credited`,
                  subtitleZh: `已付 ${formatINR(principal, false)} + 11% (${formatINR(commission, false)}) 已到账`,
                };
              }
              return tx;
            });
            if (!matchedPendingTx) {
              nextTransactions = [
                {
                  id: makeDocId('tx'),
                  orderId: sub.id,
                  type: 'order_payout',
                  title: 'Order Approved · +11% Payout',
                  titleZh: '订单已通过 · +11% 返现到账',
                  subtitle: `Paid ${formatINR(principal, false)} + 11% (${formatINR(commission, false)}) Credited`,
                  subtitleZh: `已付 ${formatINR(principal, false)} + 11% (${formatINR(commission, false)}) 已到账`,
                  amount: totalReturn,
                  paidAmount: principal,
                  commissionAmount: commission,
                  status: 'Success',
                  timestamp: sub.paidAt || sub.createdAt || formatTimestamp(),
                  referenceId: generateRefId('PAY'),
                },
                ...nextTransactions,
              ];
            }
            nextNotifications = [
              {
                id: makeDocId('notif'),
                title: `Order Approved · +${formatINR(totalReturn)} Credited`,
                titleZh: `订单已通过 · 已到账 +${formatINR(totalReturn)}`,
                message: `Order ${sub.orderCode} approved. Principal ${formatINR(principal, false)} + 11% (${formatINR(commission, false)}) added to wallet.`,
                messageZh: `订单 ${sub.orderCode} 已通过审核。本金 ${formatINR(principal, false)} + 11% 返现 (${formatINR(commission, false)}) 已存入钱包。`,
                timestamp: formatTimestamp(),
                read: false,
                kind: 'payout',
              },
              ...nextNotifications,
            ];
            changed = true;
          } else if (effectiveSubStatus === 'rejected' && !alreadyFinalizedTx) {
            nextTransactions = nextTransactions.map((tx) =>
              (tx.orderId === sub.id ||
                tx.orderId === target.id ||
                tx.orderId === sub.orderId) &&
              tx.status === 'Pending'
                ? {
                    ...tx,
                    orderId: sub.id,
                    status: 'Rejected',
                    title: `Order Rejected (${formatINR(sub.amount, false)})`,
                    titleZh: `订单已拒绝 (${formatINR(sub.amount, false)})`,
                    subtitle: 'Payment Rejected · No wallet payout',
                    subtitleZh: '订单已拒绝 · 未发放钱包收益',
                  }
                : tx
            );
            nextNotifications = [
              {
                id: makeDocId('notif'),
                title: `Order Rejected · ${sub.orderCode}`,
                titleZh: `订单已拒绝 · ${sub.orderCode}`,
                message: `Payment rejected for ${formatINR(sub.amount, false)}. No funds credited.`,
                messageZh: `${formatINR(sub.amount, false)} 的订单付款已被拒绝，未发放余额。`,
                timestamp: formatTimestamp(),
                read: false,
                kind: 'system',
              },
              ...nextNotifications,
            ];
            changed = true;
          }
        }

        // Guard against settled Success transactions ever leaving walletBalance below ledger floor
        const settledIn = nextTransactions.reduce((acc, tx) => {
          if (!tx || tx.status !== 'Success') return acc;
          if (tx.type === 'order_payout' || tx.type === 'daily_bonus' || tx.type === 'referral_bonus') {
            return acc + Number(tx.amount ?? 0);
          }
          return acc;
        }, 0);
        const wdrOut = prev.withdrawRequests.reduce(
          (acc, w) => (w && w.status !== 'Rejected' ? acc + Number(w.amount ?? 0) : acc),
          0
        );
        const ledgerFloor = Math.max(0, roundCurrency(settledIn - wdrOut));
        if (walletBalance < ledgerFloor) {
          walletBalance = ledgerFloor;
          changed = true;
        }

        if (!changed) return prev;
        return {
          ...prev,
          walletBalance,
          totalPaid,
          totalCashbackEarned,
          completedOrdersCount,
          adminOrders: nextOrders,
          transactions: nextTransactions,
          notifications: nextNotifications,
        };
      });
    } catch {
      // Ignore network errors cleanly
    }
  }, [flushOutboxToServer, isCloudUser]);

  const lastAuthRestoreAtRef = useRef<Record<string, number>>({});

  const syncAuthSessionFromServer = useCallback(async () => {
    if (isCloudUser) return;
    const curr = stateRef.current.authAccount;
    if (!curr) return;
    try {
      const qs = new URLSearchParams();
      if (curr.mobileNumber) qs.set('mobile', curr.mobileNumber);
      if (curr.userId) qs.set('userId', curr.userId);
      const res = await safeFetchJson<{
        ok?: boolean;
        error?: string;
        account?: AuthAccount;
      }>(`/api/auth/session?${qs.toString()}`);

      if (res.available && res.status === 404 && res.data?.error === 'SESSION_NOT_FOUND') {
        const nowMs = Date.now();
        const prevAttempt = lastAuthRestoreAtRef.current[curr.userId] || 0;
        if (nowMs - prevAttempt > 12000) {
          lastAuthRestoreAtRef.current[curr.userId] = nowMs;
          const storedPass =
            getFallbackAccountPassword(curr.userId) ||
            getFallbackAccountPassword(curr.mobileNumber);
          const restoreRes = await safeFetchJson<{
            ok?: boolean;
            account?: AuthAccount;
          }>('/api/auth/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: curr.userId,
              mobileNumber: normalizeIndianMobile(curr.mobileNumber) || curr.mobileNumber,
              username: curr.username,
              ...(storedPass ? { password: storedPass } : {}),
              referralCode: curr.referralCode,
              referredBy: curr.referredBy ?? stateRef.current.referredBy ?? null,
              createdAt: curr.createdAt,
              wallet: stateRef.current,
            }),
          });
          if (restoreRes.available && restoreRes.ok && restoreRes.data.account) {
            await mirrorVerifiedAccountToFallback(restoreRes.data.account, storedPass);
          }
        }
        return;
      }

      if (!res.available || !res.ok || !res.data.account) return;
      const nextAcc = res.data.account;
      setState((prev) => {
        if (!prev.authAccount) return prev;
        const sameRole = (prev.authAccount.role || 'user') === (nextAcc.role || 'user');
        const sameAgentId = (prev.authAccount.agentId || '') === (nextAcc.agentId || '');
        const sameRefCode = prev.authAccount.referralCode === nextAcc.referralCode;
        const sameRefBy = (prev.authAccount.referredBy || null) === (nextAcc.referredBy || null);
        if (sameRole && sameAgentId && sameRefCode && sameRefBy) return prev;
        return {
          ...prev,
          referredBy: nextAcc.referredBy ?? prev.referredBy,
          authAccount: {
            ...prev.authAccount,
            role: nextAcc.role,
            agentId: nextAcc.agentId,
            referralCode: nextAcc.referralCode,
            referredBy: nextAcc.referredBy ?? prev.authAccount.referredBy,
          },
        };
      });
    } catch {
      // Ignore network errors cleanly
    }
  }, [isCloudUser]);

  useEffect(() => {
    if (isCloudUser) return;
    const runAllSyncs = () => {
      if (!stateRef.current.authAccount) return;
      void flushOutboxToServer().then(() => {
        syncAuthSessionFromServer();
        syncReferralsFromServer();
        syncWithdrawalsFromServer();
        syncAdminUsersFromServer();
        syncUserMessagesFromServer();
        syncAdminMessagesFromServer();
        syncSharedOrdersFromServer();
      });
    };
    runAllSyncs();
    const interval = setInterval(runAllSyncs, 3500);
    const onFocus = () => runAllSyncs();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        runAllSyncs();
      }
    };
    const onOnline = () => runAllSyncs();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
    };
  }, [
    isCloudUser,
    state.authAccount?.userId,
    state.authAccount?.mobileNumber,
    flushOutboxToServer,
    syncAuthSessionFromServer,
    syncReferralsFromServer,
    syncWithdrawalsFromServer,
    syncAdminUsersFromServer,
    syncUserMessagesFromServer,
    syncAdminMessagesFromServer,
    syncSharedOrdersFromServer,
  ]);

  const linkPaymentApp = useCallback(
    (
      appId: string,
      appName: string,
      mobileNumber: string,
      pinCode: string
    ): { ok: boolean; error?: string } => {
      const cleanMobile = mobileNumber.replace(/\D/g, '');
      const cleanPin = pinCode.replace(/\D/g, '');
      if (cleanMobile.length !== 10) {
        return { ok: false, error: t.errInvalidMobile };
      }
      if (cleanPin.length < 4 || cleanPin.length > 6) {
        return { ok: false, error: t.errInvalidPin };
      }

      const now = formatTimestamp();
      const linked: LinkedPaymentApp = {
        appId,
        appName,
        mobileNumber: cleanMobile,
        linkedAt: now,
      };

      const notif: AppNotification = {
        id: makeDocId('notif'),
        title: `${appName} Connected`,
        titleZh: `${appName} 已绑定`,
        message: `Mobile ${cleanMobile} verified. Active orders are now unlocked on your Home screen.`,
        messageZh: `手机号 ${cleanMobile} 验证成功。订单已在首页解锁。`,
        timestamp: now,
        read: false,
        kind: 'system',
      };

      setState((prev) => ({
        ...prev,
        linkedPaymentApp: linked,
        profile: {
          ...prev.profile,
          upiId: `${cleanMobile}@${appId}`,
        },
        notifications: [notif, ...prev.notifications],
      }));

      if (isCloudUser && user) {
        const uid = user.uid;
        void (async () => {
          try {
            await updateDoc(doc(db, 'wallets', uid), {
              linkedAppId: appId.slice(0, 32),
              linkedAppName: appName.slice(0, 64),
              linkedAt: now,
              updatedAt: serverTimestamp(),
            });
            await updateDoc(doc(db, 'wallets', uid, 'private', 'info'), {
              mobileNumber: cleanMobile,
              upiId: `${cleanMobile}@${appId}`,
              updatedAt: serverTimestamp(),
            });
            await setDoc(doc(db, 'wallets', uid, 'notifications', notif.id), {
              uid,
              title: notif.title,
              titleZh: notif.titleZh,
              message: notif.message,
              messageZh: notif.messageZh,
              timestamp: now,
              read: false,
              kind: 'system',
              createdAt: serverTimestamp(),
            });
            if (stateRef.current.referredBy) {
              await ensureCloudReferralRegistered(
                user,
                stateRef.current.referredBy,
                stateRef.current.profile.username
              );
            }
          } catch (err) {
            handleFirestoreError(err, OperationType.UPDATE, `wallets/${uid}`);
          }
        })();
      } else {
        const refCode =
          stateRef.current.referredBy ||
          stateRef.current.authAccount?.referredBy ||
          readPendingRef();
        if (refCode) {
          const refPayload = {
            referrerCode: refCode,
            inviteeId:
              stateRef.current.authAccount?.userId || stateRef.current.profile.userId,
            inviteeName:
              stateRef.current.authAccount?.username || stateRef.current.profile.username,
          };
          registerFallbackReferral(refPayload);
          void safeFetchJson('/api/referrals/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(refPayload),
          }).then(() => {
            void syncReferralsFromServer();
          });
        }
      }

      return { ok: true };
    },
    [
      isCloudUser,
      user,
      ensureCloudReferralRegistered,
      syncReferralsFromServer,
      t.errInvalidMobile,
      t.errInvalidPin,
    ]
  );

  const unlinkPaymentApp = useCallback(() => {
    setState((prev) => ({
      ...prev,
      linkedPaymentApp: null,
    }));

    if (isCloudUser && user) {
      void updateDoc(doc(db, 'wallets', user.uid), {
        linkedAppId: deleteField(),
        linkedAppName: deleteField(),
        linkedAt: deleteField(),
        updatedAt: serverTimestamp(),
      }).catch((err) => {
        handleFirestoreError(
          err,
          OperationType.UPDATE,
          `wallets/${user.uid}`
        );
      });
    }
  }, [isCloudUser, user]);

  const addAdminOrder = useCallback(
    (
      amountInr: number,
      customLink?: string
    ): { ok: boolean; error?: string; order?: AdminOrder } => {
      const cleanAmount = roundCurrency(amountInr);
      if (!Number.isFinite(cleanAmount) || cleanAmount < 100) {
        return { ok: false, error: t.errMinOrder };
      }

      const rawLink = (customLink || '').trim();
      const linkToUse = !rawLink
        ? DEFAULT_PAY_LINK
        : /^https?:\/\/|^upi:\/\/|^sunpay:\/\//i.test(rawLink)
        ? rawLink
        : `https://${rawLink}`;

      const now = formatTimestamp();
      const orderId = makeDocId('adm-ord');
      const orderCode = `ORD-${Math.floor(1000 + Math.random() * 9000)}`;
      const newOrder: AdminOrder = {
        id: orderId,
        orderCode,
        amount: cleanAmount,
        paymentLink: linkToUse.slice(0, 500),
        commissionRate: COMMISSION_RATE,
        createdAt: now,
        status: 'active',
      };

      const notif: AppNotification = {
        id: makeDocId('notif'),
        title: `New Order: ${formatINR(cleanAmount, false)}`,
        titleZh: `新订单：${formatINR(cleanAmount, false)}`,
        message: `New ${formatINR(cleanAmount, false)} order available.`,
        messageZh: `新增一笔 ${formatINR(cleanAmount, false)} 的订单。`,
        timestamp: now,
        read: false,
        kind: 'system',
      };

      if (isCloudUser && user) {
        void (async () => {
          try {
            await setDoc(doc(db, 'admin_orders', orderId), {
              orderCode,
              amount: cleanAmount,
              paymentLink: linkToUse.slice(0, 500),
              commissionRate: COMMISSION_RATE,
              isActive: true,
              createdBy: user.uid,
              createdAt: serverTimestamp(),
            });
            await setDoc(
              doc(db, 'wallets', user.uid, 'notifications', notif.id),
              {
                uid: user.uid,
                title: notif.title,
                titleZh: notif.titleZh,
                message: notif.message,
                messageZh: notif.messageZh,
                timestamp: now,
                read: false,
                kind: 'system',
                createdAt: serverTimestamp(),
              }
            );
          } catch (err) {
            handleFirestoreError(
              err,
              OperationType.CREATE,
              `admin_orders/${orderId}`
            );
          }
        })();
      } else {
        setState((prev) => ({
          ...prev,
          defaultPaymentLink: linkToUse,
          adminOrders: [newOrder, ...prev.adminOrders],
          notifications: [notif, ...prev.notifications],
        }));

        const currentMobile = stateRef.current.authAccount?.mobileNumber || '';
        if (isAdminMobile(currentMobile)) {
          if (removedOrderIdsRef.current.has(newOrder.id)) {
            removedOrderIdsRef.current.delete(newOrder.id);
            writeRemovedOrderIds(Array.from(removedOrderIdsRef.current));
          }
          updateSyncOutbox((ob) => ({
            ...ob,
            removedOrderIds: ob.removedOrderIds.filter((x) => x !== newOrder.id),
            adminOrders: [
              ...ob.adminOrders.filter((x) => x.id !== newOrder.id),
              newOrder,
            ],
          }));
          void flushOutboxToServer().then(() => {
            void syncSharedOrdersFromServer();
          });
        }
      }

      return { ok: true, order: newOrder };
    },
    [isCloudUser, user, t.errMinOrder, flushOutboxToServer, syncSharedOrdersFromServer]
  );

  const removeAdminOrder = useCallback(
    (orderId: string) => {
      if (isCloudUser && user) {
        const isSubmission = submissionsRef.current.some(
          (s) => s.id === orderId
        );
        const colName = isSubmission ? 'order_submissions' : 'admin_orders';
        void deleteDoc(doc(db, colName, orderId)).catch((err) => {
          handleFirestoreError(
            err,
            OperationType.DELETE,
            `${colName}/${orderId}`
          );
        });
        return;
      }

      removedOrderIdsRef.current.add(orderId);
      writeRemovedOrderIds(Array.from(removedOrderIdsRef.current));
      setState((prev) => ({
        ...prev,
        adminOrders: prev.adminOrders.filter((o) => o.id !== orderId),
      }));

      const currentMobile = stateRef.current.authAccount?.mobileNumber || '';
      if (isAdminMobile(currentMobile)) {
        updateSyncOutbox((ob) => ({
          ...ob,
          adminOrders: ob.adminOrders.filter((x) => x.id !== orderId),
          removedOrderIds: [
            ...ob.removedOrderIds.filter((x) => x !== orderId),
            orderId,
          ],
        }));
        void flushOutboxToServer();
      }
    },
    [isCloudUser, user, flushOutboxToServer]
  );

  const updateDefaultPaymentLink = useCallback(
    (link: string): { ok: boolean; error?: string } => {
      const trimmed = link.trim();
      if (!trimmed) {
        return { ok: false, error: t.errEmptyLink };
      }
      setState((prev) => ({
        ...prev,
        defaultPaymentLink: trimmed,
      }));
      return { ok: true };
    },
    [t.errEmptyLink]
  );

  const submitOrderPayment = useCallback(
    (
      orderId: string,
      orderAmount: number,
      utrReference?: string
    ): {
      ok: boolean;
      error?: string;
      paidAmount?: number;
      cashback?: number;
      totalPayout?: number;
    } => {
      const {
        principal: paidAmount,
        commission: cashback,
        totalReturn: totalPayout,
      } = calculateCommission(orderAmount);

      if (!Number.isFinite(paidAmount) || paidAmount <= 0) {
        return { ok: false, error: t.errInvalidOrderAmt };
      }

      const now = formatTimestamp();
      const cleanUtr = (utrReference?.trim() || '').slice(0, 64);
      const refNote = cleanUtr
        ? `UTR ${cleanUtr} · Awaiting Approval`
        : `Paid ${formatINR(paidAmount, false)} · Awaiting Approval`;
      const refNoteZh = cleanUtr
        ? `UTR ${cleanUtr} · 等待审核`
        : `已付 ${formatINR(paidAmount, false)} · 等待审核`;

      const txId = makeDocId('tx');
      const notifId = makeDocId('notif');

      const tx: Transaction = {
        id: txId,
        orderId,
        type: 'order_payout',
        title: `Order Payment (${formatINR(paidAmount, false)})`,
        titleZh: `订单付款 (${formatINR(paidAmount, false)})`,
        subtitle: refNote,
        subtitleZh: refNoteZh,
        amount: totalPayout,
        paidAmount,
        commissionAmount: cashback,
        status: 'Pending',
        timestamp: now,
        referenceId: generateRefId('PAY'),
      };

      const notif: AppNotification = {
        id: notifId,
        title: 'Payment Submitted · Pending Approval',
        titleZh: '付款已提交 · 等待审核',
        message: `${formatINR(paidAmount)} payment submitted. Waiting for verification.`,
        messageZh: `已提交 ${formatINR(paidAmount)} 付款凭证，正在等待核验。`,
        timestamp: now,
        read: false,
        kind: 'system',
      };

      if (isCloudUser && user) {
        const targetTemplate = templatesRef.current.find(
          (o) => o.id === orderId
        );
        const subId = makeDocId('sub');
        const uid = user.uid;

        void (async () => {
          try {
            await setDoc(doc(db, 'order_submissions', subId), {
              orderId,
              orderCode: targetTemplate?.orderCode || 'ORD-1000',
              userUid: uid,
              userName: stateRef.current.profile.username.slice(0, 64) || 'User',
              amount: paidAmount,
              paymentLink: (
                targetTemplate?.paymentLink ||
                stateRef.current.defaultPaymentLink
              ).slice(0, 500),
              utrRef: cleanUtr.length >= 4 ? cleanUtr : 'UTR-PENDING',
              status: 'pending',
              paidAt: now,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });

            await setDoc(doc(db, 'wallets', uid, 'transactions', txId), {
              uid,
              orderId: subId,
              type: 'order_payout',
              title: tx.title,
              titleZh: tx.titleZh,
              subtitle: tx.subtitle,
              subtitleZh: tx.subtitleZh,
              amount: totalPayout,
              paidAmount,
              commissionAmount: cashback,
              status: 'Pending',
              timestamp: now,
              referenceId: tx.referenceId,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });

            await setDoc(doc(db, 'wallets', uid, 'notifications', notifId), {
              uid,
              title: notif.title,
              titleZh: notif.titleZh,
              message: notif.message,
              messageZh: notif.messageZh,
              timestamp: now,
              read: false,
              kind: 'system',
              createdAt: serverTimestamp(),
            });
          } catch (err) {
            handleFirestoreError(
              err,
              OperationType.CREATE,
              `order_submissions/${subId}`
            );
          }
        })();
      } else {
        const subId = makeDocId('sub');
        const currentUserId =
          stateRef.current.authAccount?.userId || stateRef.current.profile.userId;
        const currentUsername =
          stateRef.current.authAccount?.username || stateRef.current.profile.username;
        const currentUserMobile =
          stateRef.current.authAccount?.mobileNumber || stateRef.current.profile.mobileNumber;
        const currentReferredBy =
          stateRef.current.referredBy ||
          stateRef.current.authAccount?.referredBy ||
          readPendingRef() ||
          null;
        const matchedTemplate = stateRef.current.adminOrders.find((o) => o.id === orderId);
        const orderCode = matchedTemplate?.orderCode || 'ORD-1000';
        const paymentLink = matchedTemplate?.paymentLink || stateRef.current.defaultPaymentLink;
        const utrValue = cleanUtr || 'UTR-PENDING';

        setState((prev) => ({
          ...prev,
          adminOrders: prev.adminOrders.map((o) =>
            o.id === orderId
              ? {
                  ...o,
                  submissionId: subId,
                  status: 'pending',
                  paidAt: now,
                  utrRef: cleanUtr || undefined,
                  userUid: o.userUid || currentUserId,
                  userName: o.userName || currentUsername,
                  userMobile: o.userMobile || currentUserMobile,
                  referredBy: o.referredBy ?? currentReferredBy,
                }
              : o
          ),
          transactions: [tx, ...prev.transactions],
          notifications: [notif, ...prev.notifications],
        }));

        const submissionPayload: OutboxOrderSubmission = {
          id: subId,
          orderId,
          orderCode,
          userUid: currentUserId,
          userName: currentUsername,
          userMobile: currentUserMobile,
          amount: paidAmount,
          paymentLink,
          utrRef: utrValue,
          referredBy: currentReferredBy,
          paidAt: now,
          createdAt: now,
        };

        saveFallbackOrderSubmission({
          ...submissionPayload,
          status: 'pending',
        });

        updateSyncOutbox((ob) => ({
          ...ob,
          orderSubmissions: [
            ...ob.orderSubmissions.filter((x) => x.id !== subId),
            submissionPayload,
          ],
        }));
        void flushOutboxToServer().then(() => {
          void syncSharedOrdersFromServer();
        });
      }

      return {
        ok: true,
        paidAmount,
        cashback,
        totalPayout,
      };
    },
    [isCloudUser, user, t.errInvalidOrderAmt]
  );

  const approvePendingOrder = useCallback(
    (orderOrSubmissionId: string) => {
      if (isCloudUser && user) {
        const targetSub = submissionsRef.current.find(
          (s) => s.id === orderOrSubmissionId && s.status === 'pending'
        );
        if (!targetSub) return;

        const { principal, commission, totalReturn } = calculateCommission(
          targetSub.amount
        );
        const now = formatTimestamp();
        const targetUid = targetSub.userUid;

        void (async () => {
          try {
            // 1. Mark submission approved
            await updateDoc(doc(db, 'order_submissions', targetSub.id), {
              status: 'success',
              updatedAt: serverTimestamp(),
            });

            // 2. Credit target user's wallet
            const targetWalletRef = doc(db, 'wallets', targetUid);
            const walletSnap = await getDoc(targetWalletRef);
            if (walletSnap.exists()) {
              const wd = walletSnap.data();
              await updateDoc(targetWalletRef, {
                walletBalance: roundCurrency(
                  Number(wd.walletBalance ?? 0) + totalReturn
                ),
                totalPaid: roundCurrency(
                  Number(wd.totalPaid ?? 0) + principal
                ),
                totalCashbackEarned: roundCurrency(
                  Number(wd.totalCashbackEarned ?? 0) + commission
                ),
                completedOrdersCount: Number(wd.completedOrdersCount ?? 0) + 1,
                updatedAt: serverTimestamp(),
              });
            }

            // 3. Update target user's matching Pending transaction
            const txSnap = await getDocs(
              query(
                collection(db, 'wallets', targetUid, 'transactions'),
                where('uid', '==', targetUid)
              )
            );
            for (const txDoc of txSnap.docs) {
              const td = txDoc.data();
              if (
                (td.orderId === targetSub.id || td.orderId === targetSub.orderId) &&
                td.status === 'Pending'
              ) {
                await updateDoc(txDoc.ref, {
                  status: 'Success',
                  title: 'Order Approved · +11% Payout',
                  titleZh: '订单已通过 · +11% 返现到账',
                  subtitle: `Paid ${formatINR(principal, false)} + 11% (${formatINR(commission, false)}) Credited`,
                  subtitleZh: `已付 ${formatINR(principal, false)} + 11% (${formatINR(commission, false)}) 已到账`,
                  updatedAt: serverTimestamp(),
                });
              }
            }

            // 4. Send approval notification to target user
            const notifId = makeDocId('notif');
            await setDoc(
              doc(db, 'wallets', targetUid, 'notifications', notifId),
              {
                uid: targetUid,
                title: `Order Approved · +${formatINR(totalReturn)} Credited`,
                titleZh: `订单已通过 · 已到账 +${formatINR(totalReturn)}`,
                message: `Order ${targetSub.orderCode} approved. Principal ${formatINR(principal, false)} + 11% (${formatINR(commission, false)}) added to wallet.`,
                messageZh: `订单 ${targetSub.orderCode} 已通过审核。本金 ${formatINR(principal, false)} + 11% 返现 (${formatINR(commission, false)}) 已存入钱包。`,
                timestamp: now,
                read: false,
                kind: 'payout',
                createdAt: serverTimestamp(),
              }
            );

            // 5. Mark target user's referral record completed if they were referred
            const refDocRef = doc(db, 'referrals', targetUid);
            const refSnap = await getDoc(refDocRef);
            if (refSnap.exists() && refSnap.data().status === 'registered') {
              await updateDoc(refDocRef, {
                status: 'completed',
                completedAt: now,
                updatedAt: serverTimestamp(),
              });
            }
          } catch (err) {
            handleFirestoreError(
              err,
              OperationType.UPDATE,
              `order_submissions/${targetSub.id}`
            );
          }
        })();
        return;
      }

      // Local mode approval
      const currentMobile = stateRef.current.authAccount?.mobileNumber || '';
      const targetOrderForSync = stateRef.current.adminOrders.find(
        (o) => o.id === orderOrSubmissionId || o.submissionId === orderOrSubmissionId
      );
      const decisionExpiresAt = Date.now() + 120000;
      pendingOrderDecisionRef.current.set(orderOrSubmissionId, {
        status: 'success',
        expiresAt: decisionExpiresAt,
      });
      if (targetOrderForSync?.submissionId) {
        pendingOrderDecisionRef.current.set(targetOrderForSync.submissionId, {
          status: 'success',
          expiresAt: decisionExpiresAt,
        });
        updateCachedAdminSubmissionStatus(targetOrderForSync.submissionId, 'success');
      }
      updateCachedAdminSubmissionStatus(orderOrSubmissionId, 'success');
      updateFallbackOrderSubmissionStatus(orderOrSubmissionId, 'success');

      const refOwnerCode = targetOrderForSync?.referredBy || stateRef.current.referredBy;
      const refUserUid = targetOrderForSync?.userUid || stateRef.current.profile.userId;
      if (refOwnerCode && refUserUid) {
        completeFallbackReferral(refUserUid, refOwnerCode);
        updateSyncOutbox((ob) => ({
          ...ob,
          referralCompletions: [
            ...ob.referralCompletions.filter((x) => x.inviteeId !== refUserUid),
            { inviteeId: refUserUid, referrerCode: refOwnerCode },
          ],
        }));
      }

      if (isAdminMobile(currentMobile)) {
        updateSyncOutbox((ob) => ({
          ...ob,
          orderDecisions: [
            ...ob.orderDecisions.filter((x) => x.id !== orderOrSubmissionId),
            { id: orderOrSubmissionId, status: 'success' },
          ],
        }));
        void flushOutboxToServer().then(() => {
          void syncSharedOrdersFromServer();
        });
      } else if (refOwnerCode && refUserUid) {
        void flushOutboxToServer();
      }

      setState((prev) => {
        const targetOrder = prev.adminOrders.find(
          (o) => o.id === orderOrSubmissionId || o.submissionId === orderOrSubmissionId
        );
        if (!targetOrder || targetOrder.status !== 'pending') return prev;

        const myUserId = prev.authAccount?.userId || prev.profile.userId;
        const isOwnOrder = !targetOrder.userUid || targetOrder.userUid === myUserId;
        const { principal, commission, totalReturn } = calculateCommission(
          targetOrder.amount
        );
        const now = formatTimestamp();

        const notif: AppNotification = {
          id: makeDocId('notif'),
          title: `Order Approved · +${formatINR(totalReturn)} Credited`,
          titleZh: `订单已通过 · 已到账 +${formatINR(totalReturn)}`,
          message: `Order ${targetOrder.orderCode} approved. Principal ${formatINR(principal, false)} + 11% (${formatINR(commission, false)}) added to wallet.`,
          messageZh: `订单 ${targetOrder.orderCode} 已通过审核。本金 ${formatINR(principal, false)} + 11% 返现 (${formatINR(commission, false)}) 已存入钱包。`,
          timestamp: now,
          read: false,
          kind: 'payout',
        };

        return {
          ...prev,
          walletBalance: isOwnOrder
            ? roundCurrency(prev.walletBalance + totalReturn)
            : prev.walletBalance,
          totalPaid: isOwnOrder
            ? roundCurrency(prev.totalPaid + principal)
            : prev.totalPaid,
          totalCashbackEarned: isOwnOrder
            ? roundCurrency(prev.totalCashbackEarned + commission)
            : prev.totalCashbackEarned,
          completedOrdersCount: isOwnOrder
            ? prev.completedOrdersCount + 1
            : prev.completedOrdersCount,
          adminOrders: prev.adminOrders.map((o) =>
            o.id === orderOrSubmissionId || o.submissionId === orderOrSubmissionId
              ? { ...o, status: 'success' }
              : o
          ),
          transactions: isOwnOrder
            ? prev.transactions.map((tx) =>
                (tx.orderId === orderOrSubmissionId || tx.orderId === targetOrder.id) &&
                tx.status === 'Pending'
                  ? {
                      ...tx,
                      status: 'Success',
                      title: 'Order Approved · +11% Payout',
                      titleZh: '订单已通过 · +11% 返现到账',
                      subtitle: `Paid ${formatINR(principal, false)} + 11% (${formatINR(commission, false)}) Credited`,
                      subtitleZh: `已付 ${formatINR(principal, false)} + 11% (${formatINR(commission, false)}) 已到账`,
                    }
                  : tx
              )
            : prev.transactions,
          notifications: isOwnOrder ? [notif, ...prev.notifications] : prev.notifications,
        };
      });
    },
    [isCloudUser, user]
  );

  const rejectPendingOrder = useCallback(
    (orderOrSubmissionId: string) => {
      if (isCloudUser && user) {
        const targetSub = submissionsRef.current.find(
          (s) => s.id === orderOrSubmissionId && s.status === 'pending'
        );
        if (!targetSub) return;

        const now = formatTimestamp();
        const targetUid = targetSub.userUid;

        void (async () => {
          try {
            await updateDoc(doc(db, 'order_submissions', targetSub.id), {
              status: 'rejected',
              updatedAt: serverTimestamp(),
            });

            const txSnap = await getDocs(
              query(
                collection(db, 'wallets', targetUid, 'transactions'),
                where('uid', '==', targetUid)
              )
            );
            for (const txDoc of txSnap.docs) {
              const td = txDoc.data();
              if (
                (td.orderId === targetSub.id || td.orderId === targetSub.orderId) &&
                td.status === 'Pending'
              ) {
                await updateDoc(txDoc.ref, {
                  status: 'Rejected',
                  title: `Order Rejected (${formatINR(targetSub.amount, false)})`,
                  titleZh: `订单已拒绝 (${formatINR(targetSub.amount, false)})`,
                  subtitle: 'Payment Rejected · No wallet payout',
                  subtitleZh: '订单已拒绝 · 未发放钱包收益',
                  updatedAt: serverTimestamp(),
                });
              }
            }

            const notifId = makeDocId('notif');
            await setDoc(
              doc(db, 'wallets', targetUid, 'notifications', notifId),
              {
                uid: targetUid,
                title: `Order Rejected · ${targetSub.orderCode}`,
                titleZh: `订单已拒绝 · ${targetSub.orderCode}`,
                message: `Payment rejected for ${formatINR(targetSub.amount, false)}. No funds credited.`,
                messageZh: `${formatINR(targetSub.amount, false)} 的订单付款已被拒绝，未发放余额。`,
                timestamp: now,
                read: false,
                kind: 'system',
                createdAt: serverTimestamp(),
              }
            );
          } catch (err) {
            handleFirestoreError(
              err,
              OperationType.UPDATE,
              `order_submissions/${targetSub.id}`
            );
          }
        })();
        return;
      }

      const currentMobile = stateRef.current.authAccount?.mobileNumber || '';
      const targetOrderForReject = stateRef.current.adminOrders.find(
        (o) => o.id === orderOrSubmissionId || o.submissionId === orderOrSubmissionId
      );
      const rejectExpiresAt = Date.now() + 120000;
      pendingOrderDecisionRef.current.set(orderOrSubmissionId, {
        status: 'rejected',
        expiresAt: rejectExpiresAt,
      });
      if (targetOrderForReject?.submissionId) {
        pendingOrderDecisionRef.current.set(targetOrderForReject.submissionId, {
          status: 'rejected',
          expiresAt: rejectExpiresAt,
        });
        updateCachedAdminSubmissionStatus(targetOrderForReject.submissionId, 'rejected');
      }
      updateCachedAdminSubmissionStatus(orderOrSubmissionId, 'rejected');
      updateFallbackOrderSubmissionStatus(orderOrSubmissionId, 'rejected');

      if (isAdminMobile(currentMobile)) {
        updateSyncOutbox((ob) => ({
          ...ob,
          orderDecisions: [
            ...ob.orderDecisions.filter((x) => x.id !== orderOrSubmissionId),
            { id: orderOrSubmissionId, status: 'rejected' },
          ],
        }));
        void flushOutboxToServer().then(() => {
          void syncSharedOrdersFromServer();
        });
      }

      setState((prev) => {
        const targetOrder = prev.adminOrders.find(
          (o) => o.id === orderOrSubmissionId || o.submissionId === orderOrSubmissionId
        );
        if (!targetOrder || targetOrder.status !== 'pending') return prev;

        const myUserId = prev.authAccount?.userId || prev.profile.userId;
        const isOwnOrder = !targetOrder.userUid || targetOrder.userUid === myUserId;
        const now = formatTimestamp();
        const notif: AppNotification = {
          id: makeDocId('notif'),
          title: `Order Rejected · ${targetOrder.orderCode}`,
          titleZh: `订单已拒绝 · ${targetOrder.orderCode}`,
          message: `Payment rejected for ${formatINR(targetOrder.amount, false)}. No funds credited.`,
          messageZh: `${formatINR(targetOrder.amount, false)} 的订单付款已被拒绝，未发放余额。`,
          timestamp: now,
          read: false,
          kind: 'system',
        };

        return {
          ...prev,
          adminOrders: prev.adminOrders.map((o) =>
            o.id === orderOrSubmissionId || o.submissionId === orderOrSubmissionId
              ? { ...o, status: 'rejected' }
              : o
          ),
          transactions: isOwnOrder
            ? prev.transactions.map((tx) =>
                (tx.orderId === orderOrSubmissionId || tx.orderId === targetOrder.id) &&
                tx.status === 'Pending'
                  ? {
                      ...tx,
                      status: 'Rejected',
                      title: `Order Rejected (${formatINR(targetOrder.amount, false)})`,
                      titleZh: `订单已拒绝 (${formatINR(targetOrder.amount, false)})`,
                      subtitle: 'Payment Rejected · No wallet payout',
                      subtitleZh: '订单已拒绝 · 未发放钱包收益',
                    }
                  : tx
              )
            : prev.transactions,
          notifications: isOwnOrder ? [notif, ...prev.notifications] : prev.notifications,
        };
      });
    },
    [isCloudUser, user]
  );

  const withdrawFunds = useCallback(
    (
      amountInr: number,
      details: WithdrawDetailsInput,
      statusMode: 'Success' | 'Pending' = 'Pending'
    ): { ok: boolean; error?: string; transaction?: Transaction } => {
      const cleanAmount = roundCurrency(amountInr);
      if (!Number.isFinite(cleanAmount) || cleanAmount < MIN_WITHDRAW_AMOUNT) {
        return { ok: false, error: t.errMinWithdraw };
      }
      if (cleanAmount > stateRef.current.walletBalance) {
        return { ok: false, error: t.errInsufficientBalance };
      }

      const method = details.method;
      const cleanUpi = details.upiId?.trim() || stateRef.current.profile.upiId;
      const cleanBankName =
        details.bankName?.trim() || stateRef.current.profile.bankName;
      const cleanAccountNumber = details.accountNumber?.trim() || '';
      const cleanIfsc = details.ifscCode?.trim().toUpperCase() || '';
      const cleanMobile = (details.mobileNumber || '').replace(/\D/g, '');

      let destLabel = '';
      if (method === 'upi') {
        if (cleanUpi.length < 4 || !cleanUpi.includes('@')) {
          return { ok: false, error: t.errInvalidUpiId };
        }
        destLabel = `UPI ID: ${cleanUpi}`;
      } else if (method === 'bank') {
        if (cleanBankName.length < 2 || cleanAccountNumber.length < 6) {
          return { ok: false, error: t.errInvalidBankDetails };
        }
        destLabel = cleanIfsc
          ? `${cleanBankName} · A/C ${cleanAccountNumber} · IFSC ${cleanIfsc}`
          : `${cleanBankName} · A/C ${cleanAccountNumber}`;
      } else {
        if (cleanMobile.length !== 10) {
          return { ok: false, error: t.errInvalidMobile };
        }
        destLabel = `Mobile: +91 ${cleanMobile}`;
      }

      const now = formatTimestamp();
      const txId = makeDocId('tx');
      const notifId = makeDocId('notif');
      const wdrId = makeDocId('wdr');
      const currentUserId =
        stateRef.current.authAccount?.userId || stateRef.current.profile.userId;
      const currentUsername =
        stateRef.current.authAccount?.username ||
        stateRef.current.profile.username;
      const currentUserMobile =
        stateRef.current.authAccount?.mobileNumber ||
        stateRef.current.profile.mobileNumber;

      const withdrawRequest: WithdrawRequest = {
        id: wdrId,
        txId,
        userId: currentUserId,
        username: currentUsername,
        userMobile: currentUserMobile,
        amount: cleanAmount,
        method,
        upiId: method === 'upi' ? cleanUpi : undefined,
        bankName: method === 'bank' ? cleanBankName : undefined,
        accountNumber: method === 'bank' ? cleanAccountNumber : undefined,
        ifscCode: method === 'bank' && cleanIfsc ? cleanIfsc : undefined,
        mobileNumber: method === 'mobile' ? cleanMobile : undefined,
        accountDetailSummary: destLabel,
        status: statusMode,
        createdAt: now,
      };

      const tx: Transaction = {
        id: txId,
        type: 'withdrawal',
        title: 'Withdrawal',
        titleZh: '提现',
        subtitle: destLabel,
        subtitleZh: destLabel,
        amount: cleanAmount,
        status: statusMode,
        timestamp: now,
        referenceId: generateRefId('WDR'),
      };

      const statusZh = statusMode === 'Pending' ? '等待审核' : '成功';
      const notif: AppNotification = {
        id: notifId,
        title:
          statusMode === 'Pending'
            ? 'Withdrawal Requested · Pending'
            : 'Withdrawal Dispatched',
        titleZh:
          statusMode === 'Pending' ? '提现申请已提交 · 等待审核' : '提现已发放',
        message: `${formatINR(cleanAmount)} payout to ${destLabel} (${statusMode}).`,
        messageZh: `向 ${destLabel} 提现 ${formatINR(cleanAmount)}（${statusZh}）。`,
        timestamp: now,
        read: false,
        kind: 'withdrawal',
      };

      if (isCloudUser && user) {
        const uid = user.uid;
        const nextBalance = roundCurrency(
          stateRef.current.walletBalance - cleanAmount
        );
        const nextWithdrawal = roundCurrency(
          stateRef.current.totalWithdrawal + cleanAmount
        );
        void (async () => {
          try {
            await updateDoc(doc(db, 'wallets', uid), {
              walletBalance: nextBalance,
              totalWithdrawal: nextWithdrawal,
              updatedAt: serverTimestamp(),
            });
            await setDoc(doc(db, 'wallets', uid, 'transactions', txId), {
              uid,
              type: 'withdrawal',
              title: tx.title,
              titleZh: tx.titleZh,
              subtitle: tx.subtitle,
              subtitleZh: tx.subtitleZh,
              amount: cleanAmount,
              status: statusMode,
              timestamp: now,
              referenceId: tx.referenceId,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
            await setDoc(doc(db, 'wallets', uid, 'notifications', notifId), {
              uid,
              title: notif.title,
              titleZh: notif.titleZh,
              message: notif.message,
              messageZh: notif.messageZh,
              timestamp: now,
              read: false,
              kind: 'withdrawal',
              createdAt: serverTimestamp(),
            });
          } catch (err) {
            handleFirestoreError(err, OperationType.UPDATE, `wallets/${uid}`);
          }
        })();
      } else {
        setState((prev) => ({
          ...prev,
          walletBalance: roundCurrency(prev.walletBalance - cleanAmount),
          totalWithdrawal: roundCurrency(prev.totalWithdrawal + cleanAmount),
          withdrawRequests: [withdrawRequest, ...prev.withdrawRequests],
          profile: {
            ...prev.profile,
            upiId: method === 'upi' ? cleanUpi : prev.profile.upiId,
            bankName: method === 'bank' ? cleanBankName : prev.profile.bankName,
            accountLast4:
              method === 'bank'
                ? cleanAccountNumber.slice(-4)
                : prev.profile.accountLast4,
            mobileNumber:
              method === 'mobile' ? cleanMobile : prev.profile.mobileNumber,
          },
          transactions: [tx, ...prev.transactions],
          notifications: [notif, ...prev.notifications],
        }));

        saveFallbackWithdrawal(withdrawRequest);
        updateSyncOutbox((ob) => ({
          ...ob,
          withdrawals: [
            ...ob.withdrawals.filter((x) => x.id !== withdrawRequest.id),
            withdrawRequest,
          ],
        }));
        void flushOutboxToServer().then(() => {
          void syncWithdrawalsFromServer();
        });
      }

      return { ok: true, transaction: tx };
    },
    [
      isCloudUser,
      user,
      t.errMinWithdraw,
      t.errInsufficientBalance,
      t.errInvalidUpiId,
      t.errInvalidBankDetails,
      t.errInvalidMobile,
    ]
  );

  const approveWithdrawalRequest = useCallback((withdrawalId: string) => {
    const currentMobile = stateRef.current.authAccount?.mobileNumber || '';
    if (!isAdminMobile(currentMobile)) return;
    const now = formatTimestamp();
    setState((prev) => {
      const target = prev.withdrawRequests.find((w) => w.id === withdrawalId);
      if (!target || target.status !== 'Pending') return prev;
      const myUserId = prev.authAccount?.userId || prev.profile.userId;
      const isMine = target.userId === myUserId;

      return {
        ...prev,
        withdrawRequests: prev.withdrawRequests.map((w) =>
          w.id === withdrawalId
            ? { ...w, status: 'Success', processedAt: now }
            : w
        ),
        transactions: isMine
          ? prev.transactions.map((tx) =>
              tx.id === target.txId ? { ...tx, status: 'Success' } : tx
            )
          : prev.transactions,
        notifications: isMine
          ? [
              {
                id: makeDocId('notif'),
                title: 'Withdrawal Approved & Paid',
                titleZh: '提现已审核通过并打款',
                message: `${formatINR(target.amount)} withdrawal to ${target.accountDetailSummary} approved.`,
                messageZh: `向 ${target.accountDetailSummary} 提现 ${formatINR(target.amount)} 已通过并打款。`,
                timestamp: now,
                read: false,
                kind: 'withdrawal',
              },
              ...prev.notifications,
            ]
          : prev.notifications,
      };
    });

    const decisionExpiresAt = Date.now() + 15000;
    pendingWithdrawalDecisionRef.current.set(withdrawalId, {
      status: 'Success',
      expiresAt: decisionExpiresAt,
    });
    updateFallbackWithdrawalStatus(withdrawalId, 'Success');
    updateSyncOutbox((ob) => ({
      ...ob,
      withdrawalDecisions: [
        ...ob.withdrawalDecisions.filter((x) => x.id !== withdrawalId),
        { id: withdrawalId, status: 'Success' },
      ],
    }));
    void flushOutboxToServer().then(() => {
      void syncWithdrawalsFromServer();
    });
  }, [flushOutboxToServer, syncWithdrawalsFromServer]);

  const rejectWithdrawalRequest = useCallback((withdrawalId: string) => {
    const currentMobile = stateRef.current.authAccount?.mobileNumber || '';
    if (!isAdminMobile(currentMobile)) return;
    const now = formatTimestamp();
    setState((prev) => {
      const target = prev.withdrawRequests.find((w) => w.id === withdrawalId);
      if (!target || target.status !== 'Pending') return prev;
      const myUserId = prev.authAccount?.userId || prev.profile.userId;
      const isMine = target.userId === myUserId;

      return {
        ...prev,
        walletBalance: isMine
          ? roundCurrency(prev.walletBalance + target.amount)
          : prev.walletBalance,
        totalWithdrawal: isMine
          ? Math.max(0, roundCurrency(prev.totalWithdrawal - target.amount))
          : prev.totalWithdrawal,
        withdrawRequests: prev.withdrawRequests.map((w) =>
          w.id === withdrawalId
            ? { ...w, status: 'Rejected', processedAt: now }
            : w
        ),
        transactions: isMine
          ? prev.transactions.map((tx) =>
              tx.id === target.txId ? { ...tx, status: 'Rejected' } : tx
            )
          : prev.transactions,
        notifications: isMine
          ? [
              {
                id: makeDocId('notif'),
                title: 'Withdrawal Rejected · Refunded',
                titleZh: '提现已拒绝 · 余额已退回',
                message: `${formatINR(target.amount)} withdrawal was rejected and refunded to your wallet.`,
                messageZh: `提现 ${formatINR(target.amount)} 已被拒绝，金额已退回您的钱包。`,
                timestamp: now,
                read: false,
                kind: 'withdrawal',
              },
              ...prev.notifications,
            ]
          : prev.notifications,
      };
    });

    const decisionExpiresAt = Date.now() + 15000;
    pendingWithdrawalDecisionRef.current.set(withdrawalId, {
      status: 'Rejected',
      expiresAt: decisionExpiresAt,
    });
    updateFallbackWithdrawalStatus(withdrawalId, 'Rejected');
    updateSyncOutbox((ob) => ({
      ...ob,
      withdrawalDecisions: [
        ...ob.withdrawalDecisions.filter((x) => x.id !== withdrawalId),
        { id: withdrawalId, status: 'Rejected' },
      ],
    }));
    void flushOutboxToServer().then(() => {
      void syncWithdrawalsFromServer();
    });
  }, [flushOutboxToServer, syncWithdrawalsFromServer]);

  const settlePendingWithdrawal = useCallback(
    (txId: string) => {
      if (isCloudUser && user) {
        void updateDoc(doc(db, 'wallets', user.uid, 'transactions', txId), {
          status: 'Success',
          updatedAt: serverTimestamp(),
        }).catch((err) => {
          handleFirestoreError(
            err,
            OperationType.UPDATE,
            `wallets/${user.uid}/transactions/${txId}`
          );
        });
        return;
      }

      setState((prev) => ({
        ...prev,
        transactions: prev.transactions.map((tx) =>
          tx.id === txId && tx.status === 'Pending'
            ? { ...tx, status: 'Success' }
            : tx
        ),
      }));
    },
    [isCloudUser, user]
  );

  const claimDailyBonus = useCallback((): { ok: boolean; error?: string } => {
    const today = new Date().toISOString().slice(0, 10);
    if (stateRef.current.dailyCheckInDate === today) {
      return { ok: false, error: t.alreadyClaimedMsg };
    }
    const bonusAmount = 25;
    const now = formatTimestamp();
    const nextStreak = stateRef.current.streakDays + 1;
    const txId = makeDocId('tx');
    const notifId = makeDocId('notif');

    const tx: Transaction = {
      id: txId,
      type: 'daily_bonus',
      title: 'Daily Task Check-in Reward',
      titleZh: '每日任务签到奖励',
      subtitle: `Day ${nextStreak} Attendance Bonus`,
      subtitleZh: `第 ${nextStreak} 天签到奖励`,
      amount: bonusAmount,
      commissionAmount: bonusAmount,
      status: 'Success',
      timestamp: now,
      referenceId: generateRefId('TSK'),
    };
    const notif: AppNotification = {
      id: notifId,
      title: 'Daily Check-In Credited',
      titleZh: '每日签到奖励已到账',
      message: `₹${bonusAmount}.00 reward added to your Wallet Balance.`,
      messageZh: `已将 ₹${bonusAmount}.00 奖励存入您的钱包余额。`,
      timestamp: now,
      read: false,
      kind: 'payout',
    };

    if (isCloudUser && user) {
      const uid = user.uid;
      void (async () => {
        try {
          await updateDoc(doc(db, 'wallets', uid), {
            walletBalance: roundCurrency(
              stateRef.current.walletBalance + bonusAmount
            ),
            totalCashbackEarned: roundCurrency(
              stateRef.current.totalCashbackEarned + bonusAmount
            ),
            dailyCheckInDate: today,
            streakDays: nextStreak,
            updatedAt: serverTimestamp(),
          });
          await setDoc(doc(db, 'wallets', uid, 'transactions', txId), {
            uid,
            type: 'daily_bonus',
            title: tx.title,
            titleZh: tx.titleZh,
            subtitle: tx.subtitle,
            subtitleZh: tx.subtitleZh,
            amount: bonusAmount,
            commissionAmount: bonusAmount,
            status: 'Success',
            timestamp: now,
            referenceId: tx.referenceId,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          await setDoc(doc(db, 'wallets', uid, 'notifications', notifId), {
            uid,
            title: notif.title,
            titleZh: notif.titleZh,
            message: notif.message,
            messageZh: notif.messageZh,
            timestamp: now,
            read: false,
            kind: 'payout',
            createdAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `wallets/${uid}`);
        }
      })();
    } else {
      setState((prev) => ({
        ...prev,
        walletBalance: roundCurrency(prev.walletBalance + bonusAmount),
        totalCashbackEarned: roundCurrency(
          prev.totalCashbackEarned + bonusAmount
        ),
        dailyCheckInDate: today,
        streakDays: prev.streakDays + 1,
        transactions: [tx, ...prev.transactions],
        notifications: [notif, ...prev.notifications],
      }));
    }

    return { ok: true };
  }, [isCloudUser, user, t.alreadyClaimedMsg]);

  const updateProfile = useCallback((updates: Partial<UserProfile>) => {
    setState((prev) => ({
      ...prev,
      profile: {
        ...prev.profile,
        ...updates,
      },
    }));
  }, []);

  const markNotificationsRead = useCallback(() => {
    if (isCloudUser && user) {
      const unread = stateRef.current.notifications.filter((n) => !n.read);
      for (const n of unread) {
        void updateDoc(doc(db, 'wallets', user.uid, 'notifications', n.id), {
          read: true,
        }).catch((err) => {
          handleFirestoreError(
            err,
            OperationType.UPDATE,
            `wallets/${user.uid}/notifications/${n.id}`
          );
        });
      }
      return;
    }

    setState((prev) => ({
      ...prev,
      notifications: prev.notifications.map((n) => ({ ...n, read: true })),
    }));
  }, [isCloudUser, user]);

  const resetWallet = useCallback(() => {
    if (isCloudUser && user) {
      const uid = user.uid;
      void updateDoc(doc(db, 'wallets', uid), {
        linkedAppId: deleteField(),
        linkedAppName: deleteField(),
        linkedAt: deleteField(),
        updatedAt: serverTimestamp(),
      }).catch((err) => {
        handleFirestoreError(err, OperationType.UPDATE, `wallets/${uid}`);
      });
      return;
    }

    setState(INITIAL_STATE);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_STATE));
    } catch {
      // ignore
    }
  }, [isCloudUser, user]);

  const registerAccount = useCallback(
    async (params: {
      mobileNumber: string;
      username: string;
      password: string;
      confirmPassword: string;
      referralCode?: string;
    }): Promise<{ ok: boolean; error?: string }> => {
      const cleanMobile = normalizeIndianMobile(params.mobileNumber);
      const cleanUsername = params.username.trim();
      const lockedPendingRef = stateRef.current.referredBy || readPendingRef();
      const cleanRef =
        lockedPendingRef ||
        normalizeReferralCode(params.referralCode) ||
        '';

      if (cleanMobile.length !== 10) {
        return { ok: false, error: t.errInvalidMobile };
      }
      if (cleanUsername.length < 2) {
        return { ok: false, error: t.errAuthUsername };
      }
      if (params.password.length < 6) {
        return { ok: false, error: t.errAuthPassword };
      }
      if (params.password !== params.confirmPassword) {
        return { ok: false, error: t.errAuthPasswordMismatch };
      }

      try {
        const registerPayload = JSON.stringify({
          mobileNumber: cleanMobile,
          username: cleanUsername,
          password: params.password,
          confirmPassword: params.confirmPassword,
          referralCode: cleanRef,
        });
        let res = await safeFetchJson<{
          ok?: boolean;
          error?: string;
          account?: AuthAccount;
          existingWallet?: Partial<WalletState> | null;
        }>('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: registerPayload,
        });
        if (!res.available) {
          await new Promise((resolve) => setTimeout(resolve, 450));
          res = await safeFetchJson<{
            ok?: boolean;
            error?: string;
            account?: AuthAccount;
            existingWallet?: Partial<WalletState> | null;
          }>('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: registerPayload,
          });
        }

        let acc: AuthAccount | undefined;
        let legacy: Partial<WalletState> | null | undefined;
        let errorCode: string | undefined;
        let usedFallbackRegister = false;

        if (!res.available) {
          const fb = await registerFallbackAccount({
            mobileNumber: cleanMobile,
            username: cleanUsername,
            password: params.password,
            confirmPassword: params.confirmPassword,
            referralCode: cleanRef,
          });
          if (!fb.ok || !fb.account) {
            errorCode = fb.errorCode;
          } else {
            acc = fb.account;
            legacy = fb.existingWallet;
            usedFallbackRegister = true;
          }
        } else if (!res.ok || !res.data.account) {
          errorCode = res.data.error || '';
        } else {
          acc = res.data.account;
          legacy = res.data.existingWallet;
        }

        if (!acc) {
          const code = errorCode || '';
          if (code === 'MOBILE_EXISTS') {
            return { ok: false, error: t.errAuthMobileExists };
          }
          if (code === 'SELF_REFERRAL') {
            return { ok: false, error: t.errAuthSelfReferral };
          }
          if (code === 'PASSWORD_MISMATCH') {
            return { ok: false, error: t.errAuthPasswordMismatch };
          }
          if (code === 'INVALID_USERNAME') {
            return { ok: false, error: t.errAuthUsername };
          }
          if (code === 'INVALID_PASSWORD') {
            return { ok: false, error: t.errAuthPassword };
          }
          if (code === 'INVALID_MOBILE') {
            return { ok: false, error: t.errInvalidMobile };
          }
          return { ok: false, error: t.errAuthGeneric };
        }

        await mirrorVerifiedAccountToFallback(acc, params.password);
        if (acc.referredBy) {
          registerFallbackReferral({
            referrerCode: acc.referredBy,
            inviteeId: acc.userId,
            inviteeName: acc.username,
          });
        }

        const now = formatTimestamp();
        const notif: AppNotification = {
          id: makeDocId('notif'),
          title: `Welcome, ${acc.username}`,
          titleZh: `欢迎加入，${acc.username}`,
          message: acc.referredBy
            ? `Account registered with mobile ${acc.mobileNumber}. Referred by ${acc.referredBy}.`
            : `Account registered with mobile ${acc.mobileNumber}.`,
          messageZh: acc.referredBy
            ? `手机号 ${acc.mobileNumber} 注册成功，已绑定推荐码 ${acc.referredBy}。`
            : `手机号 ${acc.mobileNumber} 注册成功。`,
          timestamp: now,
          read: false,
          kind: 'system',
        };

        const freshState: WalletState = {
          ...(legacy ? { ...INITIAL_STATE, ...legacy } : INITIAL_STATE),
          authAccount: acc,
          referredBy: acc.referredBy ?? legacy?.referredBy ?? null,
          profile: {
            ...DEFAULT_PROFILE,
            ...(legacy?.profile ?? {}),
            userId: isCloudUser ? stateRef.current.profile.userId : acc.userId,
            username: acc.username,
            mobileNumber: acc.mobileNumber,
            upiId: legacy?.profile?.upiId || `${acc.mobileNumber}@okaxis`,
          },
          transactions: Array.isArray(legacy?.transactions) ? legacy.transactions : [],
          notifications: Array.isArray(legacy?.notifications)
            ? [notif, ...legacy.notifications]
            : [notif],
        };

        savePendingRef(null);
        setState(freshState);

        if (!isCloudUser) {
          saveFallbackWallet(acc.userId, freshState, acc.mobileNumber);
          if (!isAdminMobile(acc.mobileNumber)) {
            try {
              window.localStorage.removeItem(ADMIN_USERS_CACHE_KEY);
            } catch {
              // ignore
            }
          }
          const walletPutRes = await safeFetchJson(
            `/api/wallet/${encodeURIComponent(acc.userId)}`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ wallet: freshState }),
            }
          );
          if (usedFallbackRegister || !walletPutRes.available || !walletPutRes.ok) {
            const registeredAcc = acc;
            updateSyncOutbox((ob) => ({
              ...ob,
              accountRestores: [
                ...ob.accountRestores.filter(
                  (x) =>
                    x.userId !== registeredAcc.userId &&
                    normalizeIndianMobile(x.mobileNumber) !==
                      normalizeIndianMobile(registeredAcc.mobileNumber)
                ),
                {
                  userId: registeredAcc.userId,
                  mobileNumber: registeredAcc.mobileNumber,
                  username: registeredAcc.username,
                  password: params.password,
                  referralCode: registeredAcc.referralCode,
                  referredBy: registeredAcc.referredBy ?? null,
                  createdAt: registeredAcc.createdAt,
                  wallet: freshState,
                },
              ],
            }));
            void flushOutboxToServer();
          }
        }
        void syncAdminUsersFromServer();
        void syncReferralsFromServer();
        void syncSharedOrdersFromServer();
        void syncWithdrawalsFromServer();

        if (isCloudUser && user) {
          const uid = user.uid;
          try {
            const walletSnap = await getDoc(doc(db, 'wallets', uid));
            if (walletSnap.exists()) {
              const wd = walletSnap.data();
              await updateDoc(doc(db, 'wallets', uid), {
                username: acc.username.slice(0, 64),
                updatedAt: serverTimestamp(),
              });
              if (!wd.referredBy && acc.referredBy && acc.referredBy !== wd.referralCode) {
                await updateDoc(doc(db, 'wallets', uid), {
                  referredBy: acc.referredBy.slice(0, 32),
                  updatedAt: serverTimestamp(),
                });
              }
              await updateDoc(doc(db, 'wallets', uid, 'private', 'info'), {
                mobileNumber: acc.mobileNumber,
                updatedAt: serverTimestamp(),
              });
              await setDoc(doc(db, 'wallets', uid, 'notifications', notif.id), {
                uid,
                title: notif.title,
                titleZh: notif.titleZh,
                message: notif.message,
                messageZh: notif.messageZh,
                timestamp: now,
                read: false,
                kind: 'system',
                createdAt: serverTimestamp(),
              });
            }
            if (acc.referredBy) {
              await ensureCloudReferralRegistered(
                user,
                acc.referredBy,
                acc.username
              );
            }
          } catch (err) {
            handleFirestoreError(err, OperationType.UPDATE, `wallets/${uid}`);
          }
        }

        return { ok: true };
      } catch {
        return { ok: false, error: t.errAuthGeneric };
      }
    },
    [
      isCloudUser,
      user,
      ensureCloudReferralRegistered,
      syncAdminUsersFromServer,
      syncReferralsFromServer,
      syncSharedOrdersFromServer,
      syncWithdrawalsFromServer,
      t.errInvalidMobile,
      t.errAuthUsername,
      t.errAuthPassword,
      t.errAuthPasswordMismatch,
      t.errAuthMobileExists,
      t.errAuthSelfReferral,
      t.errAuthGeneric,
    ]
  );

  const loginAccount = useCallback(
    async (params: {
      mobileNumber: string;
      password: string;
    }): Promise<{ ok: boolean; error?: string }> => {
      const cleanMobile = normalizeIndianMobile(params.mobileNumber);
      if (cleanMobile.length !== 10) {
        return { ok: false, error: t.errInvalidMobile };
      }
      if (params.password.length < 6) {
        return { ok: false, error: t.errAuthPassword };
      }

      const loginRef = stateRef.current.referredBy || readPendingRef();

      try {
        const loginPayload = JSON.stringify({
          mobileNumber: cleanMobile,
          password: params.password,
          ...(loginRef ? { referredBy: loginRef } : {}),
        });
        let res = await safeFetchJson<{
          ok?: boolean;
          error?: string;
          ephemeralMissing?: boolean;
          accountNotFound?: boolean;
          wrongPassword?: boolean;
          account?: AuthAccount;
        }>('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: loginPayload,
        });

        // Retry once after brief delay on transient failure or cross-device KV propagation lag (never on wrongPassword)
        if (!res.available || (!res.ok && res.data?.accountNotFound)) {
          await new Promise((resolve) => setTimeout(resolve, 550));
          res = await safeFetchJson<{
            ok?: boolean;
            error?: string;
            ephemeralMissing?: boolean;
            accountNotFound?: boolean;
            wrongPassword?: boolean;
            account?: AuthAccount;
          }>('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: loginPayload,
          });
        }

        let acc: AuthAccount | undefined;
        let restoredWallet: Partial<WalletState> | null = null;
        let shouldRestoreToServer = false;
        let shouldPushMergedWalletToServer = false;

        if (!res.available || (!res.ok && !res.data?.wrongPassword)) {
          let matchedLocalAgent: {
            id: string;
            mobileNumber: string;
            password: string;
            referralCode: string;
            createdAt: string;
          } | null = null;
          try {
            const rawAgents = window.localStorage.getItem('aurex_vault_agents_v1');
            if (rawAgents) {
              const list = JSON.parse(rawAgents) as Array<{
                id: string;
                mobileNumber: string;
                password: string;
                referralCode: string;
                createdAt: string;
              }>;
              matchedLocalAgent =
                list.find(
                  (a) =>
                    normalizeIndianMobile(a.mobileNumber) === cleanMobile &&
                    a.password === params.password
                ) || null;
            }
          } catch {
            matchedLocalAgent = null;
          }

          if (matchedLocalAgent && !isAdminMobile(cleanMobile)) {
            acc = {
              userId: matchedLocalAgent.id,
              mobileNumber: cleanMobile,
              username: `Agent_${matchedLocalAgent.id}`,
              referredBy: null,
              referralCode: matchedLocalAgent.referralCode,
              createdAt: matchedLocalAgent.createdAt || formatTimestamp(),
              role: 'agent',
              agentId: matchedLocalAgent.id,
            };
            await mirrorVerifiedAccountToFallback(acc, params.password);
            restoredWallet = getFallbackWallet(matchedLocalAgent.id, cleanMobile);
            shouldRestoreToServer = true;
          } else {
            const fb = await loginFallbackAccount({
              mobileNumber: cleanMobile,
              password: params.password,
              referredBy: loginRef,
            });
            if (!fb.ok || !fb.account) {
              return { ok: false, error: t.errAuthInvalidCreds };
            }
            acc = fb.account;
            await mirrorVerifiedAccountToFallback(acc, params.password);
            restoredWallet = fb.wallet ?? null;
            shouldRestoreToServer = true;
          }
        } else {
          if (!res.ok || !res.data.account) {
            return { ok: false, error: t.errAuthInvalidCreds };
          }
          acc = res.data.account;
          await mirrorVerifiedAccountToFallback(acc, params.password);
          if (acc.referredBy && acc.role !== 'agent' && acc.role !== 'admin') {
            registerFallbackReferral({
              referrerCode: acc.referredBy,
              inviteeId: acc.userId,
              inviteeName: acc.username,
            });
          }
          if (!isCloudUser) {
            const wRes = await safeFetchJson<{ wallet?: Partial<WalletState> | null }>(
              `/api/wallet/${encodeURIComponent(acc.userId)}?mobile=${encodeURIComponent(
                acc.mobileNumber
              )}`
            );
            const serverWallet =
              wRes.available && wRes.ok && wRes.data.wallet ? wRes.data.wallet : null;
            const localWallet = getFallbackWallet(acc.userId, acc.mobileNumber);
            const mergeResult = mergeRestoredWallets(serverWallet, localWallet);
            restoredWallet = mergeResult.merged;
            shouldPushMergedWalletToServer =
              Boolean(restoredWallet) && (!serverWallet || mergeResult.preferLocalOverServer);
          }
        }

        savePendingRef(null);
        const loginScope = isAdminMobile(acc!.mobileNumber) ? 'admin' : acc!.userId;
        const cachedScopeWithdrawals = readCachedWithdrawals(loginScope);
        const cachedRefs = readCachedReferrals(acc!.userId);
        const finalReferredBy =
          acc!.referredBy ?? restoredWallet?.referredBy ?? loginRef ?? stateRef.current.referredBy;
        const restoredWdrs = Array.isArray(restoredWallet?.withdrawRequests)
          ? restoredWallet.withdrawRequests
          : stateRef.current.withdrawRequests;
        const mergedWdrMap = new Map<string, WithdrawRequest>();
        for (const w of cachedScopeWithdrawals) mergedWdrMap.set(w.id, w);
        for (const w of restoredWdrs) mergedWdrMap.set(w.id, w);

        const restoredRefs = Array.isArray(restoredWallet?.referrals)
          ? restoredWallet.referrals
          : [];
        const mergedRefMap = new Map<string, ReferralRecord>();
        for (const r of cachedRefs) {
          if (r?.inviteeId) mergedRefMap.set(r.inviteeId, r);
        }
        for (const r of restoredRefs) {
          if (!r?.inviteeId) continue;
          const prevR = mergedRefMap.get(r.inviteeId);
          if (!prevR || r.status === 'completed') mergedRefMap.set(r.inviteeId, r);
        }

        const nextLoggedInState: WalletState = {
          ...(restoredWallet ? { ...INITIAL_STATE, ...restoredWallet } : stateRef.current),
          withdrawRequests: Array.from(mergedWdrMap.values()),
          referrals: Array.from(mergedRefMap.values()),
          authAccount: {
            ...acc!,
            referredBy: acc!.referredBy ?? finalReferredBy ?? null,
          },
          referredBy: finalReferredBy,
          profile: {
            ...DEFAULT_PROFILE,
            ...(restoredWallet?.profile ?? stateRef.current.profile),
            userId: isCloudUser ? stateRef.current.profile.userId : acc!.userId,
            username: acc!.username,
            mobileNumber: acc!.mobileNumber,
          },
        };

        setState(nextLoggedInState);

        if (!isCloudUser) {
          saveFallbackWallet(acc!.userId, nextLoggedInState, acc!.mobileNumber);
          if (!isAdminMobile(acc!.mobileNumber)) {
            try {
              window.localStorage.removeItem(ADMIN_USERS_CACHE_KEY);
            } catch {
              // ignore
            }
          }
          if (shouldRestoreToServer) {
            const restorePayload: OutboxAccountRestore = {
              userId: acc!.userId,
              mobileNumber: acc!.mobileNumber,
              username: acc!.username,
              password: params.password,
              referralCode: acc!.referralCode,
              referredBy: finalReferredBy ?? null,
              createdAt: acc!.createdAt,
              wallet: nextLoggedInState,
            };
            const restoreRes = await safeFetchJson<{ ok?: boolean; account?: AuthAccount }>(
              '/api/auth/restore',
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(restorePayload),
              }
            );
            if (restoreRes.available && restoreRes.ok && restoreRes.data.account) {
              await mirrorVerifiedAccountToFallback(
                restoreRes.data.account,
                params.password
              );
            } else if (!restoreRes.available || restoreRes.status >= 500) {
              updateSyncOutbox((ob) => ({
                ...ob,
                accountRestores: [
                  ...ob.accountRestores.filter(
                    (x) =>
                      x.userId !== restorePayload.userId &&
                      normalizeIndianMobile(x.mobileNumber) !==
                        normalizeIndianMobile(restorePayload.mobileNumber)
                  ),
                  restorePayload,
                ],
              }));
              void flushOutboxToServer();
            }
          } else if (shouldPushMergedWalletToServer) {
            const putWalletRes = await safeFetchJson(
              `/api/wallet/${encodeURIComponent(acc!.userId)}`,
              {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ wallet: nextLoggedInState }),
              }
            );
            if (!putWalletRes.available || !putWalletRes.ok) {
              const loggedInAcc = acc!;
              updateSyncOutbox((ob) => ({
                ...ob,
                accountRestores: [
                  ...ob.accountRestores.filter(
                    (x) =>
                      x.userId !== loggedInAcc.userId &&
                      normalizeIndianMobile(x.mobileNumber) !==
                        normalizeIndianMobile(loggedInAcc.mobileNumber)
                  ),
                  {
                    userId: loggedInAcc.userId,
                    mobileNumber: loggedInAcc.mobileNumber,
                    username: loggedInAcc.username,
                    password: params.password,
                    referralCode: loggedInAcc.referralCode,
                    referredBy: finalReferredBy ?? null,
                    createdAt: loggedInAcc.createdAt,
                    wallet: nextLoggedInState,
                  },
                ],
              }));
              void flushOutboxToServer();
            }
          }
        }

        if (isCloudUser && user) {
          const uid = user.uid;
          try {
            await updateDoc(doc(db, 'wallets', uid), {
              username: acc.username.slice(0, 64),
              updatedAt: serverTimestamp(),
            });
            await updateDoc(doc(db, 'wallets', uid, 'private', 'info'), {
              mobileNumber: acc.mobileNumber,
              updatedAt: serverTimestamp(),
            });
          } catch (err) {
            handleFirestoreError(err, OperationType.UPDATE, `wallets/${uid}`);
          }
        }

        void syncAdminUsersFromServer();
        void syncReferralsFromServer();
        void syncSharedOrdersFromServer();
        void syncWithdrawalsFromServer();
        return { ok: true };
      } catch {
        return { ok: false, error: t.errAuthGeneric };
      }
    },
    [
      isCloudUser,
      user,
      syncAdminUsersFromServer,
      syncReferralsFromServer,
      syncSharedOrdersFromServer,
      syncWithdrawalsFromServer,
      t.errInvalidMobile,
      t.errAuthPassword,
      t.errAuthInvalidCreds,
      t.errAuthGeneric,
    ]
  );

  const logoutAccount = useCallback(() => {
    const prevState = stateRef.current;
    if (prevState.authAccount?.userId && !isCloudUser) {
      // Preserve authAccount inside the stored per-user wallet archive so re-login and admin directory retain full metadata
      saveFallbackWallet(
        prevState.authAccount.userId,
        prevState,
        prevState.authAccount.mobileNumber
      );
      void safeFetchJson(
        `/api/wallet/${encodeURIComponent(prevState.authAccount.userId)}`,
        {
          method: 'PUT',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallet: prevState }),
        }
      );
    }
    setAdminUsers([]);
    setUserMessages([]);
    setAdminChatThreads([]);
    try {
      window.localStorage.removeItem(ADMIN_THREADS_CACHE_KEY);
      window.localStorage.removeItem(ADMIN_SUBMISSIONS_CACHE_KEY);
      window.localStorage.removeItem(`${WITHDRAWALS_CACHE_KEY}_admin`);
    } catch {
      // ignore
    }
    const pendingRef = readPendingRef();
    setState({
      ...INITIAL_STATE,
      referredBy: pendingRef,
      authAccount: null,
    });
  }, [isCloudUser]);

  return {
    state,
    adminUsers,
    userMessages,
    adminChatThreads,
    cloudReady,
    registerAccount,
    loginAccount,
    logoutAccount,
    linkPaymentApp,
    unlinkPaymentApp,
    addAdminOrder,
    removeAdminOrder,
    updateDefaultPaymentLink,
    submitOrderPayment,
    approvePendingOrder,
    rejectPendingOrder,
    withdrawFunds,
    approveWithdrawalRequest,
    rejectWithdrawalRequest,
    settlePendingWithdrawal,
    claimDailyBonus,
    updateProfile,
    markNotificationsRead,
    syncReferralsFromServer,
    syncWithdrawalsFromServer,
    syncSharedOrdersFromServer,
    syncAdminUsersFromServer,
    syncUserMessagesFromServer,
    sendUserSupportMessage,
    syncAdminMessagesFromServer,
    sendAdminChatReply,
    markAdminChatRead,
    resetUserPassword,
    resetWallet,
  };
}
