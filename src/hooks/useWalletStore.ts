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
  getFallbackAdminThreads,
  getFallbackAdminUsers,
  getFallbackReferrals,
  getFallbackUserMessages,
  getFallbackWallet,
  getFallbackWithdrawals,
  loginFallbackAccount,
  markFallbackAdminChatRead,
  mirrorVerifiedAccountToFallback,
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
  try {
    const res = await fetch(url, init);
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('application/json')) {
      return { available: false, status: res.status };
    }
    const data = (await res.json()) as T;
    return { available: true, ok: res.ok, status: res.status, data };
  } catch {
    return { available: false, status: 0 };
  }
}

const STORAGE_KEY = 'aurex_vault_wallet_v5';
const PENDING_REF_KEY = 'aurex_vault_pending_ref_v1';

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
    const val = window.localStorage.getItem(PENDING_REF_KEY)?.trim().toUpperCase();
    return val && (val.startsWith('AUREX-') || val.startsWith('AGENT-')) ? val : null;
  } catch {
    return null;
  }
}

function savePendingRef(ref: string | null): void {
  try {
    if (ref && (ref.startsWith('AUREX-') || ref.startsWith('AGENT-'))) {
      window.localStorage.setItem(PENDING_REF_KEY, ref);
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
    const raw =
      params.get('agent') ||
      params.get('ref') ||
      params.get('code') ||
      params.get('invite') ||
      '';
    const ref = raw.trim().toUpperCase();
    if (!ref || (!ref.startsWith('AUREX-') && !ref.startsWith('AGENT-'))) return null;
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

export function useWalletStore(
  lang: Language = 'zh',
  options: UseWalletStoreOptions = {}
) {
  const { user = null, authReady = false, isAdmin = false } = options;
  const [state, setState] = useState<WalletState>(loadInitialState);
  const [adminUsers, setAdminUsers] = useState<AdminUserRecord[]>([]);
  const [userMessages, setUserMessages] = useState<ChatMessage[]>([]);
  const [adminChatThreads, setAdminChatThreads] = useState<AdminChatThread[]>([]);
  const [cloudReady, setCloudReady] = useState(false);
  const t = translations[lang];

  const stateRef = useRef(state);
  stateRef.current = state;

  const templatesRef = useRef<AdminOrder[]>([]);
  const submissionsRef = useRef<CloudSubmissionDoc[]>([]);
  const milestoneSyncLockRef = useRef(false);
  const pendingOrderDecisionRef = useRef<
    Map<string, { status: 'success' | 'rejected'; expiresAt: number }>
  >(new Map());

  const isCloudUser = Boolean(authReady && user);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore storage errors
    }
    const accountId = state.authAccount?.userId;
    const isAdminAccount = isAdminMobile(state.authAccount?.mobileNumber);
    if (accountId && !isCloudUser) {
      saveFallbackWallet(accountId, state);
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
    const myCode = `AUREX-${stateRef.current.profile.userId}`;
    try {
      const res = await safeFetchJson<{ referrals?: ReferralRecord[] }>(
        `/api/referrals/${encodeURIComponent(myCode)}`
      );
      const serverList = res.available
        ? res.ok && Array.isArray(res.data.referrals)
          ? res.data.referrals
          : null
        : getFallbackReferrals(myCode);
      if (!serverList) return;
      setState((prev) => {
        const completedCount = serverList.filter(
          (r) => r.status === 'completed'
        ).length;
        const totalMilestonesEarned = Math.floor(completedCount / 5);
        const newMilestones = Math.max(
          0,
          totalMilestonesEarned - prev.referralMilestonesPaid
        );

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
            referrals: serverList,
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
          referrals: serverList,
        };
      });
    } catch {
      // Ignore network errors cleanly
    }
  }, [isCloudUser]);

  const syncWithdrawalsFromServer = useCallback(async () => {
    try {
      const currentMobile = stateRef.current.authAccount?.mobileNumber || '';
      const currentUserId =
        stateRef.current.authAccount?.userId || stateRef.current.profile.userId;
      const res = await safeFetchJson<{ withdrawals?: WithdrawRequest[] }>(
        `/api/withdrawals?userId=${encodeURIComponent(currentUserId)}`,
        {
          headers: currentMobile ? { 'x-admin-mobile': currentMobile } : {},
        }
      );
      const serverList = res.available
        ? res.ok && Array.isArray(res.data.withdrawals)
          ? res.data.withdrawals
          : null
        : getFallbackWithdrawals(currentUserId, isAdminMobile(currentMobile));
      if (!serverList) return;

      setState((prev) => {
        const myUserId = prev.authAccount?.userId || prev.profile.userId;
        let nextBalance = prev.walletBalance;
        let nextTotalWithdrawal = prev.totalWithdrawal;
        const extraNotifs: AppNotification[] = [];

        const nextTransactions = prev.transactions.map((tx) => {
          if (tx.type !== 'withdrawal' || tx.status !== 'Pending') return tx;
          const matched = serverList.find(
            (w) => w.txId === tx.id && w.userId === myUserId
          );
          if (!matched || matched.status === 'Pending') return tx;

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

        return {
          ...prev,
          walletBalance: nextBalance,
          totalWithdrawal: nextTotalWithdrawal,
          withdrawRequests: serverList,
          transactions: nextTransactions,
          notifications:
            extraNotifs.length > 0
              ? [...extraNotifs, ...prev.notifications]
              : prev.notifications,
        };
      });
    } catch {
      // Ignore network errors cleanly
    }
  }, []);

  const syncAdminUsersFromServer = useCallback(async () => {
    const currentMobile = stateRef.current.authAccount?.mobileNumber || '';
    if (!isAdminMobile(currentMobile)) {
      setAdminUsers([]);
      return;
    }
    try {
      const res = await safeFetchJson<{ users?: AdminUserRecord[] }>(
        '/api/admin/users',
        {
          headers: { 'x-admin-mobile': currentMobile },
        }
      );
      if (!res.available) {
        setAdminUsers(await getFallbackAdminUsers());
        return;
      }
      if (!res.ok) return;
      if (Array.isArray(res.data.users)) {
        setAdminUsers(res.data.users);
      }
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
          await syncAdminUsersFromServer();
          return { ok: true };
        }
        if (!res.ok) {
          return { ok: false, error: t.errAuthGeneric };
        }
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
      const qs = markRead ? '?markRead=1' : '';
      const res = await safeFetchJson<{ messages?: ChatMessage[] }>(
        `/api/messages/${encodeURIComponent(uid)}${qs}`
      );
      if (!res.available) {
        setUserMessages(getFallbackUserMessages(uid, markRead));
        return;
      }
      if (!res.ok) return;
      if (Array.isArray(res.data.messages)) {
        setUserMessages(res.data.messages);
      }
    } catch {
      // Ignore network errors cleanly
    }
  }, []);

  const syncAdminMessagesFromServer = useCallback(async () => {
    const currentMobile = stateRef.current.authAccount?.mobileNumber || '';
    if (!isAdminMobile(currentMobile)) {
      setAdminChatThreads([]);
      return;
    }
    try {
      const res = await safeFetchJson<{ threads?: AdminChatThread[] }>(
        '/api/admin/messages',
        {
          headers: { 'x-admin-mobile': currentMobile },
        }
      );
      if (!res.available) {
        setAdminChatThreads(await getFallbackAdminThreads());
        return;
      }
      if (!res.ok) return;
      if (Array.isArray(res.data.threads)) {
        setAdminChatThreads(res.data.threads);
      }
    } catch {
      // Ignore network errors cleanly
    }
  }, []);

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
      try {
        const res = await safeFetchJson<{ message?: ChatMessage }>(
          '/api/messages',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: uid,
              username: uname,
              mobileNumber: umobile,
              text: clean,
              ...(imageData ? { imageData } : {}),
            }),
          }
        );
        if (!res.available) {
          const fbMsg = sendFallbackUserMessage({
            userId: uid,
            username: uname,
            mobileNumber: umobile,
            text: clean,
            imageData,
          });
          setUserMessages((prev) => [...prev, fbMsg]);
          if (isAdminMobile(umobile)) {
            void syncAdminMessagesFromServer();
          }
          return { ok: true };
        }
        if (!res.ok) return { ok: false, error: t.errAuthGeneric };
        if (res.data.message) {
          setUserMessages((prev) => [...prev, res.data.message!]);
        } else {
          await syncUserMessagesFromServer();
        }
        if (isAdminMobile(umobile)) {
          void syncAdminMessagesFromServer();
        }
        return { ok: true };
      } catch {
        return { ok: false, error: t.errAuthGeneric };
      }
    },
    [syncAdminMessagesFromServer, syncUserMessagesFromServer, t.errAuthGeneric]
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
      try {
        const res = await safeFetchJson<{ ok?: boolean }>(
          `/api/admin/messages/${encodeURIComponent(targetUserId)}/reply`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-admin-mobile': currentMobile,
            },
            body: JSON.stringify({
              text: clean,
              ...(imageData ? { imageData } : {}),
            }),
          }
        );
        if (!res.available) {
          await sendFallbackAdminReply(targetUserId, clean, imageData);
          await syncAdminMessagesFromServer();
          if (
            targetUserId ===
            (stateRef.current.authAccount?.userId || stateRef.current.profile.userId)
          ) {
            void syncUserMessagesFromServer();
          }
          return { ok: true };
        }
        if (!res.ok) return { ok: false, error: t.errAuthGeneric };
        await syncAdminMessagesFromServer();
        if (
          targetUserId ===
          (stateRef.current.authAccount?.userId || stateRef.current.profile.userId)
        ) {
          void syncUserMessagesFromServer();
        }
        return { ok: true };
      } catch {
        return { ok: false, error: t.errAuthGeneric };
      }
    },
    [syncAdminMessagesFromServer, syncUserMessagesFromServer, t.errAuthGeneric]
  );

  const markAdminChatRead = useCallback(async (targetUserId: string) => {
    const currentMobile = stateRef.current.authAccount?.mobileNumber || '';
    if (!isAdminMobile(currentMobile) || !targetUserId) return;
    setAdminChatThreads((prev) =>
      prev.map((th) =>
        th.userId === targetUserId ? { ...th, unreadCount: 0 } : th
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

      interface ServerSub {
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

      let adminSubmissions: ServerSub[] = [];
      let userSubmissions: ServerSub[] = [];

      if (isAdminMobile(currentMobile)) {
        const subRes = await safeFetchJson<{ submissions?: ServerSub[] }>(
          '/api/admin/order-submissions',
          { headers: { 'x-admin-mobile': currentMobile } }
        );
        if (subRes.available && subRes.ok && Array.isArray(subRes.data.submissions)) {
          adminSubmissions = subRes.data.submissions;
        }
      } else if (currentUid) {
        const subRes = await safeFetchJson<{ submissions?: ServerSub[] }>(
          `/api/order-submissions/user/${encodeURIComponent(currentUid)}`
        );
        if (subRes.available && subRes.ok && Array.isArray(subRes.data.submissions)) {
          userSubmissions = subRes.data.submissions;
        }
      }

      setState((prev) => {
        let nextOrders = [...prev.adminOrders];
        let changed = false;

        const existingIds = new Set(nextOrders.map((o) => o.id));
        const missingTemplates = normalizedOrders.filter((o) => !existingIds.has(o.id));
        if (missingTemplates.length > 0) {
          nextOrders = [...missingTemplates, ...nextOrders];
          changed = true;
        }

        // Admin: merge cross-device user payment submissions
        const nowMs = Date.now();
        for (const sub of adminSubmissions) {
          const decision =
            pendingOrderDecisionRef.current.get(sub.id) ||
            pendingOrderDecisionRef.current.get(sub.orderId);
          if (decision && (decision.status === sub.status || decision.expiresAt <= nowMs)) {
            pendingOrderDecisionRef.current.delete(sub.id);
            pendingOrderDecisionRef.current.delete(sub.orderId);
          }
          const effectiveStatus =
            decision && decision.expiresAt > nowMs && decision.status !== sub.status
              ? decision.status
              : sub.status;

          const idx = nextOrders.findIndex(
            (o) => o.submissionId === sub.id || o.id === sub.id
          );
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

        // User: reflect Admin's remote approval/rejection onto user's wallet & orders
        let walletBalance = prev.walletBalance;
        let totalPaid = prev.totalPaid;
        let totalCashbackEarned = prev.totalCashbackEarned;
        let completedOrdersCount = prev.completedOrdersCount;
        let nextTransactions = prev.transactions;
        let nextNotifications = prev.notifications;

        for (const sub of userSubmissions) {
          const orderIdx = nextOrders.findIndex(
            (o) => o.submissionId === sub.id || o.id === sub.id || (o.id === sub.orderId && o.status === 'pending')
          );
          if (orderIdx !== -1 && nextOrders[orderIdx].status === 'pending' && sub.status !== 'pending') {
            const target = nextOrders[orderIdx];
            nextOrders[orderIdx] = { ...target, status: sub.status };
            changed = true;

            if (sub.status === 'success') {
              const { principal, commission, totalReturn } = calculateCommission(sub.amount);
              walletBalance = roundCurrency(walletBalance + totalReturn);
              totalPaid = roundCurrency(totalPaid + principal);
              totalCashbackEarned = roundCurrency(totalCashbackEarned + commission);
              completedOrdersCount += 1;
              nextTransactions = nextTransactions.map((tx) =>
                (tx.orderId === target.id || tx.orderId === sub.orderId || tx.orderId === sub.id) &&
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
              );
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
            } else if (sub.status === 'rejected') {
              nextTransactions = nextTransactions.map((tx) =>
                (tx.orderId === target.id || tx.orderId === sub.orderId || tx.orderId === sub.id) &&
                tx.status === 'Pending'
                  ? {
                      ...tx,
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
            }
          }
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
  }, [isCloudUser]);

  const syncAuthSessionFromServer = useCallback(async () => {
    if (isCloudUser) return;
    const curr = stateRef.current.authAccount;
    if (!curr) return;
    try {
      const qs = new URLSearchParams();
      if (curr.mobileNumber) qs.set('mobile', curr.mobileNumber);
      if (curr.userId) qs.set('userId', curr.userId);
      const res = await safeFetchJson<{ ok?: boolean; account?: AuthAccount }>(
        `/api/auth/session?${qs.toString()}`
      );
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
    syncAuthSessionFromServer();
    syncReferralsFromServer();
    syncWithdrawalsFromServer();
    syncAdminUsersFromServer();
    syncUserMessagesFromServer();
    syncAdminMessagesFromServer();
    syncSharedOrdersFromServer();
    const interval = setInterval(() => {
      syncAuthSessionFromServer();
      syncReferralsFromServer();
      syncWithdrawalsFromServer();
      syncAdminUsersFromServer();
      syncUserMessagesFromServer();
      syncAdminMessagesFromServer();
      syncSharedOrdersFromServer();
    }, 5000);
    const onFocus = () => {
      syncAuthSessionFromServer();
      syncReferralsFromServer();
      syncWithdrawalsFromServer();
      syncAdminUsersFromServer();
      syncUserMessagesFromServer();
      syncAdminMessagesFromServer();
      syncSharedOrdersFromServer();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [
    isCloudUser,
    state.authAccount?.userId,
    state.authAccount?.mobileNumber,
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
      } else if (stateRef.current.referredBy) {
        const refPayload = {
          referrerCode: stateRef.current.referredBy,
          inviteeId: stateRef.current.profile.userId,
          inviteeName: stateRef.current.profile.username,
        };
        registerFallbackReferral(refPayload);
        void safeFetchJson('/api/referrals/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(refPayload),
        });
      }

      return { ok: true };
    },
    [
      isCloudUser,
      user,
      ensureCloudReferralRegistered,
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
          void safeFetchJson('/api/orders', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-admin-mobile': currentMobile,
            },
            body: JSON.stringify(newOrder),
          });
        }
      }

      return { ok: true, order: newOrder };
    },
    [isCloudUser, user, t.errMinOrder]
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

      setState((prev) => ({
        ...prev,
        adminOrders: prev.adminOrders.filter((o) => o.id !== orderId),
      }));

      const currentMobile = stateRef.current.authAccount?.mobileNumber || '';
      if (isAdminMobile(currentMobile)) {
        void safeFetchJson(`/api/orders/${encodeURIComponent(orderId)}`, {
          method: 'DELETE',
          headers: {
            'x-admin-mobile': currentMobile,
          },
        });
      }
    },
    [isCloudUser, user]
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

        saveFallbackOrderSubmission({
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
          status: 'pending',
          paidAt: now,
          createdAt: now,
        });

        void safeFetchJson('/api/order-submissions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
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
          }),
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
      const decisionExpiresAt = Date.now() + 15000;
      pendingOrderDecisionRef.current.set(orderOrSubmissionId, {
        status: 'success',
        expiresAt: decisionExpiresAt,
      });
      if (targetOrderForSync?.submissionId) {
        pendingOrderDecisionRef.current.set(targetOrderForSync.submissionId, {
          status: 'success',
          expiresAt: decisionExpiresAt,
        });
      }
      updateFallbackOrderSubmissionStatus(orderOrSubmissionId, 'success');

      if (isAdminMobile(currentMobile)) {
        void safeFetchJson(
          `/api/admin/order-submissions/${encodeURIComponent(orderOrSubmissionId)}/status`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-admin-mobile': currentMobile,
            },
            body: JSON.stringify({ status: 'success' }),
          }
        ).then(() => {
          void syncSharedOrdersFromServer();
        });
      }

      const refOwnerCode = targetOrderForSync?.referredBy || stateRef.current.referredBy;
      const refUserUid = targetOrderForSync?.userUid || stateRef.current.profile.userId;
      if (refOwnerCode && refUserUid) {
        completeFallbackReferral(refUserUid, refOwnerCode);
        void safeFetchJson('/api/referrals/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            referrerCode: refOwnerCode,
            inviteeId: refUserUid,
          }),
        });
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
      const rejectExpiresAt = Date.now() + 15000;
      pendingOrderDecisionRef.current.set(orderOrSubmissionId, {
        status: 'rejected',
        expiresAt: rejectExpiresAt,
      });
      if (targetOrderForReject?.submissionId) {
        pendingOrderDecisionRef.current.set(targetOrderForReject.submissionId, {
          status: 'rejected',
          expiresAt: rejectExpiresAt,
        });
      }
      updateFallbackOrderSubmissionStatus(orderOrSubmissionId, 'rejected');

      if (isAdminMobile(currentMobile)) {
        void safeFetchJson(
          `/api/admin/order-submissions/${encodeURIComponent(orderOrSubmissionId)}/status`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-admin-mobile': currentMobile,
            },
            body: JSON.stringify({ status: 'rejected' }),
          }
        ).then(() => {
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
        void safeFetchJson('/api/withdrawals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(withdrawRequest),
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

    updateFallbackWithdrawalStatus(withdrawalId, 'Success');
    void safeFetchJson(`/api/withdrawals/${encodeURIComponent(withdrawalId)}/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-mobile': currentMobile,
      },
      body: JSON.stringify({ status: 'Success' }),
    });
  }, []);

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

    updateFallbackWithdrawalStatus(withdrawalId, 'Rejected');
    void safeFetchJson(`/api/withdrawals/${encodeURIComponent(withdrawalId)}/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-mobile': currentMobile,
      },
      body: JSON.stringify({ status: 'Rejected' }),
    });
  }, []);

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
      const cleanMobile = params.mobileNumber.replace(/\D/g, '');
      const cleanUsername = params.username.trim();
      const cleanRef = params.referralCode?.trim().toUpperCase() || '';

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
        const res = await safeFetchJson<{
          ok?: boolean;
          error?: string;
          account?: AuthAccount;
          existingWallet?: Partial<WalletState> | null;
        }>('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mobileNumber: cleanMobile,
            username: cleanUsername,
            password: params.password,
            confirmPassword: params.confirmPassword,
            referralCode: cleanRef,
          }),
        });

        let acc: AuthAccount | undefined;
        let legacy: Partial<WalletState> | null | undefined;
        let errorCode: string | undefined;

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
          saveFallbackWallet(acc.userId, freshState);
          await safeFetchJson(`/api/wallet/${encodeURIComponent(acc.userId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wallet: freshState }),
          });
        }
        void syncAdminUsersFromServer();

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
      const cleanMobile = params.mobileNumber.replace(/\D/g, '');
      if (cleanMobile.length !== 10) {
        return { ok: false, error: t.errInvalidMobile };
      }
      if (params.password.length < 6) {
        return { ok: false, error: t.errAuthPassword };
      }

      const loginRef = stateRef.current.referredBy || readPendingRef();

      try {
        const res = await safeFetchJson<{
          ok?: boolean;
          error?: string;
          ephemeralMissing?: boolean;
          account?: AuthAccount;
        }>('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mobileNumber: cleanMobile,
            password: params.password,
            ...(loginRef ? { referredBy: loginRef } : {}),
          }),
        });

        let acc: AuthAccount | undefined;
        let restoredWallet: Partial<WalletState> | null = null;

        if (!res.available || (!res.ok && res.data?.ephemeralMissing)) {
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
            restoredWallet = getFallbackWallet(matchedLocalAgent.id);
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
            restoredWallet = fb.wallet ?? null;
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
              `/api/wallet/${encodeURIComponent(acc.userId)}`
            );
            if (wRes.available && wRes.ok && wRes.data.wallet) {
              restoredWallet = wRes.data.wallet;
            } else {
              restoredWallet = getFallbackWallet(acc.userId);
            }
          }
        }

        savePendingRef(null);
        setState((prev) => {
          const finalReferredBy =
            acc!.referredBy ?? restoredWallet?.referredBy ?? loginRef ?? prev.referredBy;
          return {
            ...(restoredWallet ? { ...INITIAL_STATE, ...restoredWallet } : prev),
            authAccount: {
              ...acc!,
              referredBy: acc!.referredBy ?? finalReferredBy ?? null,
            },
            referredBy: finalReferredBy,
            profile: {
              ...DEFAULT_PROFILE,
              ...(restoredWallet?.profile ?? prev.profile),
              userId: isCloudUser ? prev.profile.userId : acc!.userId,
              username: acc!.username,
              mobileNumber: acc!.mobileNumber,
            },
          };
        });

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
        return { ok: true };
      } catch {
        return { ok: false, error: t.errAuthGeneric };
      }
    },
    [
      isCloudUser,
      user,
      syncAdminUsersFromServer,
      t.errInvalidMobile,
      t.errAuthPassword,
      t.errAuthInvalidCreds,
      t.errAuthGeneric,
    ]
  );

  const logoutAccount = useCallback(() => {
    const prevState = stateRef.current;
    if (prevState.authAccount?.userId && !isCloudUser) {
      const cleanedState = { ...prevState, authAccount: null };
      saveFallbackWallet(prevState.authAccount.userId, cleanedState);
      void safeFetchJson(
        `/api/wallet/${encodeURIComponent(prevState.authAccount.userId)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallet: cleanedState }),
        }
      );
    }
    setAdminUsers([]);
    setUserMessages([]);
    setAdminChatThreads([]);
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
