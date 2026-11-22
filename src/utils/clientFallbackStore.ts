import {
  AdminChatThread,
  AdminUserRecord,
  AuthAccount,
  ChatMessage,
  ReferralRecord,
  WalletState,
  WithdrawRequest,
} from '../types/wallet';
import {
  ADMIN_MOBILE_NUMBER,
  formatTimestamp,
  normalizeIndianMobile,
} from './formatters';

const FALLBACK_ACCOUNTS_KEY = 'aurex_vault_fb_accounts_v1';
const FALLBACK_WALLETS_KEY = 'aurex_vault_fb_wallets_v1';
const FALLBACK_WITHDRAWALS_KEY = 'aurex_vault_fb_withdrawals_v1';
const FALLBACK_REFERRALS_KEY = 'aurex_vault_fb_referrals_v1';
const FALLBACK_MESSAGES_KEY = 'aurex_vault_fb_messages_v1';
const FALLBACK_SUBMISSIONS_KEY = 'aurex_vault_fb_submissions_v1';

interface FallbackStoredAccount {
  userId: string;
  mobileNumber: string;
  username: string;
  passwordDigest: string;
  referredBy: string | null;
  referralCode: string;
  createdAt: string;
  role?: 'admin' | 'agent' | 'user';
  agentId?: string;
}

interface FallbackStoredReferral extends ReferralRecord {
  referrerCode: string;
}

const DEFAULT_ADMIN_SEED_USER_ID = '882836';
const DEFAULT_ADMIN_SEED_PASS = 'raja890';

function safeReadJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeWriteJson<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota errors
  }
}

async function digestPassword(password: string, salt: string): Promise<string> {
  const input = `${salt}:${password}`;
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const encoded = new TextEncoder().encode(input);
      const buf = await crypto.subtle.digest('SHA-256', encoded);
      const hex = Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      return `${salt}:${hex}`;
    } catch {
      // Fallback below
    }
  }
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x85ebca6b);
  }
  return `${salt}:${(h1 >>> 0).toString(16)}-${(h2 >>> 0).toString(16)}`;
}

function randomSalt(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function verifyDigest(password: string, stored: string): Promise<boolean> {
  const idx = stored.indexOf(':');
  if (idx <= 0) return false;
  const salt = stored.slice(0, idx);
  const recomputed = await digestPassword(password, salt);
  return recomputed === stored;
}

function generateFallbackUserId(existingIds: Set<string>): string {
  let candidate = String(Math.floor(100000 + Math.random() * 899999));
  while (existingIds.has(candidate) || candidate === '415061') {
    candidate = String(Math.floor(100000 + Math.random() * 899999));
  }
  return candidate;
}

async function ensureFallbackAdminSeeded(): Promise<FallbackStoredAccount[]> {
  const accounts = safeReadJson<FallbackStoredAccount[]>(
    FALLBACK_ACCOUNTS_KEY,
    []
  );
  if (
    accounts.some(
      (a) => normalizeIndianMobile(a.mobileNumber) === ADMIN_MOBILE_NUMBER
    )
  ) {
    return accounts;
  }

  const digest = await digestPassword(
    DEFAULT_ADMIN_SEED_PASS,
    `seed-${ADMIN_MOBILE_NUMBER}`
  );
  const seeded: FallbackStoredAccount = {
    userId: DEFAULT_ADMIN_SEED_USER_ID,
    mobileNumber: ADMIN_MOBILE_NUMBER,
    username: 'User_25',
    passwordDigest: digest,
    referredBy: null,
    referralCode: `AUREX-${DEFAULT_ADMIN_SEED_USER_ID}`,
    createdAt: formatTimestamp(),
  };
  const next = [seeded, ...accounts];
  safeWriteJson(FALLBACK_ACCOUNTS_KEY, next);
  return next;
}

export async function mirrorVerifiedAccountToFallback(
  account: AuthAccount,
  rawPassword?: string
): Promise<void> {
  const accounts = await ensureFallbackAdminSeeded();
  const cleanMobile = normalizeIndianMobile(account.mobileNumber);
  const idx = accounts.findIndex(
    (a) =>
      a.userId === account.userId ||
      normalizeIndianMobile(a.mobileNumber) === cleanMobile
  );

  const passwordDigest = rawPassword
    ? await digestPassword(rawPassword, randomSalt())
    : idx >= 0
    ? accounts[idx].passwordDigest
    : '';

  const updatedRecord: FallbackStoredAccount = {
    userId: account.userId,
    mobileNumber: cleanMobile || account.mobileNumber,
    username: account.username,
    passwordDigest,
    referredBy: account.referredBy,
    referralCode: account.referralCode,
    createdAt: account.createdAt,
    ...(account.role ? { role: account.role } : {}),
    ...(account.agentId ? { agentId: account.agentId } : {}),
  };

  if (idx >= 0) {
    accounts[idx] = updatedRecord;
  } else {
    accounts.unshift(updatedRecord);
  }
  safeWriteJson(FALLBACK_ACCOUNTS_KEY, accounts);
}

export async function registerFallbackAccount(params: {
  mobileNumber: string;
  username: string;
  password: string;
  confirmPassword: string;
  referralCode?: string;
}): Promise<{
  ok: boolean;
  errorCode?: string;
  account?: AuthAccount;
  existingWallet?: Partial<WalletState> | null;
}> {
  const mobileNumber = normalizeIndianMobile(params.mobileNumber);
  const username = params.username.trim().slice(0, 64);
  const password = params.password;
  const confirmPassword = params.confirmPassword;
  const rawRef = (params.referralCode || '').trim().toUpperCase();

  if (mobileNumber.length !== 10) return { ok: false, errorCode: 'INVALID_MOBILE' };
  if (username.length < 2) return { ok: false, errorCode: 'INVALID_USERNAME' };
  if (password.length < 6) return { ok: false, errorCode: 'INVALID_PASSWORD' };
  if (password !== confirmPassword) {
    return { ok: false, errorCode: 'PASSWORD_MISMATCH' };
  }

  const accounts = await ensureFallbackAdminSeeded();
  if (accounts.some((a) => normalizeIndianMobile(a.mobileNumber) === mobileNumber)) {
    return { ok: false, errorCode: 'MOBILE_EXISTS' };
  }

  const wallets = safeReadJson<Record<string, Partial<WalletState>>>(
    FALLBACK_WALLETS_KEY,
    {}
  );
  const existingIds = new Set([
    ...accounts.map((a) => a.userId),
    ...Object.keys(wallets),
  ]);
  const userId = generateFallbackUserId(existingIds);
  const ownReferralCode = `AUREX-${userId}`;

  if (rawRef && rawRef === ownReferralCode) {
    return { ok: false, errorCode: 'SELF_REFERRAL' };
  }

  const referredBy = rawRef ? rawRef.slice(0, 32) : null;
  const now = formatTimestamp();
  const passwordDigest = await digestPassword(password, randomSalt());

  const stored: FallbackStoredAccount = {
    userId,
    mobileNumber,
    username,
    passwordDigest,
    referredBy,
    referralCode: ownReferralCode,
    createdAt: now,
  };
  accounts.unshift(stored);
  safeWriteJson(FALLBACK_ACCOUNTS_KEY, accounts);

  if (referredBy) {
    registerFallbackReferral({
      referrerCode: referredBy,
      inviteeId: userId,
      inviteeName: username,
    });
  }

  return {
    ok: true,
    account: {
      userId: stored.userId,
      mobileNumber: stored.mobileNumber,
      username: stored.username,
      referredBy: stored.referredBy,
      referralCode: stored.referralCode,
      createdAt: stored.createdAt,
    },
    existingWallet: wallets[userId] ?? null,
  };
}

export async function loginFallbackAccount(params: {
  mobileNumber: string;
  password: string;
  referredBy?: string | null;
}): Promise<{
  ok: boolean;
  errorCode?: string;
  account?: AuthAccount;
  wallet?: Partial<WalletState> | null;
}> {
  const mobileNumber = normalizeIndianMobile(params.mobileNumber);
  const password = params.password;
  const loginReferredBy = params.referredBy
    ? params.referredBy.trim().toUpperCase().slice(0, 32)
    : null;

  if (mobileNumber.length !== 10 || password.length < 6) {
    return { ok: false, errorCode: 'INVALID_CREDENTIALS' };
  }

  const accounts = await ensureFallbackAdminSeeded();
  const foundIdx = accounts.findIndex(
    (a) => normalizeIndianMobile(a.mobileNumber) === mobileNumber
  );
  if (foundIdx === -1) {
    return { ok: false, errorCode: 'INVALID_CREDENTIALS' };
  }
  const found = accounts[foundIdx];

  const valid = await verifyDigest(password, found.passwordDigest);
  if (!valid) {
    return { ok: false, errorCode: 'INVALID_CREDENTIALS' };
  }

  let effectiveReferredBy = found.referredBy;
  if (
    found.role !== 'agent' &&
    normalizeIndianMobile(found.mobileNumber) !== ADMIN_MOBILE_NUMBER &&
    loginReferredBy &&
    loginReferredBy !== found.referralCode
  ) {
    if (!effectiveReferredBy) {
      effectiveReferredBy = loginReferredBy;
      accounts[foundIdx] = { ...found, referredBy: loginReferredBy };
      safeWriteJson(FALLBACK_ACCOUNTS_KEY, accounts);
    }
    registerFallbackReferral({
      referrerCode: loginReferredBy,
      inviteeId: found.userId,
      inviteeName: found.username,
    });
  }

  const wallets = safeReadJson<Record<string, Partial<WalletState>>>(
    FALLBACK_WALLETS_KEY,
    {}
  );

  return {
    ok: true,
    account: {
      userId: found.userId,
      mobileNumber: found.mobileNumber,
      username: found.username,
      referredBy: effectiveReferredBy,
      referralCode: found.referralCode,
      createdAt: found.createdAt,
      ...(found.role ? { role: found.role } : {}),
      ...(found.agentId ? { agentId: found.agentId } : {}),
    },
    wallet: wallets[found.userId] ?? null,
  };
}

export function getFallbackWallet(userId: string): Partial<WalletState> | null {
  const wallets = safeReadJson<Record<string, Partial<WalletState>>>(
    FALLBACK_WALLETS_KEY,
    {}
  );
  return wallets[userId] ?? null;
}

export function saveFallbackWallet(userId: string, wallet: WalletState): void {
  if (!userId) return;
  const wallets = safeReadJson<Record<string, Partial<WalletState>>>(
    FALLBACK_WALLETS_KEY,
    {}
  );
  wallets[userId] = wallet;
  safeWriteJson(FALLBACK_WALLETS_KEY, wallets);
}

export function getFallbackWithdrawals(
  userId: string,
  isAdmin: boolean
): WithdrawRequest[] {
  const all = safeReadJson<WithdrawRequest[]>(FALLBACK_WITHDRAWALS_KEY, []);
  if (isAdmin) return all;
  return userId
    ? all.filter((w) => w.userId === userId || w.agentId === userId)
    : [];
}

export function saveFallbackWithdrawal(record: WithdrawRequest): void {
  const all = safeReadJson<WithdrawRequest[]>(FALLBACK_WITHDRAWALS_KEY, []);
  if (all.some((w) => w.id === record.id)) return;
  all.unshift(record);
  safeWriteJson(FALLBACK_WITHDRAWALS_KEY, all);
}

export function updateFallbackWithdrawalStatus(
  id: string,
  status: 'Success' | 'Rejected'
): void {
  const all = safeReadJson<WithdrawRequest[]>(FALLBACK_WITHDRAWALS_KEY, []);
  const now = formatTimestamp();
  const next = all.map((w) =>
    w.id === id && w.status === 'Pending'
      ? { ...w, status, processedAt: now }
      : w
  );
  safeWriteJson(FALLBACK_WITHDRAWALS_KEY, next);
}

export function getFallbackReferrals(referrerCode: string): ReferralRecord[] {
  const clean = referrerCode.trim().toUpperCase();
  const all = safeReadJson<FallbackStoredReferral[]>(FALLBACK_REFERRALS_KEY, []);
  return all.filter((r) => r.referrerCode === clean);
}

export function registerFallbackReferral(params: {
  referrerCode: string;
  inviteeId: string;
  inviteeName: string;
}): void {
  const referrerCode = params.referrerCode.trim().toUpperCase();
  if (!referrerCode || !params.inviteeId) return;
  if (referrerCode === `AUREX-${params.inviteeId}`) return;
  const all = safeReadJson<FallbackStoredReferral[]>(FALLBACK_REFERRALS_KEY, []);
  if (
    all.some(
      (r) => r.referrerCode === referrerCode && r.inviteeId === params.inviteeId
    )
  ) {
    return;
  }
  all.unshift({
    id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    referrerCode,
    inviteeId: params.inviteeId,
    inviteeName: params.inviteeName || `User_${params.inviteeId.slice(-2)}`,
    codeUsed: referrerCode,
    registeredAt: formatTimestamp(),
    status: 'registered',
  });
  safeWriteJson(FALLBACK_REFERRALS_KEY, all);
}

export function completeFallbackReferral(
  inviteeId: string,
  referrerCode?: string | null
): void {
  const all = safeReadJson<FallbackStoredReferral[]>(FALLBACK_REFERRALS_KEY, []);
  const cleanCode = referrerCode ? referrerCode.trim().toUpperCase() : null;
  const now = formatTimestamp();
  const next = all.map((r) => {
    const matchCode = cleanCode ? r.referrerCode === cleanCode : true;
    if (matchCode && r.inviteeId === inviteeId && r.status === 'registered') {
      return { ...r, status: 'completed' as const, completedAt: now };
    }
    return r;
  });
  safeWriteJson(FALLBACK_REFERRALS_KEY, next);
}

export async function getFallbackAdminUsers(): Promise<AdminUserRecord[]> {
  const accounts = await ensureFallbackAdminSeeded();
  const wallets = safeReadJson<Record<string, Partial<WalletState>>>(
    FALLBACK_WALLETS_KEY,
    {}
  );
  return accounts.map((acc) => {
    const w = wallets[acc.userId];
    return {
      userId: acc.userId,
      mobileNumber: acc.mobileNumber,
      username: acc.username,
      hasPassword: Boolean(acc.passwordDigest),
      referralCode: acc.referralCode,
      referredBy: acc.referredBy,
      createdAt: acc.createdAt,
      walletBalance: w ? Number(w.walletBalance ?? 0) : 0,
      totalPaid: w ? Number(w.totalPaid ?? 0) : 0,
      totalWithdrawal: w ? Number(w.totalWithdrawal ?? 0) : 0,
      linkedAppName: w?.linkedPaymentApp?.appName,
      upiId: w?.profile?.upiId,
    };
  });
}

export async function resetFallbackUserPassword(
  userId: string,
  newPassword: string
): Promise<boolean> {
  if (!userId || newPassword.length < 6) return false;
  const accounts = await ensureFallbackAdminSeeded();
  const idx = accounts.findIndex((a) => a.userId === userId);
  if (idx === -1) return false;
  const passwordDigest = await digestPassword(newPassword, randomSalt());
  accounts[idx] = { ...accounts[idx], passwordDigest };
  safeWriteJson(FALLBACK_ACCOUNTS_KEY, accounts);
  return true;
}

export function getFallbackUserMessages(
  userId: string,
  markRead = false
): ChatMessage[] {
  const all = safeReadJson<ChatMessage[]>(FALLBACK_MESSAGES_KEY, []);
  let changed = false;
  const nextAll = all.map((m) => {
    if (markRead && m.userId === userId && m.sender === 'agent' && !m.readByUser) {
      changed = true;
      return { ...m, readByUser: true };
    }
    return m;
  });
  if (changed) {
    safeWriteJson(FALLBACK_MESSAGES_KEY, nextAll);
  }
  return nextAll.filter((m) => m.userId === userId);
}

export function sendFallbackUserMessage(params: {
  userId: string;
  username: string;
  mobileNumber: string;
  text: string;
  imageData?: string;
}): ChatMessage {
  const all = safeReadJson<ChatMessage[]>(FALLBACK_MESSAGES_KEY, []);
  const msg: ChatMessage = {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    userId: params.userId,
    username: params.username || 'User',
    mobileNumber: normalizeIndianMobile(params.mobileNumber) || '—',
    sender: 'user',
    text: params.text.trim().slice(0, 1000),
    ...(params.imageData ? { imageUrl: params.imageData } : {}),
    createdAt: formatTimestamp(),
    readByAdmin: false,
    readByUser: true,
  };
  all.push(msg);
  safeWriteJson(FALLBACK_MESSAGES_KEY, all);
  return msg;
}

export async function getFallbackAdminThreads(): Promise<AdminChatThread[]> {
  const accounts = await ensureFallbackAdminSeeded();
  const allMessages = safeReadJson<ChatMessage[]>(FALLBACK_MESSAGES_KEY, []);
  const map = new Map<string, AdminChatThread>();

  for (const acc of accounts) {
    map.set(acc.userId, {
      userId: acc.userId,
      username: acc.username,
      mobileNumber: acc.mobileNumber,
      referralCode: acc.referralCode,
      unreadCount: 0,
      messages: [],
    });
  }

  for (const msg of allMessages) {
    let thread = map.get(msg.userId);
    if (!thread) {
      thread = {
        userId: msg.userId,
        username: msg.username || `User_${msg.userId.slice(-2)}`,
        mobileNumber: msg.mobileNumber || '—',
        referralCode: `AUREX-${msg.userId}`,
        unreadCount: 0,
        messages: [],
      };
      map.set(msg.userId, thread);
    }
    thread.messages.push(msg);
    thread.lastMessage = msg.text || (msg.imageUrl ? '📷 Photo' : '');
    thread.lastTime = msg.createdAt;
    if (msg.sender === 'user' && !msg.readByAdmin) {
      thread.unreadCount += 1;
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    if (a.lastTime && b.lastTime) return b.lastTime.localeCompare(a.lastTime);
    if (a.lastTime) return -1;
    if (b.lastTime) return 1;
    return a.username.localeCompare(b.username);
  });
}

export async function sendFallbackAdminReply(
  targetUserId: string,
  text: string,
  imageData?: string
): Promise<ChatMessage> {
  const accounts = await ensureFallbackAdminSeeded();
  const all = safeReadJson<ChatMessage[]>(FALLBACK_MESSAGES_KEY, []);
  const acc = accounts.find((a) => a.userId === targetUserId);
  const existingMsg = all.find((m) => m.userId === targetUserId);

  const reply: ChatMessage = {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    userId: targetUserId,
    username: acc?.username || existingMsg?.username || `User_${targetUserId.slice(-2)}`,
    mobileNumber: acc?.mobileNumber || existingMsg?.mobileNumber || '—',
    sender: 'agent',
    text: text.trim().slice(0, 1000),
    ...(imageData ? { imageUrl: imageData } : {}),
    createdAt: formatTimestamp(),
    readByAdmin: true,
    readByUser: false,
  };

  const nextAll = all.map((m) =>
    m.userId === targetUserId && m.sender === 'user' && !m.readByAdmin
      ? { ...m, readByAdmin: true }
      : m
  );
  nextAll.push(reply);
  safeWriteJson(FALLBACK_MESSAGES_KEY, nextAll);
  return reply;
}

export function markFallbackAdminChatRead(targetUserId: string): void {
  const all = safeReadJson<ChatMessage[]>(FALLBACK_MESSAGES_KEY, []);
  let changed = false;
  const nextAll = all.map((m) => {
    if (m.userId === targetUserId && m.sender === 'user' && !m.readByAdmin) {
      changed = true;
      return { ...m, readByAdmin: true };
    }
    return m;
  });
  if (changed) {
    safeWriteJson(FALLBACK_MESSAGES_KEY, nextAll);
  }
}

export interface FallbackOrderSubmission {
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

export function getFallbackOrderSubmissions(): FallbackOrderSubmission[] {
  return safeReadJson<FallbackOrderSubmission[]>(FALLBACK_SUBMISSIONS_KEY, []);
}

export function saveFallbackOrderSubmission(
  sub: FallbackOrderSubmission
): void {
  const all = getFallbackOrderSubmissions();
  if (all.some((s) => s.id === sub.id)) return;
  all.unshift(sub);
  safeWriteJson(FALLBACK_SUBMISSIONS_KEY, all);
}

export function updateFallbackOrderSubmissionStatus(
  idOrOrderId: string,
  status: 'success' | 'rejected'
): void {
  const all = getFallbackOrderSubmissions();
  const next = all.map((s) =>
    (s.id === idOrOrderId || s.orderId === idOrOrderId) && s.status === 'pending'
      ? { ...s, status }
      : s
  );
  safeWriteJson(FALLBACK_SUBMISSIONS_KEY, next);
}
