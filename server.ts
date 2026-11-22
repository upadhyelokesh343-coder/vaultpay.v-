import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

if (!process.env.VERCEL) {
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx <= 0) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (key && process.env[key] === undefined) {
          process.env[key] = val;
        }
      }
    }
  } catch {
    // ignore local .env parse error
  }
}

class SunPayGatewayError extends Error {
  public readonly code: number;
  public readonly statusCode: number;
  public readonly details: unknown;

  constructor(
    message: string,
    code: number = 1,
    statusCode: number = 500,
    details: unknown = null
  ) {
    super(message);
    this.name = 'SunPayGatewayError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

class SunPayGatewayClient {
  public readonly baseUrl: string;
  public readonly apiToken: string;
  public readonly timeout: number;

  constructor({
    baseUrl,
    apiToken,
    timeout = 18000,
  }: {
    baseUrl?: string;
    apiToken: string;
    timeout?: number;
  }) {
    this.baseUrl = (baseUrl || 'https://api.silkpay.live').replace(/\/+$/, '');
    this.apiToken = apiToken;
    this.timeout = timeout;
  }

  async request<T = Record<string, unknown>>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    reqPath: string,
    data: Record<string, unknown> | null = null,
    query: Record<string, unknown> | null = null
  ): Promise<{ code?: number; msg?: string; error?: string; data?: T }> {
    let url = `${this.baseUrl}${reqPath.startsWith('/') ? reqPath : `/${reqPath}`}`;
    if (query && typeof query === 'object') {
      const searchParams = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== '') {
          searchParams.append(k, String(v));
        }
      }
      const qs = searchParams.toString();
      if (qs) url += (url.includes('?') ? '&' : '?') + qs;
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${this.apiToken}`,
    };

    const fetchOptions: RequestInit = { method: method.toUpperCase(), headers };
    if (data && (fetchOptions.method === 'POST' || fetchOptions.method === 'PUT')) {
      headers['Content-Type'] = 'application/json';
      fetchOptions.body = JSON.stringify(data);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    fetchOptions.signal = controller.signal;

    try {
      const res = await fetch(url, fetchOptions);
      clearTimeout(timer);
      const contentType = res.headers.get('content-type') || '';
      let resBody: { code?: number; msg?: string; error?: string; data?: T };

      if (contentType.includes('application/json')) {
        resBody = (await res.json()) as {
          code?: number;
          msg?: string;
          error?: string;
          data?: T;
        };
      } else {
        const text = await res.text();
        try {
          resBody = JSON.parse(text) as {
            code?: number;
            msg?: string;
            error?: string;
            data?: T;
          };
        } catch {
          resBody = {
            code: res.ok ? 0 : 1,
            msg: text || `HTTP ${res.status}`,
            data: text as unknown as T,
          };
        }
      }

      if (!res.ok) {
        throw new SunPayGatewayError(
          resBody?.msg || resBody?.error || `HTTP ${res.status} ${res.statusText}`,
          Number(resBody?.code || res.status),
          res.status,
          resBody?.data || resBody
        );
      }

      if (resBody && typeof resBody.code === 'number' && resBody.code !== 0) {
        throw new SunPayGatewayError(
          resBody.msg || 'Gateway API returned non-zero code',
          resBody.code,
          res.status,
          resBody.data
        );
      }

      return resBody;
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof SunPayGatewayError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new SunPayGatewayError(
          `Gateway request timed out after ${this.timeout}ms`,
          408,
          408
        );
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new SunPayGatewayError(`Gateway connection error: ${msg}`, 502, 502, err);
    }
  }

  get<T = Record<string, unknown>>(
    reqPath: string,
    query: Record<string, unknown> | null = null
  ) {
    return this.request<T>('GET', reqPath, null, query);
  }

  post<T = Record<string, unknown>>(
    reqPath: string,
    data: Record<string, unknown> | null = null
  ) {
    return this.request<T>('POST', reqPath, data, null);
  }

  async createPayinOrder(params: {
    merchantOrderNo: string;
    amount: string;
    currency?: string;
    payinName?: string;
    payinPhone?: string;
    payinEmail?: string;
    notifyUrl?: string;
    returnUrl?: string;
    mark?: string;
  }): Promise<{
    merchantOrderNo: string;
    gatewayOrderNo: string;
    cashierUrl: string;
    amount: string;
    payinState: number;
  }> {
    const res = await this.post<Record<string, unknown>>(
      '/merchant/api/payin/create',
      params as unknown as Record<string, unknown>
    );
    const payload = (res.data ?? res) as Record<string, unknown>;
    const cashierUrl = String(
      payload.cashierUrl || payload.payUrl || payload.checkoutUrl || ''
    ).trim();
    if (!cashierUrl) {
      throw new SunPayGatewayError(
        'Gateway did not return a cashierUrl',
        502,
        502,
        payload
      );
    }
    return {
      merchantOrderNo: String(payload.merchantOrderNo || params.merchantOrderNo),
      gatewayOrderNo: String(payload.gatewayOrderNo || ''),
      cashierUrl,
      amount: String(payload.amount ?? params.amount),
      payinState: Number(payload.payinState ?? 1),
    };
  }

  async queryPayinStatus(orderNo: string): Promise<{
    isPaid: boolean;
    status: string;
    payinState: number;
    payinStateName: string;
    orderNo: string;
    merchantOrderNo: string;
    gatewayOrderNo: string;
    amount: string;
    actualAmount: string;
    feeCharged: string;
    settleAmount: string;
    currency: string;
    utr: string | null;
    cashierUrl: string;
    createdAt: string;
    paidAt: string | null;
  }> {
    if (!orderNo) throw new SunPayGatewayError('orderNo is required', 400, 400);
    let res: { data?: Record<string, unknown> };
    try {
      res = await this.post<Record<string, unknown>>('/merchant/api/payin/query', {
        orderNo,
      });
    } catch (err) {
      if (
        err instanceof SunPayGatewayError &&
        (err.statusCode === 404 || err.statusCode === 405)
      ) {
        res = await this.get<Record<string, unknown>>(
          `/merchant/api/payin/status/${encodeURIComponent(orderNo)}`
        );
      } else {
        throw err;
      }
    }
    const d = (res.data ?? {}) as Record<string, unknown>;
    const payinState = Number(d.payinState ?? 1);
    const isPaid = Boolean(d.isPaid || payinState === 2 || String(d.status).toUpperCase() === 'PAID');
    return {
      isPaid,
      status: String(d.status || (isPaid ? 'PAID' : 'PENDING')),
      payinState,
      payinStateName: String(d.payinStateName || ''),
      orderNo: String(d.orderNo || d.merchantOrderNo || orderNo),
      merchantOrderNo: String(d.merchantOrderNo || orderNo),
      gatewayOrderNo: String(d.gatewayOrderNo || ''),
      amount: String(d.amount ?? ''),
      actualAmount: String(d.actualAmount ?? ''),
      feeCharged: String(d.feeCharged ?? ''),
      settleAmount: String(d.settleAmount ?? ''),
      currency: String(d.currency || 'INR'),
      utr: d.utr ? String(d.utr) : null,
      cashierUrl: String(d.cashierUrl || ''),
      createdAt: String(d.createdAt || ''),
      paidAt: d.paidAt ? String(d.paidAt) : null,
    };
  }

  async submitPayinUtr(merchantOrderNo: string, utr: string) {
    const res = await this.post<Record<string, unknown>>(
      '/merchant/api/payin/utr/submit',
      { merchantOrderNo, utr }
    );
    return res.data ?? res;
  }

  async listPayinOrders(limit = 20, offset = 0, state = 'all') {
    const res = await this.get<Record<string, unknown>>('/merchant/api/payin/list', {
      limit,
      offset,
      state,
    });
    return res.data ?? res;
  }

  async getPayinSummary() {
    const res = await this.get<Record<string, unknown>>('/merchant/api/payin/summary');
    return res.data ?? res;
  }

  async createBankPayout(params: {
    merchantOrderNo: string;
    amount: string;
    cashName: string;
    cashPhone: string;
    cashNumber: string;
    ifsc: string;
    bankName?: string;
    notifyUrl?: string;
  }) {
    const res = await this.post<Record<string, unknown>>(
      '/merchant/api/payout/create',
      { version: 'V2', ...params }
    );
    return (res.data ?? {}) as Record<string, unknown>;
  }

  async createUpiPayout(params: {
    merchantOrderNo: string;
    amount: string;
    cashName: string;
    cashPhone: string;
    cashNumber: string;
    notifyUrl?: string;
  }) {
    const res = await this.post<Record<string, unknown>>(
      '/merchant/api/payout/create',
      { version: 'V3', ...params }
    );
    return (res.data ?? {}) as Record<string, unknown>;
  }

  async queryPayoutStatus(orderNo: string) {
    const res = await this.post<Record<string, unknown>>('/merchant/api/payout/query', {
      orderNo,
    });
    return (res.data ?? {}) as Record<string, unknown>;
  }

  async listPayoutOrders(limit = 20, offset = 0, state = 'all') {
    const res = await this.get<Record<string, unknown>>('/merchant/api/payout/list', {
      limit,
      offset,
      state,
    });
    return res.data ?? res;
  }

  async getBalance() {
    const res = await this.get<Record<string, unknown>>('/merchant/api/balance');
    return (res.data ?? {}) as Record<string, unknown>;
  }

  async getAccount() {
    const res = await this.get<Record<string, unknown>>('/merchant/api/account');
    return (res.data ?? {}) as Record<string, unknown>;
  }

  async getAuthMe() {
    const res = await this.get<Record<string, unknown>>('/merchant/api/auth/me');
    return (res.data ?? {}) as Record<string, unknown>;
  }

  async getLedger(limit = 50, offset = 0) {
    const res = await this.get<Record<string, unknown>>('/merchant/api/ledger', {
      limit,
      offset,
    });
    return (res.data ?? {}) as Record<string, unknown>;
  }

  verifyWebhookSignature(payload: Record<string, unknown> | null | undefined): boolean {
    if (!payload || typeof payload !== 'object') return false;
    const { sign, ...data } = payload;
    if (!sign || typeof sign !== 'string' || !this.apiToken) return false;

    const sortedKeys = Object.keys(data)
      .filter((k) => k !== 'sign')
      .sort();
    const pairs: string[] = [];
    for (const key of sortedKeys) {
      const val = data[key];
      if (val !== '' && val !== null && val !== undefined) {
        pairs.push(`${key}=${val}`);
      }
    }
    const expectedSign = crypto
      .createHash('md5')
      .update(`${pairs.join('&')}&key=${this.apiToken}`, 'utf8')
      .digest('hex')
      .toLowerCase();

    try {
      const a = Buffer.from(sign.toLowerCase(), 'utf8');
      const b = Buffer.from(expectedSign, 'utf8');
      if (a.length !== b.length) return false;
      return crypto.timingSafeEqual(a, b);
    } catch {
      return sign.toLowerCase() === expectedSign;
    }
  }
}


interface StoredReferral {
  id: string;
  referrerCode: string;
  inviteeId: string;
  inviteeName: string;
  codeUsed: string;
  registeredAt: string;
  completedAt?: string;
  status: 'registered' | 'completed';
}

interface StoredAccount {
  userId: string;
  mobileNumber: string;
  username: string;
  passwordHash: string;
  referredBy: string | null;
  referralCode: string;
  createdAt: string;
  role?: 'admin' | 'agent' | 'user';
  agentId?: string;
}

interface StoredAgent {
  id: string;
  userId?: string;
  mobileNumber: string;
  passwordHash: string;
  passwordPlain?: string;
  referralCode: string;
  aliasCodes?: string[];
  shareUrl: string;
  createdAt: string;
}

interface StoredOrderSubmission {
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
  updatedAt?: string;
}

interface StoredWithdrawal {
  id: string;
  txId: string;
  userId: string;
  username: string;
  userMobile?: string;
  amount: number;
  method: 'upi' | 'bank' | 'mobile';
  upiId?: string;
  bankName?: string;
  accountNumber?: string;
  ifscCode?: string;
  mobileNumber?: string;
  accountDetailSummary: string;
  status: 'Pending' | 'Success' | 'Rejected';
  createdAt: string;
  processedAt?: string;
  requesterRole?: 'user' | 'agent';
  agentId?: string;
}

interface StoredChatMessage {
  id: string;
  userId: string;
  username: string;
  mobileNumber: string;
  sender: 'user' | 'agent';
  text: string;
  imageUrl?: string;
  createdAt: string;
  readByAdmin: boolean;
  readByUser: boolean;
}

interface StoredSharedOrder {
  id: string;
  orderCode: string;
  amount: number;
  paymentLink: string;
  commissionRate: number;
  createdAt: string;
  status: 'active';
}

interface StoredGatewayOrder {
  merchantOrderNo: string;
  gatewayOrderNo?: string;
  type: 'payin' | 'payout';
  orderId?: string;
  orderCode?: string;
  withdrawalId?: string;
  userId?: string;
  username?: string;
  amount: number;
  cashierUrl?: string;
  payinState?: number;
  cashState?: number;
  status?: string;
  isPaid?: boolean;
  utr?: string | null;
  actualAmount?: string;
  settleAmount?: string;
  createdAt: string;
  updatedAt?: string;
  paidAt?: string | null;
}

const IS_VERCEL = Boolean(process.env.VERCEL);
const DATA_DIR = IS_VERCEL
  ? path.join('/tmp', 'aurex-vault-data')
  : path.resolve(process.cwd(), '.data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const DATA_FILE = path.join(DATA_DIR, 'referrals.json');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const WALLETS_FILE = path.join(DATA_DIR, 'wallets.json');
const WITHDRAWALS_FILE = path.join(DATA_DIR, 'withdrawals.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const GATEWAY_ORDERS_FILE = path.join(DATA_DIR, 'gateway_orders.json');
const SHARED_ORDERS_FILE = path.join(DATA_DIR, 'admin_orders.json');
const AGENTS_FILE = path.join(DATA_DIR, 'agents.json');
const ORDER_SUBMISSIONS_FILE = path.join(DATA_DIR, 'order_submissions.json');

const KV_REST_URL = String(
  process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || ''
)
  .trim()
  .replace(/\/+$/, '');
const KV_REST_TOKEN = String(
  process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || ''
).trim();
const KV_PREFIX = 'vaultpay:data:v1:';

function isRemoteKvEnabled(): boolean {
  return Boolean(KV_REST_URL && KV_REST_TOKEN);
}

const KV_FILE_MAP: Array<{ key: string; file: string; fallback: string }> = [
  { key: `${KV_PREFIX}referrals`, file: DATA_FILE, fallback: '[]' },
  { key: `${KV_PREFIX}accounts`, file: ACCOUNTS_FILE, fallback: '[]' },
  { key: `${KV_PREFIX}wallets`, file: WALLETS_FILE, fallback: '{}' },
  { key: `${KV_PREFIX}withdrawals`, file: WITHDRAWALS_FILE, fallback: '[]' },
  { key: `${KV_PREFIX}messages`, file: MESSAGES_FILE, fallback: '[]' },
  { key: `${KV_PREFIX}gateway_orders`, file: GATEWAY_ORDERS_FILE, fallback: '[]' },
  { key: `${KV_PREFIX}admin_orders`, file: SHARED_ORDERS_FILE, fallback: '[]' },
  { key: `${KV_PREFIX}agents`, file: AGENTS_FILE, fallback: '[]' },
  { key: `${KV_PREFIX}order_submissions`, file: ORDER_SUBMISSIONS_FILE, fallback: '[]' },
];

const pendingKvWrites = new Map<string, string>();
let lastKvHydrateAt = 0;
let activeHydratePromise: Promise<void> | null = null;

function hasPendingKvWrites(): boolean {
  return isRemoteKvEnabled() && pendingKvWrites.size > 0;
}

function queueRemoteSave(filePath: string, serialized: string): void {
  if (!isRemoteKvEnabled()) return;
  const entry = KV_FILE_MAP.find((item) => item.file === filePath);
  if (entry) {
    pendingKvWrites.set(entry.key, serialized);
  }
}

async function kvPipeline(commands: unknown[][]): Promise<Array<{ result?: unknown }> | null> {
  if (!isRemoteKvEnabled() || commands.length === 0) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const res = await fetch(`${KV_REST_URL}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KV_REST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commands),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const json = (await res.json()) as Array<{ result?: unknown }>;
    return Array.isArray(json) ? json : null;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

async function hydrateRemoteStoresIfNeeded(force = false): Promise<void> {
  if (!isRemoteKvEnabled()) return;
  const now = Date.now();
  if (!force && now - lastKvHydrateAt < 1200) return;
  if (activeHydratePromise) {
    await activeHydratePromise;
    return;
  }

  activeHydratePromise = (async () => {
    try {
      const mgetCmd = ['MGET', ...KV_FILE_MAP.map((m) => m.key)];
      const resp = await kvPipeline([mgetCmd]);
      const values = Array.isArray(resp?.[0]?.result)
        ? (resp![0].result as Array<string | null>)
        : null;
      if (!values) return;

      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      for (let i = 0; i < KV_FILE_MAP.length; i += 1) {
        const entry = KV_FILE_MAP[i];
        if (pendingKvWrites.has(entry.key)) continue;
        const raw = values[i];
        if (typeof raw === 'string' && raw.trim()) {
          fs.writeFileSync(entry.file, raw, 'utf-8');
        }
      }
      lastKvHydrateAt = Date.now();
    } catch {
      // ignore remote hydration errors and continue with local disk
    } finally {
      activeHydratePromise = null;
    }
  })();

  await activeHydratePromise;
}

async function flushRemoteWrites(): Promise<void> {
  if (!isRemoteKvEnabled() || pendingKvWrites.size === 0) return;
  const entries = Array.from(pendingKvWrites.entries());
  pendingKvWrites.clear();
  const commands = entries.map(([key, value]) => ['SET', key, value]);
  const res = await kvPipeline(commands);
  if (!res) {
    // Re-queue if transient failure so next request can retry
    for (const [key, value] of entries) {
      if (!pendingKvWrites.has(key)) {
        pendingKvWrites.set(key, value);
      }
    }
  } else {
    lastKvHydrateAt = Date.now();
  }
}

function ensureAgents(): StoredAgent[] {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(AGENTS_FILE)) {
      fs.writeFileSync(AGENTS_FILE, '[]', 'utf-8');
      return [];
    }
    const raw = fs.readFileSync(AGENTS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveAgents(records: StoredAgent[]): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const serialized = JSON.stringify(records, null, 2);
    fs.writeFileSync(AGENTS_FILE, serialized, 'utf-8');
    queueRemoteSave(AGENTS_FILE, serialized);
  } catch {
    // Ignore write errors
  }
}

function ensureOrderSubmissions(): StoredOrderSubmission[] {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(ORDER_SUBMISSIONS_FILE)) {
      fs.writeFileSync(ORDER_SUBMISSIONS_FILE, '[]', 'utf-8');
      return [];
    }
    const raw = fs.readFileSync(ORDER_SUBMISSIONS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveOrderSubmissions(records: StoredOrderSubmission[]): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const serialized = JSON.stringify(records, null, 2);
    fs.writeFileSync(ORDER_SUBMISSIONS_FILE, serialized, 'utf-8');
    queueRemoteSave(ORDER_SUBMISSIONS_FILE, serialized);
  } catch {
    // Ignore write errors
  }
}

function ensureGatewayOrders(): StoredGatewayOrder[] {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(GATEWAY_ORDERS_FILE)) {
      fs.writeFileSync(GATEWAY_ORDERS_FILE, '[]', 'utf-8');
      return [];
    }
    const raw = fs.readFileSync(GATEWAY_ORDERS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveGatewayOrders(records: StoredGatewayOrder[]): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const serialized = JSON.stringify(records, null, 2);
    fs.writeFileSync(GATEWAY_ORDERS_FILE, serialized, 'utf-8');
    queueRemoteSave(GATEWAY_ORDERS_FILE, serialized);
  } catch {
    // Ignore write errors
  }
}

const DEFAULT_GATEWAY_API_TOKEN =
  'gw_be7e67490aec6a99c6011e3e55766c51aad5f52989acd13163b2caf3902e9dc1';
const DEFAULT_GATEWAY_BASE_URL = 'https://api.silkpay.live';
const DEFAULT_APP_URL = 'https://vaultpay-644.vercel.app';

function getGatewayConfig(): {
  apiToken: string;
  baseUrl: string;
  configured: boolean;
} {
  const envToken = String(
    process.env.SILKPAY_API_TOKEN ||
      process.env.SUNPAY_API_TOKEN ||
      process.env.BLADEPAY_API_TOKEN ||
      ''
  ).trim();
  const isPlaceholder =
    !envToken ||
    envToken === 'gw_your_api_token_here' ||
    envToken === 'gw_your_merchant_api_token_here' ||
    envToken === 'your_token_here';
  const apiToken = isPlaceholder ? DEFAULT_GATEWAY_API_TOKEN : envToken;
  const rawBaseUrl = String(
    process.env.SILKPAY_BASE_URL ||
      process.env.SUNPAY_BASE_URL ||
      process.env.BLADEPAY_BASE_URL ||
      ''
  ).trim();
  return {
    apiToken,
    baseUrl: (rawBaseUrl || DEFAULT_GATEWAY_BASE_URL).replace(/\/+$/, ''),
    configured: Boolean(apiToken),
  };
}

function createGatewayClient(): SunPayGatewayClient | null {
  const cfg = getGatewayConfig();
  if (!cfg.configured) return null;
  return new SunPayGatewayClient({
    apiToken: cfg.apiToken,
    baseUrl: cfg.baseUrl,
    timeout: 18000,
  });
}

function resolveRequestOrigin(req: express.Request): string {
  const envUrl = String(process.env.APP_URL || '').trim().replace(/\/+$/, '');
  if (envUrl && envUrl !== 'MY_APP_URL' && /^https?:\/\//i.test(envUrl)) {
    return envUrl;
  }
  const protoHeader = String(req.header('x-forwarded-proto') || '').split(',')[0].trim();
  const hostHeader = String(req.header('x-forwarded-host') || req.header('host') || '')
    .split(',')[0]
    .trim();
  if (hostHeader) {
    const proto = protoHeader || (hostHeader.includes('localhost') ? 'http' : 'https');
    return `${proto}://${hostHeader}`;
  }
  const vercelProdUrl = String(
    process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || ''
  )
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
  if (vercelProdUrl) {
    return `https://${vercelProdUrl}`;
  }
  return IS_VERCEL ? DEFAULT_APP_URL : 'http://localhost:3000';
}

function ensureSharedOrders(): StoredSharedOrder[] {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(SHARED_ORDERS_FILE)) {
      fs.writeFileSync(SHARED_ORDERS_FILE, '[]', 'utf-8');
      return [];
    }
    const raw = fs.readFileSync(SHARED_ORDERS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSharedOrders(records: StoredSharedOrder[]): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const serialized = JSON.stringify(records, null, 2);
    fs.writeFileSync(SHARED_ORDERS_FILE, serialized, 'utf-8');
    queueRemoteSave(SHARED_ORDERS_FILE, serialized);
  } catch {
    // Ignore write errors
  }
}

function ensureStore(): StoredReferral[] {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, '[]', 'utf-8');
      return [];
    }
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveStore(records: StoredReferral[]): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const serialized = JSON.stringify(records, null, 2);
    fs.writeFileSync(DATA_FILE, serialized, 'utf-8');
    queueRemoteSave(DATA_FILE, serialized);
  } catch {
    // Ignore write errors
  }
}

function ensureAccounts(): StoredAccount[] {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(ACCOUNTS_FILE)) {
      fs.writeFileSync(ACCOUNTS_FILE, '[]', 'utf-8');
      return [];
    }
    const raw = fs.readFileSync(ACCOUNTS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveAccounts(accounts: StoredAccount[]): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const serialized = JSON.stringify(accounts, null, 2);
    fs.writeFileSync(ACCOUNTS_FILE, serialized, 'utf-8');
    queueRemoteSave(ACCOUNTS_FILE, serialized);
  } catch {
    // Ignore write errors
  }
}

function ensureWallets(): Record<string, unknown> {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(WALLETS_FILE)) {
      fs.writeFileSync(WALLETS_FILE, '{}', 'utf-8');
      return {};
    }
    const raw = fs.readFileSync(WALLETS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function saveWallets(wallets: Record<string, unknown>): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const serialized = JSON.stringify(wallets, null, 2);
    fs.writeFileSync(WALLETS_FILE, serialized, 'utf-8');
    queueRemoteSave(WALLETS_FILE, serialized);
  } catch {
    // Ignore write errors
  }
}

function ensureWithdrawals(): StoredWithdrawal[] {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(WITHDRAWALS_FILE)) {
      fs.writeFileSync(WITHDRAWALS_FILE, '[]', 'utf-8');
      return [];
    }
    const raw = fs.readFileSync(WITHDRAWALS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveWithdrawals(records: StoredWithdrawal[]): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const serialized = JSON.stringify(records, null, 2);
    fs.writeFileSync(WITHDRAWALS_FILE, serialized, 'utf-8');
    queueRemoteSave(WITHDRAWALS_FILE, serialized);
  } catch {
    // Ignore write errors
  }
}

function ensureMessages(): StoredChatMessage[] {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(MESSAGES_FILE)) {
      fs.writeFileSync(MESSAGES_FILE, '[]', 'utf-8');
      return [];
    }
    const raw = fs.readFileSync(MESSAGES_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveMessages(records: StoredChatMessage[]): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const serialized = JSON.stringify(records, null, 2);
    fs.writeFileSync(MESSAGES_FILE, serialized, 'utf-8');
    queueRemoteSave(MESSAGES_FILE, serialized);
  } catch {
    // Ignore write errors
  }
}

const ALLOWED_IMAGE_MIMES: Record<string, string> = {
  png: 'png',
  jpeg: 'jpg',
  jpg: 'jpg',
  webp: 'webp',
  gif: 'gif',
};

function saveChatImageDataUrl(rawDataUrl: unknown): string | undefined {
  if (typeof rawDataUrl !== 'string' || !rawDataUrl) return undefined;
  const match = rawDataUrl.match(
    /^data:image\/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/=\r\n]+)$/i
  );
  if (!match) return undefined;
  const rawSubtype = match[1].toLowerCase();
  const ext = ALLOWED_IMAGE_MIMES[rawSubtype];
  if (!ext) return undefined;

  const base64Body = match[2].replace(/\s+/g, '');
  const buffer = Buffer.from(base64Body, 'base64');
  // Limit decoded image file to 4 MB
  if (buffer.length === 0 || buffer.length > 4 * 1024 * 1024) {
    return undefined;
  }

  try {
    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }
    const filename = `img-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);
    return `/api/uploads/${filename}`;
  } catch {
    return undefined;
  }
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const keyBuf = Buffer.from(keyHex, 'hex');
  const derived = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derived.length) return false;
  return crypto.timingSafeEqual(keyBuf, derived);
}

function generateNewUserId(existingIds: Set<string>): string {
  let candidate = String(Math.floor(100000 + Math.random() * 899999));
  while (existingIds.has(candidate) || candidate === '415061') {
    candidate = String(Math.floor(100000 + Math.random() * 899999));
  }
  return candidate;
}

const ADMIN_MOBILE_NUMBER = '7285009425';
const ADMIN_DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || 'raja890';

function normalizeMobile(raw: unknown): string {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function isAdminRequest(req: express.Request): boolean {
  return normalizeMobile(req.header('x-admin-mobile')) === ADMIN_MOBILE_NUMBER;
}

function nowTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function ensureAdminAccountSeeded(): StoredAccount[] {
  const accounts = ensureAccounts();
  if (accounts.some((a) => normalizeMobile(a.mobileNumber) === ADMIN_MOBILE_NUMBER)) {
    return accounts;
  }

  const wallets = ensureWallets();
  let matchedUserId: string | null = null;
  let matchedWallet: Record<string, unknown> | undefined;
  for (const [wId, rawWallet] of Object.entries(wallets)) {
    if (!rawWallet || typeof rawWallet !== 'object') continue;
    const w = rawWallet as Record<string, unknown>;
    const authAcc =
      typeof w.authAccount === 'object' && w.authAccount
        ? (w.authAccount as Record<string, unknown>)
        : undefined;
    const profile =
      typeof w.profile === 'object' && w.profile
        ? (w.profile as Record<string, unknown>)
        : undefined;
    const wMobile = normalizeMobile(authAcc?.mobileNumber || profile?.mobileNumber);
    if (wMobile === ADMIN_MOBILE_NUMBER) {
      matchedUserId = wId;
      matchedWallet = w;
      break;
    }
  }

  const existingIds = new Set([
    ...accounts.map((a) => a.userId),
    ...Object.keys(wallets),
  ]);
  const userId = matchedUserId || generateNewUserId(existingIds);
  const authAcc =
    matchedWallet && typeof matchedWallet.authAccount === 'object' && matchedWallet.authAccount
      ? (matchedWallet.authAccount as Record<string, unknown>)
      : undefined;
  const profile =
    matchedWallet && typeof matchedWallet.profile === 'object' && matchedWallet.profile
      ? (matchedWallet.profile as Record<string, unknown>)
      : undefined;
  const username =
    String(authAcc?.username || profile?.username || 'User_25').trim() ||
    'User_25';
  const createdAt =
    typeof authAcc?.createdAt === 'string' && authAcc.createdAt
      ? authAcc.createdAt
      : nowTimestamp();

  const adminAccount: StoredAccount = {
    userId,
    mobileNumber: ADMIN_MOBILE_NUMBER,
    username,
    passwordHash: hashPassword(ADMIN_DEFAULT_PASSWORD),
    referredBy:
      typeof authAcc?.referredBy === 'string' ? authAcc.referredBy : null,
    referralCode: String(authAcc?.referralCode || `AUREX-${userId}`),
    createdAt,
  };

  accounts.unshift(adminAccount);
  saveAccounts(accounts);
  return accounts;
}

function reconcileAgentAccounts(originOverride?: string): {
  agents: StoredAgent[];
  accounts: StoredAccount[];
} {
  const accounts = ensureAdminAccountSeeded();
  const agents = ensureAgents();
  const baseOrigin = (
    originOverride ||
    String(process.env.APP_URL || '').trim().replace(/\/+$/, '') ||
    (IS_VERCEL ? DEFAULT_APP_URL : 'http://localhost:3000')
  ).replace(/\/+$/, '');

  let agentsChanged = false;
  let accountsChanged = false;

  // 1. Ensure every Agent_* / role === 'agent' StoredAccount has a matching StoredAgent entry
  for (let i = 0; i < accounts.length; i += 1) {
    const acc = accounts[i];
    const mobile = normalizeMobile(acc.mobileNumber);
    if (!mobile || mobile === ADMIN_MOBILE_NUMBER) continue;

    const matchName = String(acc.username || '').match(/^Agent_(AGT-[A-Za-z0-9_-]+)$/i);
    const isAgentAccount = acc.role === 'agent' || Boolean(acc.agentId) || Boolean(matchName);
    if (!isAgentAccount) continue;

    const existingAgentIdx = agents.findIndex(
      (ag) =>
        normalizeMobile(ag.mobileNumber) === mobile ||
        (acc.agentId && ag.id === acc.agentId)
    );

    const resolvedAgentId =
      (existingAgentIdx !== -1 ? agents[existingAgentIdx].id : '') ||
      acc.agentId ||
      (matchName ? matchName[1].toUpperCase() : '') ||
      `AGT-${mobile.slice(-4)}`;

    const preferredCode = `AGENT-${resolvedAgentId}`.toUpperCase();
    const candidateAliases = [
      acc.referralCode,
      `AUREX-${acc.userId}`,
      `AGENT-${acc.userId}`,
      preferredCode,
    ]
      .map((c) => String(c || '').trim().toUpperCase())
      .filter(Boolean);

    if (existingAgentIdx === -1) {
      const aliasList = Array.from(new Set(candidateAliases)).filter(
        (c) => c !== preferredCode
      );
      agents.unshift({
        id: resolvedAgentId,
        userId: acc.userId,
        mobileNumber: mobile,
        passwordHash: acc.passwordHash,
        referralCode: preferredCode,
        aliasCodes: aliasList,
        shareUrl: `${baseOrigin}/?agent=${encodeURIComponent(preferredCode)}`,
        createdAt: acc.createdAt || nowTimestamp(),
      });
      agentsChanged = true;
    } else {
      const ag = agents[existingAgentIdx];
      const mergedAliases = Array.from(
        new Set([
          ...(ag.aliasCodes || []).map((c) => c.toUpperCase()),
          ...candidateAliases,
        ])
      ).filter((c) => c && c !== ag.referralCode.toUpperCase());
      const prevAliasStr = JSON.stringify(ag.aliasCodes || []);
      const nextAliasStr = JSON.stringify(mergedAliases);
      if (ag.userId !== acc.userId || prevAliasStr !== nextAliasStr) {
        agents[existingAgentIdx] = {
          ...ag,
          userId: ag.userId || acc.userId,
          aliasCodes: mergedAliases,
        };
        agentsChanged = true;
      }
    }

    if (acc.role !== 'agent' || acc.agentId !== resolvedAgentId) {
      accounts[i] = {
        ...acc,
        role: 'agent',
        agentId: resolvedAgentId,
      };
      accountsChanged = true;
    }
  }

  // 2. Ensure every StoredAgent's matching StoredAccount carries role: 'agent' and aliasCodes stay synced
  for (let j = 0; j < agents.length; j += 1) {
    const ag = agents[j];
    const mobile = normalizeMobile(ag.mobileNumber);
    if (!mobile || mobile === ADMIN_MOBILE_NUMBER) continue;
    const accIdx = accounts.findIndex((a) => normalizeMobile(a.mobileNumber) === mobile);
    if (accIdx !== -1) {
      const acc = accounts[accIdx];
      const extraAliases = [acc.referralCode, `AUREX-${acc.userId}`, `AGENT-${acc.userId}`]
        .map((c) => String(c || '').trim().toUpperCase())
        .filter((c) => c && c !== ag.referralCode.toUpperCase());
      const mergedAliases = Array.from(
        new Set([...(ag.aliasCodes || []).map((c) => c.toUpperCase()), ...extraAliases])
      );
      if (
        ag.userId !== acc.userId ||
        JSON.stringify(ag.aliasCodes || []) !== JSON.stringify(mergedAliases)
      ) {
        agents[j] = {
          ...ag,
          userId: ag.userId || acc.userId,
          aliasCodes: mergedAliases,
        };
        agentsChanged = true;
      }
      if (acc.role !== 'agent' || acc.agentId !== ag.id) {
        accounts[accIdx] = {
          ...acc,
          role: 'agent',
          agentId: ag.id,
        };
        accountsChanged = true;
      }
    }
  }

  if (agentsChanged) saveAgents(agents);
  if (accountsChanged) saveAccounts(accounts);
  return { agents, accounts };
}

function getAgentAllCodes(agent: StoredAgent, allAccounts: StoredAccount[]): Set<string> {
  const codes = new Set<string>();
  if (agent.referralCode) codes.add(agent.referralCode.toUpperCase());
  if (agent.id) codes.add(`AGENT-${agent.id}`.toUpperCase());
  if (agent.userId) {
    codes.add(`AUREX-${agent.userId}`.toUpperCase());
    codes.add(`AGENT-${agent.userId}`.toUpperCase());
  }
  for (const alias of agent.aliasCodes || []) {
    if (alias) codes.add(alias.toUpperCase());
  }
  const agMobile = normalizeMobile(agent.mobileNumber);
  for (const acc of allAccounts) {
    if (
      (agMobile && normalizeMobile(acc.mobileNumber) === agMobile) ||
      (agent.userId && acc.userId === agent.userId) ||
      acc.agentId === agent.id
    ) {
      if (acc.referralCode) codes.add(acc.referralCode.toUpperCase());
      if (acc.userId) {
        codes.add(`AUREX-${acc.userId}`.toUpperCase());
        codes.add(`AGENT-${acc.userId}`.toUpperCase());
      }
    }
  }
  return codes;
}

function computeAgentStats(agent: StoredAgent) {
  const allAccounts = ensureAdminAccountSeeded();
  const agentCodes = getAgentAllCodes(agent, allAccounts);
  const referrals = ensureStore().filter((r) =>
    agentCodes.has((r.referrerCode || '').toUpperCase())
  );
  const accounts = allAccounts.filter((a) =>
    agentCodes.has((a.referredBy || '').toUpperCase())
  );
  const wallets = ensureWallets();

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

  for (const r of referrals) {
    joinedMap.set(r.inviteeId, {
      userId: r.inviteeId,
      username: r.inviteeName,
      joinedAt: r.registeredAt,
      status: r.status,
    });
  }
  for (const a of accounts) {
    const existing = joinedMap.get(a.userId);
    joinedMap.set(a.userId, {
      userId: a.userId,
      username: a.username,
      mobileNumber: a.mobileNumber,
      joinedAt: existing?.joinedAt || a.createdAt,
      status: existing?.status || 'registered',
    });
  }
  for (const [wUserId, rawWallet] of Object.entries(wallets)) {
    if (!rawWallet || typeof rawWallet !== 'object') continue;
    const w = rawWallet as Record<string, unknown>;
    const authAcc =
      typeof w.authAccount === 'object' && w.authAccount
        ? (w.authAccount as Record<string, unknown>)
        : undefined;
    const profile =
      typeof w.profile === 'object' && w.profile
        ? (w.profile as Record<string, unknown>)
        : undefined;
    const wRef = String(authAcc?.referredBy || w.referredBy || '')
      .trim()
      .toUpperCase();
    if (!wRef || !agentCodes.has(wRef)) continue;
    const existing = joinedMap.get(wUserId);
    joinedMap.set(wUserId, {
      userId: wUserId,
      username: String(authAcc?.username || profile?.username || existing?.username || 'User'),
      mobileNumber:
        normalizeMobile(authAcc?.mobileNumber || profile?.mobileNumber) || existing?.mobileNumber,
      joinedAt: existing?.joinedAt || String(authAcc?.createdAt || nowTimestamp()),
      status: existing?.status || 'registered',
    });
  }

  const joinedUserIds = new Set(Array.from(joinedMap.keys()));
  const submissions = ensureOrderSubmissions().filter((s) => {
    const byRef = agentCodes.has((s.referredBy || '').toUpperCase());
    const byUser = s.userUid ? joinedUserIds.has(s.userUid) : false;
    return byRef || byUser;
  });

  // Ensure every user who submitted an order under this agent's code is also listed in joinedUsers
  for (const s of submissions) {
    if (!s.userUid) continue;
    const existing = joinedMap.get(s.userUid);
    const nextStatus: 'registered' | 'completed' =
      s.status === 'success' || existing?.status === 'completed'
        ? 'completed'
        : 'registered';
    joinedMap.set(s.userUid, {
      userId: s.userUid,
      username: existing?.username || s.userName || 'User',
      mobileNumber: existing?.mobileNumber || s.userMobile,
      joinedAt: existing?.joinedAt || s.createdAt,
      status: nextStatus,
    });
  }

  const approvedOrders = submissions.filter((s) => s.status === 'success');
  const rejectedOrders = submissions.filter((s) => s.status === 'rejected');
  const pendingOrders = submissions.filter((s) => s.status === 'pending');

  const approvedVolume = approvedOrders.reduce((sum, s) => sum + Number(s.amount || 0), 0);
  const commissionEarned =
    Math.round((approvedVolume * 0.05 + Number.EPSILON) * 100) / 100;

  const agMobile = normalizeMobile(agent.mobileNumber);
  const agentWithdrawals = ensureWithdrawals().filter((w) => {
    const isAgentRecord =
      w.requesterRole === 'agent' ||
      Boolean(w.agentId) ||
      /^AGT-/i.test(w.userId) ||
      /^Agent_AGT-/i.test(w.username);
    if (!isAgentRecord) return false;
    return (
      (w.agentId && w.agentId === agent.id) ||
      w.userId === agent.id ||
      (agent.userId && w.userId === agent.userId) ||
      (agMobile && w.userMobile && normalizeMobile(w.userMobile) === agMobile)
    );
  });

  const withdrawnTotal =
    Math.round(
      (agentWithdrawals
        .filter((w) => w.status !== 'Rejected')
        .reduce((sum, w) => sum + Number(w.amount || 0), 0) +
        Number.EPSILON) *
        100
    ) / 100;
  const availableBalance = Math.max(
    0,
    Math.round((commissionEarned - withdrawnTotal + Number.EPSILON) * 100) / 100
  );

  return {
    joinedUsers: Array.from(joinedMap.values()),
    joinedCount: joinedMap.size,
    orders: submissions.map((s) => ({
      ...s,
      commissionEarned:
        s.status === 'success'
          ? Math.round((Number(s.amount || 0) * 0.05 + Number.EPSILON) * 100) / 100
          : 0,
    })),
    totalOrdersCount: submissions.length,
    approvedCount: approvedOrders.length,
    rejectedCount: rejectedOrders.length,
    pendingCount: pendingOrders.length,
    approvedVolume,
    commissionEarned,
    withdrawnTotal,
    availableBalance,
    withdrawals: agentWithdrawals,
  };
}

const NON_APK_ANDROID_PACKAGES = new Set([
  'com.android.chrome',
  'com.chrome.beta',
  'com.chrome.dev',
  'com.chrome.canary',
  'org.chromium.webview_shell',
  'com.sec.android.app.sbrowser',
  'org.mozilla.firefox',
  'com.opera.browser',
  'com.opera.mini.native',
  'com.brave.browser',
  'com.microsoft.emmx',
  'com.duckduckgo.mobile.android',
  'com.ucmobile.intl',
  'com.whatsapp',
  'com.whatsapp.w4b',
  'com.instagram.android',
  'com.facebook.katana',
  'com.facebook.orca',
  'com.facebook.lite',
  'org.telegram.messenger',
  'org.telegram.plus',
  'jp.naver.line.android',
  'com.snapchat.android',
  'com.twitter.android',
  'com.zhiliaoapp.musically',
  'com.ss.android.ugc.trill',
  'com.tencent.mm',
  'com.google.android.googlequicksearchbox',
]);

function detectApkRequest(req: express.Request): {
  isApkWebView: boolean;
  packageName: string | null;
} {
  const xrw = String(req.header('x-requested-with') || '').trim().toLowerCase();
  const ua = String(req.header('user-agent') || '').toLowerCase();

  const isPackageName = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(xrw);
  const isSocialUa =
    /fban|fbav|fb_iab|instagram|whatsapp|line|micromessenger|snapchat|twitter|tiktok|bytedance|telegram|gsa\//.test(
      ua
    );
  const isCustomApkUa =
    /swiftapk|webintoapp|website2apk|appcreator|apkbuilder|median|gonative/.test(
      ua
    );
  const isAndroidWebViewUa =
    /android/.test(ua) &&
    (/; wv\)/.test(ua) || /\bversion\/\d+\.\d+\b/.test(ua)) &&
    !isSocialUa;

  const isApkWebView =
    (isPackageName && !NON_APK_ANDROID_PACKAGES.has(xrw)) ||
    isCustomApkUa ||
    isAndroidWebViewUa;

  return {
    isApkWebView,
    packageName: isPackageName ? xrw : null,
  };
}

export function createApp(): express.Express {
  reconcileAgentAccounts();
  const app = express();

  app.use('/api', (req, res, next) => {
    const isMutating = req.method !== 'GET' && req.method !== 'HEAD';
    void hydrateRemoteStoresIfNeeded(isMutating).then(() => {
      if (isRemoteKvEnabled()) {
        const origJson = res.json.bind(res);
        const origSend = res.send.bind(res);
        let bypassed = false;
        res.json = ((body?: unknown) => {
          if (bypassed || !hasPendingKvWrites()) {
            bypassed = true;
            return origJson(body);
          }
          void flushRemoteWrites().finally(() => {
            bypassed = true;
            origJson(body);
          });
          return res;
        }) as express.Response['json'];
        res.send = ((body?: unknown) => {
          if (bypassed || !hasPendingKvWrites()) {
            bypassed = true;
            return origSend(body);
          }
          void flushRemoteWrites().finally(() => {
            bypassed = true;
            origSend(body);
          });
          return res;
        }) as express.Response['send'];
      }
      next();
    });
  });

  app.use((req, _res, next) => {
    const r = req as express.Request & { _body?: boolean; readable?: boolean };
    if (typeof req.body === 'string' && req.body.trim().startsWith('{')) {
      try {
        req.body = JSON.parse(req.body);
      } catch {
        // leave raw
      }
    } else if (Buffer.isBuffer(req.body)) {
      try {
        req.body = JSON.parse(req.body.toString('utf8'));
      } catch {
        // leave raw
      }
    }
    if (!r._body && r.readable === false && req.body !== undefined) {
      r._body = true;
    }
    next();
  });

  app.use(express.json({ limit: '6mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  // Health & Serverless verification endpoints
  const handleHealth = (_req: express.Request, res: express.Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const cfg = getGatewayConfig();
    res.json({
      ok: true,
      service: 'VaultPay API',
      gateway: 'SunPay / SilkPay',
      baseUrl: cfg.baseUrl,
      configured: cfg.configured,
    });
  };
  app.get('/api', handleHealth);
  app.get('/api/health', handleHealth);
  app.get('/api/index', handleHealth);

  // Detect whether request originates inside a wrapped Android APK WebView (e.g. X-Requested-With: com.vaultpay.app)
  app.get('/api/client-env', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(detectApkRequest(req));
  });

  // Serve locally stored chat photo uploads safely
  app.get('/api/uploads/:filename', (req, res) => {
    const filename = String(req.params.filename || '').trim();
    if (!/^img-[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|gif)$/.test(filename)) {
      res.status(400).json({ error: 'INVALID_FILENAME' });
      return;
    }
    const fullPath = path.join(UPLOADS_DIR, filename);
    if (!fs.existsSync(fullPath)) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.sendFile(fullPath);
  });

  // Register account with Mobile Number + Username + Password + Confirm Password + Referral Code
  app.post('/api/auth/register', (req, res) => {
    const mobileNumber = normalizeMobile(req.body?.mobileNumber);
    const username = String(req.body?.username || '').trim().slice(0, 64);
    const password = String(req.body?.password || '');
    const confirmPassword = String(req.body?.confirmPassword || '');
    const rawRef = String(req.body?.referralCode || '').trim().toUpperCase();

    if (mobileNumber.length !== 10) {
      res.status(400).json({ error: 'INVALID_MOBILE' });
      return;
    }
    if (username.length < 2) {
      res.status(400).json({ error: 'INVALID_USERNAME' });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: 'INVALID_PASSWORD' });
      return;
    }
    if (password !== confirmPassword) {
      res.status(400).json({ error: 'PASSWORD_MISMATCH' });
      return;
    }

    const accounts = ensureAdminAccountSeeded();
    if (accounts.some((a) => normalizeMobile(a.mobileNumber) === mobileNumber)) {
      res.status(409).json({ error: 'MOBILE_EXISTS' });
      return;
    }

    const wallets = ensureWallets();
    let legacyUserId: string | null = null;
    let existingWallet: Record<string, unknown> | null = null;
    for (const [wId, rawWallet] of Object.entries(wallets)) {
      if (!rawWallet || typeof rawWallet !== 'object') continue;
      const w = rawWallet as Record<string, unknown>;
      const authAcc =
        typeof w.authAccount === 'object' && w.authAccount
          ? (w.authAccount as Record<string, unknown>)
          : undefined;
      const profile =
        typeof w.profile === 'object' && w.profile
          ? (w.profile as Record<string, unknown>)
          : undefined;
      const wMobile = normalizeMobile(authAcc?.mobileNumber || profile?.mobileNumber);
      if (wMobile === mobileNumber) {
        legacyUserId = wId;
        existingWallet = w;
        break;
      }
    }

    const existingIds = new Set([
      ...accounts.map((a) => a.userId),
      ...Object.keys(wallets),
    ]);
    const userId = legacyUserId || generateNewUserId(existingIds);
    const ownReferralCode = `AUREX-${userId}`;

    if (rawRef && rawRef === ownReferralCode) {
      res.status(400).json({ error: 'SELF_REFERRAL' });
      return;
    }

    const referredBy = rawRef ? rawRef.slice(0, 32) : null;
    const now = nowTimestamp();
    const newAccount: StoredAccount = {
      userId,
      mobileNumber,
      username,
      passwordHash: hashPassword(password),
      referredBy,
      referralCode: ownReferralCode,
      createdAt:
        typeof existingWallet?.authAccount === 'object' &&
        existingWallet.authAccount &&
        typeof (existingWallet.authAccount as Record<string, unknown>).createdAt === 'string'
          ? String((existingWallet.authAccount as Record<string, unknown>).createdAt)
          : now,
    };

    accounts.unshift(newAccount);
    saveAccounts(accounts);

    // Record genuine referral registration if referralCode was provided
    if (referredBy) {
      const referrals = ensureStore();
      const existsRef = referrals.some(
        (r) => r.referrerCode === referredBy && r.inviteeId === userId
      );
      if (!existsRef) {
        referrals.unshift({
          id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          referrerCode: referredBy,
          inviteeId: userId,
          inviteeName: username,
          codeUsed: referredBy,
          registeredAt: now,
          status: 'registered',
        });
        saveStore(referrals);
      }
    }

    res.json({
      ok: true,
      account: {
        userId: newAccount.userId,
        mobileNumber: newAccount.mobileNumber,
        username: newAccount.username,
        referredBy: newAccount.referredBy,
        referralCode: newAccount.referralCode,
        createdAt: newAccount.createdAt,
      },
      existingWallet,
    });
  });

  // Login with Mobile Number + Password
  app.post('/api/auth/login', (req, res) => {
    const mobileNumber = normalizeMobile(req.body?.mobileNumber);
    const password = String(req.body?.password || '');
    const loginReferredBy = req.body?.referredBy
      ? String(req.body.referredBy).trim().toUpperCase().slice(0, 32)
      : null;

    if (mobileNumber.length !== 10 || password.length < 6) {
      res.status(400).json({ error: 'INVALID_CREDENTIALS' });
      return;
    }

    const { accounts, agents } = reconcileAgentAccounts(resolveRequestOrigin(req));
    const matchedAgent = agents.find(
      (ag) => normalizeMobile(ag.mobileNumber) === mobileNumber
    );
    const found = accounts.find(
      (a) => normalizeMobile(a.mobileNumber) === mobileNumber
    );

    if (!found && !matchedAgent) {
      res.status(401).json({
        error: 'INVALID_CREDENTIALS',
        ...(IS_VERCEL && !isRemoteKvEnabled() ? { ephemeralMissing: true } : {}),
      });
      return;
    }

    if (found && !verifyPassword(password, found.passwordHash)) {
      if (!matchedAgent || !verifyPassword(password, matchedAgent.passwordHash)) {
        res.status(401).json({ error: 'INVALID_CREDENTIALS' });
        return;
      }
    } else if (!found && matchedAgent && !verifyPassword(password, matchedAgent.passwordHash)) {
      res.status(401).json({ error: 'INVALID_CREDENTIALS' });
      return;
    }

    const isAdm = mobileNumber === ADMIN_MOBILE_NUMBER;
    const role: 'admin' | 'agent' | 'user' = isAdm
      ? 'admin'
      : matchedAgent || found?.role === 'agent'
      ? 'agent'
      : 'user';

    const effectiveUserId = found?.userId || matchedAgent?.id || `AGT-${mobileNumber.slice(-4)}`;
    const effectiveUsername = found?.username || (matchedAgent ? `Agent_${matchedAgent.id}` : `User_${mobileNumber.slice(-2)}`);
    const effectiveReferredBy = found?.referredBy || loginReferredBy || null;
    const effectiveReferralCode =
      (role === 'agent' && matchedAgent?.referralCode) ||
      found?.referralCode ||
      matchedAgent?.referralCode ||
      `AUREX-${effectiveUserId}`;
    const effectiveCreatedAt = found?.createdAt || matchedAgent?.createdAt || nowTimestamp();

    // If a normal user logged in via an Agent/Referral link and wasn't attributed yet, attribute them
    if (role === 'user' && loginReferredBy) {
      if (found && !found.referredBy && loginReferredBy !== found.referralCode) {
        found.referredBy = loginReferredBy;
        saveAccounts(accounts);
      }
      const referrals = ensureStore();
      const existsRef = referrals.some(
        (r) =>
          r.referrerCode.toUpperCase() === loginReferredBy &&
          r.inviteeId === effectiveUserId
      );
      if (!existsRef) {
        referrals.unshift({
          id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          referrerCode: loginReferredBy,
          inviteeId: effectiveUserId,
          inviteeName: effectiveUsername,
          codeUsed: loginReferredBy,
          registeredAt: nowTimestamp(),
          status: 'registered',
        });
        saveStore(referrals);
      }
    }

    res.json({
      ok: true,
      account: {
        userId: effectiveUserId,
        mobileNumber,
        username: effectiveUsername,
        referredBy: effectiveReferredBy,
        referralCode: effectiveReferralCode,
        createdAt: effectiveCreatedAt,
        role,
        ...(matchedAgent
          ? { agentId: matchedAgent.id }
          : found?.agentId
          ? { agentId: found.agentId }
          : {}),
      },
      ...(matchedAgent
        ? {
            agentProfile: {
              id: matchedAgent.id,
              mobileNumber: matchedAgent.mobileNumber,
              referralCode: matchedAgent.referralCode,
              shareUrl: matchedAgent.shareUrl,
              createdAt: matchedAgent.createdAt,
            },
          }
        : {}),
    });
  });

  // Session refresh: keeps cached browser sessions in sync with latest role / agentId / referredBy
  app.get('/api/auth/session', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const mobileNumber = normalizeMobile(req.query?.mobile);
    const userId = String(req.query?.userId || '').trim();
    if (!mobileNumber && !userId) {
      res.status(400).json({ error: 'MISSING_IDENTIFIER' });
      return;
    }

    const { accounts, agents } = reconcileAgentAccounts(resolveRequestOrigin(req));
    const matchedAgent = agents.find(
      (ag) =>
        (mobileNumber && normalizeMobile(ag.mobileNumber) === mobileNumber) ||
        (userId && (ag.id === userId || ag.userId === userId))
    );
    const found = accounts.find(
      (a) =>
        (mobileNumber && normalizeMobile(a.mobileNumber) === mobileNumber) ||
        (userId && a.userId === userId)
    );

    if (!found && !matchedAgent) {
      res.status(404).json({ error: 'SESSION_NOT_FOUND' });
      return;
    }

    const effectiveMobile = found?.mobileNumber || matchedAgent?.mobileNumber || mobileNumber;
    const isAdm = normalizeMobile(effectiveMobile) === ADMIN_MOBILE_NUMBER;
    const role: 'admin' | 'agent' | 'user' = isAdm
      ? 'admin'
      : matchedAgent || found?.role === 'agent'
      ? 'agent'
      : 'user';

    const effectiveUserId = found?.userId || matchedAgent?.id || userId;
    res.json({
      ok: true,
      account: {
        userId: effectiveUserId,
        mobileNumber: effectiveMobile,
        username: found?.username || (matchedAgent ? `Agent_${matchedAgent.id}` : 'User'),
        referredBy: found?.referredBy ?? null,
        referralCode:
          (role === 'agent' && matchedAgent?.referralCode) ||
          found?.referralCode ||
          matchedAgent?.referralCode ||
          `AUREX-${effectiveUserId}`,
        createdAt: found?.createdAt || matchedAgent?.createdAt || nowTimestamp(),
        role,
        ...(matchedAgent
          ? { agentId: matchedAgent.id }
          : found?.agentId
          ? { agentId: found.agentId }
          : {}),
      },
    });
  });

  // Get persisted wallet state for a userId
  app.get('/api/wallet/:userId', (req, res) => {
    const userId = String(req.params.userId || '').trim();
    if (!userId) {
      res.status(400).json({ error: 'Invalid userId' });
      return;
    }
    const wallets = ensureWallets();
    res.json({ wallet: wallets[userId] ?? null });
  });

  // Persist wallet state for a userId
  app.put('/api/wallet/:userId', (req, res) => {
    const userId = String(req.params.userId || '').trim();
    const wallet = req.body?.wallet;
    if (!userId || !wallet || typeof wallet !== 'object') {
      res.status(400).json({ error: 'Invalid wallet payload' });
      return;
    }
    const wallets = ensureWallets();
    wallets[userId] = wallet;
    saveWallets(wallets);

    // Keep StoredAccount referredBy mirrored if wallet carried referral attribution
    const walletObj = wallet as Record<string, unknown>;
    const walletRef =
      typeof walletObj.referredBy === 'string' && walletObj.referredBy.trim()
        ? walletObj.referredBy.trim().toUpperCase()
        : null;
    if (walletRef) {
      const accounts = ensureAccounts();
      const idx = accounts.findIndex((a) => a.userId === userId);
      if (idx !== -1 && !accounts[idx].referredBy && accounts[idx].referralCode !== walletRef) {
        accounts[idx].referredBy = walletRef;
        saveAccounts(accounts);
      }
    }

    res.json({ ok: true });
  });

  // Get all referrals attributed to a referrer code (e.g. AUREX-415061)
  app.get('/api/referrals/:referrerCode', (req, res) => {
    const code = String(req.params.referrerCode || '').trim().toUpperCase();
    if (!code) {
      res.status(400).json({ error: 'Invalid referrer code' });
      return;
    }
    const all = ensureStore();
    const list = all.filter((r) => r.referrerCode === code);
    res.json({ referrals: list });
  });

  // Record a genuine registration from a shared referral link (?ref=...)
  app.post('/api/referrals/register', (req, res) => {
    const referrerCode = String(req.body?.referrerCode || '').trim().toUpperCase();
    const inviteeId = String(req.body?.inviteeId || '').trim();
    const inviteeName = String(req.body?.inviteeName || '').trim() || `User_${inviteeId.slice(-2)}`;

    if (!referrerCode || !inviteeId) {
      res.status(400).json({ error: 'referrerCode and inviteeId are required' });
      return;
    }
    if (referrerCode === `AUREX-${inviteeId}`) {
      res.status(400).json({ error: 'Self-referral is not allowed' });
      return;
    }

    const all = ensureStore();
    const existing = all.find(
      (r) => r.referrerCode === referrerCode && r.inviteeId === inviteeId
    );
    if (existing) {
      res.json({ ok: true, referral: existing });
      return;
    }

    const record: StoredReferral = {
      id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      referrerCode,
      inviteeId,
      inviteeName,
      codeUsed: referrerCode,
      registeredAt: nowTimestamp(),
      status: 'registered',
    };

    all.unshift(record);
    saveStore(all);
    res.json({ ok: true, referral: record });
  });

  // Mark a registered referral as order-completed once they finish an approved order
  app.post('/api/referrals/complete', (req, res) => {
    const inviteeId = String(req.body?.inviteeId || '').trim();
    const referrerCode = req.body?.referrerCode
      ? String(req.body.referrerCode).trim().toUpperCase()
      : null;

    if (!inviteeId) {
      res.status(400).json({ error: 'inviteeId is required' });
      return;
    }

    const all = ensureStore();
    let updated = false;
    const now = nowTimestamp();

    const next = all.map((r) => {
      const matchCode = referrerCode ? r.referrerCode === referrerCode : true;
      if (matchCode && r.inviteeId === inviteeId && r.status === 'registered') {
        updated = true;
        return {
          ...r,
          status: 'completed' as const,
          completedAt: now,
        };
      }
      return r;
    });

    if (updated) {
      saveStore(next);
    }

    res.json({ ok: true, updated });
  });

  // List withdrawal requests (all for Admin +91 7285009425; scoped to userId otherwise)
  app.get('/api/withdrawals', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const all = ensureWithdrawals();
    if (isAdminRequest(req)) {
      res.json({ withdrawals: all });
      return;
    }
    const queryUserId = String(req.query?.userId || '').trim();
    const queryAgentId = String(req.query?.agentId || '').trim();
    const filtered =
      queryUserId || queryAgentId
        ? all.filter(
            (w) =>
              (queryUserId && (w.userId === queryUserId || w.agentId === queryUserId)) ||
              (queryAgentId && (w.agentId === queryAgentId || w.userId === queryAgentId))
          )
        : [];
    res.json({ withdrawals: filtered });
  });

  // Record a new withdrawal request (minimum ₹1,500 for users, ₹200 for agents)
  app.post('/api/withdrawals', (req, res) => {
    const amount = Number(req.body?.amount);
    const method = req.body?.method;
    const requesterRole: 'agent' | 'user' =
      req.body?.requesterRole === 'agent' ? 'agent' : 'user';
    const agentId = req.body?.agentId
      ? String(req.body.agentId).trim().slice(0, 64)
      : undefined;
    const userId = String(req.body?.userId || agentId || '').trim();
    const username =
      String(req.body?.username || '').trim() ||
      (requesterRole === 'agent' && agentId ? `Agent_${agentId}` : 'User');
    const userMobile = req.body?.userMobile
      ? String(req.body.userMobile).replace(/\D/g, '')
      : undefined;
    const txId = String(req.body?.txId || '').trim() || `tx-${Date.now()}`;

    if (requesterRole === 'agent') {
      if (!Number.isFinite(amount) || amount < 200) {
        res.status(400).json({ error: 'MIN_AGENT_WITHDRAW_200' });
        return;
      }
    } else if (!Number.isFinite(amount) || amount < 1500) {
      res.status(400).json({ error: 'MIN_WITHDRAW_1500' });
      return;
    }
    if (method !== 'upi' && method !== 'bank' && method !== 'mobile') {
      res.status(400).json({ error: 'INVALID_METHOD' });
      return;
    }
    if (!userId) {
      res.status(400).json({ error: 'INVALID_USER' });
      return;
    }

    if (requesterRole === 'agent') {
      const origin = resolveRequestOrigin(req);
      const { agents } = reconcileAgentAccounts(origin);
      const normMob = userMobile ? normalizeMobile(userMobile) : '';
      const matchedAgent = agents.find(
        (a) =>
          (agentId && (a.id === agentId || a.userId === agentId)) ||
          a.id === userId ||
          a.userId === userId ||
          (normMob && normalizeMobile(a.mobileNumber) === normMob)
      );
      if (matchedAgent) {
        const stats = computeAgentStats(matchedAgent);
        if (amount > stats.availableBalance + 0.01) {
          res.status(400).json({ error: 'INSUFFICIENT_AGENT_BALANCE' });
          return;
        }
      }
    }

    const upiId = req.body?.upiId ? String(req.body.upiId).trim().slice(0, 100) : undefined;
    const bankName = req.body?.bankName ? String(req.body.bankName).trim().slice(0, 100) : undefined;
    const accountNumber = req.body?.accountNumber ? String(req.body.accountNumber).trim().slice(0, 32) : undefined;
    const ifscCode = req.body?.ifscCode ? String(req.body.ifscCode).trim().toUpperCase().slice(0, 20) : undefined;
    const mobileNumber = req.body?.mobileNumber ? String(req.body.mobileNumber).replace(/\D/g, '') : undefined;

    let accountDetailSummary = '';
    if (method === 'upi') {
      if (!upiId || !upiId.includes('@')) {
        res.status(400).json({ error: 'INVALID_UPI' });
        return;
      }
      accountDetailSummary = `UPI ID: ${upiId}`;
    } else if (method === 'bank') {
      if (!bankName || !accountNumber || accountNumber.length < 6) {
        res.status(400).json({ error: 'INVALID_BANK' });
        return;
      }
      accountDetailSummary = ifscCode
        ? `${bankName} · A/C ${accountNumber} · IFSC ${ifscCode}`
        : `${bankName} · A/C ${accountNumber}`;
    } else {
      if (!mobileNumber || mobileNumber.length !== 10) {
        res.status(400).json({ error: 'INVALID_MOBILE' });
        return;
      }
      accountDetailSummary = `Mobile: +91 ${mobileNumber}`;
    }

    const status: 'Pending' | 'Success' | 'Rejected' =
      req.body?.status === 'Success' ? 'Success' : 'Pending';

    const record: StoredWithdrawal = {
      id: String(req.body?.id || `wdr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
      txId,
      userId,
      username,
      userMobile,
      amount: Math.round((amount + Number.EPSILON) * 100) / 100,
      method,
      upiId,
      bankName,
      accountNumber,
      ifscCode,
      mobileNumber,
      accountDetailSummary,
      status,
      createdAt: String(req.body?.createdAt || nowTimestamp()),
      requesterRole,
      ...(agentId ? { agentId } : {}),
    };

    const all = ensureWithdrawals();
    all.unshift(record);
    saveWithdrawals(all);
    res.json({ ok: true, withdrawal: record });
  });

  // Admin approve or reject a withdrawal request (locked to +91 7285009425)
  app.post('/api/withdrawals/:id/status', (req, res) => {
    if (!isAdminRequest(req)) {
      res.status(403).json({ error: 'ADMIN_ONLY' });
      return;
    }
    const id = String(req.params.id || '').trim();
    const nextStatus = req.body?.status;
    if (!id || (nextStatus !== 'Success' && nextStatus !== 'Rejected')) {
      res.status(400).json({ error: 'INVALID_STATUS' });
      return;
    }

    const all = ensureWithdrawals();
    const targetIndex = all.findIndex((w) => w.id === id);
    if (targetIndex === -1) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }

    const target = all[targetIndex];
    if (target.status !== 'Pending') {
      res.json({ ok: true, withdrawal: target });
      return;
    }

    const now = nowTimestamp();
    const updated: StoredWithdrawal = {
      ...target,
      status: nextStatus,
      processedAt: now,
    };
    all[targetIndex] = updated;
    saveWithdrawals(all);

    // Sync target user's stored wallet if present on server
    const wallets = ensureWallets();
    const targetWallet = wallets[target.userId] as Record<string, unknown> | undefined;
    if (targetWallet && typeof targetWallet === 'object') {
      const txs = Array.isArray(targetWallet.transactions)
        ? (targetWallet.transactions as Array<Record<string, unknown>>)
        : [];
      const notifs = Array.isArray(targetWallet.notifications)
        ? (targetWallet.notifications as Array<Record<string, unknown>>)
        : [];

      const updatedTxs = txs.map((tx) =>
        tx.id === target.txId ? { ...tx, status: nextStatus } : tx
      );

      let nextBalance = Number(targetWallet.walletBalance ?? 0);
      let nextTotalWithdrawal = Number(targetWallet.totalWithdrawal ?? 0);
      if (nextStatus === 'Rejected') {
        nextBalance = Math.round((nextBalance + target.amount + Number.EPSILON) * 100) / 100;
        nextTotalWithdrawal = Math.max(
          0,
          Math.round((nextTotalWithdrawal - target.amount + Number.EPSILON) * 100) / 100
        );
      }

      const notif = {
        id: `notif-wdr-${Date.now()}`,
        title: nextStatus === 'Success' ? 'Withdrawal Approved & Paid' : 'Withdrawal Rejected · Refunded',
        titleZh: nextStatus === 'Success' ? '提现已审核通过并打款' : '提现已拒绝 · 余额已退回',
        message:
          nextStatus === 'Success'
            ? `₹${target.amount} withdrawal to ${target.accountDetailSummary} was approved.`
            : `₹${target.amount} withdrawal to ${target.accountDetailSummary} was rejected and refunded to your wallet.`,
        messageZh:
          nextStatus === 'Success'
            ? `向 ${target.accountDetailSummary} 提现 ₹${target.amount} 已通过并打款。`
            : `向 ${target.accountDetailSummary} 提现 ₹${target.amount} 已被拒绝，金额已退回您的钱包。`,
        timestamp: now,
        read: false,
        kind: 'withdrawal',
      };

      wallets[target.userId] = {
        ...targetWallet,
        walletBalance: nextBalance,
        totalWithdrawal: nextTotalWithdrawal,
        transactions: updatedTxs,
        notifications: [notif, ...notifs],
      };
      saveWallets(wallets);
    }

    res.json({ ok: true, withdrawal: updated });
  });

  // Admin: list all registered user profiles with wallet summary (locked to +91 7285009425)
  app.get('/api/admin/users', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!isAdminRequest(req)) {
      res.status(403).json({ error: 'ADMIN_ONLY' });
      return;
    }
    const accounts = ensureAdminAccountSeeded();
    const wallets = ensureWallets();

    const byUserId = new Map<
      string,
      {
        userId: string;
        mobileNumber: string;
        username: string;
        hasPassword: boolean;
        referralCode: string;
        referredBy: string | null;
        createdAt: string;
        walletBalance: number;
        totalPaid: number;
        totalWithdrawal: number;
        linkedAppName?: string;
        upiId?: string;
      }
    >();

    for (const acc of accounts) {
      const w = wallets[acc.userId] as Record<string, unknown> | undefined;
      const profile =
        w && typeof w.profile === 'object' && w.profile
          ? (w.profile as Record<string, unknown>)
          : undefined;
      const linkedApp =
        w && typeof w.linkedPaymentApp === 'object' && w.linkedPaymentApp
          ? (w.linkedPaymentApp as Record<string, unknown>)
          : undefined;

      byUserId.set(acc.userId, {
        userId: acc.userId,
        mobileNumber: acc.mobileNumber,
        username: acc.username,
        hasPassword: Boolean(acc.passwordHash),
        referralCode: acc.referralCode,
        referredBy: acc.referredBy,
        createdAt: acc.createdAt,
        walletBalance: w ? Number(w.walletBalance ?? 0) : 0,
        totalPaid: w ? Number(w.totalPaid ?? 0) : 0,
        totalWithdrawal: w ? Number(w.totalWithdrawal ?? 0) : 0,
        linkedAppName:
          linkedApp && typeof linkedApp.appName === 'string'
            ? linkedApp.appName
            : undefined,
        upiId:
          profile && typeof profile.upiId === 'string'
            ? profile.upiId
            : undefined,
      });
    }

    // Also include any active users persisted in wallets.json (e.g. from prior session)
    for (const [walletUserId, rawWallet] of Object.entries(wallets)) {
      if (byUserId.has(walletUserId)) continue;
      if (!rawWallet || typeof rawWallet !== 'object') continue;
      const w = rawWallet as Record<string, unknown>;
      const authAcc =
        typeof w.authAccount === 'object' && w.authAccount
          ? (w.authAccount as Record<string, unknown>)
          : undefined;
      const profile =
        typeof w.profile === 'object' && w.profile
          ? (w.profile as Record<string, unknown>)
          : undefined;
      const linkedApp =
        typeof w.linkedPaymentApp === 'object' && w.linkedPaymentApp
          ? (w.linkedPaymentApp as Record<string, unknown>)
          : undefined;

      const mobileNumber = String(
        authAcc?.mobileNumber ||
          profile?.mobileNumber ||
          linkedApp?.mobileNumber ||
          ''
      ).replace(/\D/g, '');
      const username = String(
        authAcc?.username || profile?.username || ''
      ).trim();

      if (!username && !mobileNumber) continue;

      byUserId.set(walletUserId, {
        userId: walletUserId,
        mobileNumber: mobileNumber || '—',
        username: username || `User_${walletUserId.slice(-2)}`,
        hasPassword: false,
        referralCode: String(
          authAcc?.referralCode || `AUREX-${walletUserId}`
        ),
        referredBy:
          typeof authAcc?.referredBy === 'string'
            ? authAcc.referredBy
            : typeof w.referredBy === 'string'
            ? w.referredBy
            : null,
        createdAt: String(
          authAcc?.createdAt ||
            linkedApp?.linkedAt ||
            nowTimestamp()
        ),
        walletBalance: Number(w.walletBalance ?? 0),
        totalPaid: Number(w.totalPaid ?? 0),
        totalWithdrawal: Number(w.totalWithdrawal ?? 0),
        linkedAppName:
          linkedApp && typeof linkedApp.appName === 'string'
            ? linkedApp.appName
            : undefined,
        upiId:
          profile && typeof profile.upiId === 'string'
            ? profile.upiId
            : undefined,
      });
    }

    res.json({ users: Array.from(byUserId.values()) });
  });

  // Admin: reset a user's password (locked to +91 7285009425)
  app.post('/api/admin/users/:userId/reset-password', (req, res) => {
    if (!isAdminRequest(req)) {
      res.status(403).json({ error: 'ADMIN_ONLY' });
      return;
    }
    const userId = String(req.params.userId || '').trim();
    const newPassword = String(req.body?.newPassword || '');
    if (!userId || newPassword.length < 6) {
      res.status(400).json({ error: 'INVALID_PASSWORD' });
      return;
    }

    const accounts = ensureAccounts();
    const idx = accounts.findIndex((a) => a.userId === userId);
    if (idx === -1) {
      const wallets = ensureWallets();
      const w = wallets[userId] as Record<string, unknown> | undefined;
      if (!w || typeof w !== 'object') {
        res.status(404).json({ error: 'USER_NOT_FOUND' });
        return;
      }
      const authAcc =
        typeof w.authAccount === 'object' && w.authAccount
          ? (w.authAccount as Record<string, unknown>)
          : undefined;
      const profile =
        typeof w.profile === 'object' && w.profile
          ? (w.profile as Record<string, unknown>)
          : undefined;
      const mobileNumber = String(
        authAcc?.mobileNumber || profile?.mobileNumber || ''
      ).replace(/\D/g, '');
      const username = String(
        authAcc?.username || profile?.username || `User_${userId.slice(-2)}`
      ).trim();

      accounts.unshift({
        userId,
        mobileNumber,
        username,
        passwordHash: hashPassword(newPassword),
        referredBy:
          typeof authAcc?.referredBy === 'string' ? authAcc.referredBy : null,
        referralCode: String(authAcc?.referralCode || `AUREX-${userId}`),
        createdAt: String(authAcc?.createdAt || nowTimestamp()),
      });
      saveAccounts(accounts);
      res.json({ ok: true });
      return;
    }

    accounts[idx] = {
      ...accounts[idx],
      passwordHash: hashPassword(newPassword),
    };
    saveAccounts(accounts);
    res.json({ ok: true });
  });

  // Get chat messages for a specific user
  app.get('/api/messages/:userId', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const userId = String(req.params.userId || '').trim();
    if (!userId) {
      res.status(400).json({ error: 'INVALID_USER' });
      return;
    }
    const markRead = req.query?.markRead === '1';
    const all = ensureMessages();
    let changed = false;
    const userMsgs = all
      .map((m) => {
        if (markRead && m.userId === userId && m.sender === 'agent' && !m.readByUser) {
          changed = true;
          return { ...m, readByUser: true };
        }
        return m;
      })
      .filter((m) => m.userId === userId);

    if (changed) {
      const updatedAll = all.map((m) =>
        m.userId === userId && m.sender === 'agent' && !m.readByUser
          ? { ...m, readByUser: true }
          : m
      );
      saveMessages(updatedAll);
    }

    res.json({ messages: userMsgs });
  });

  // User sends a support message (text and/or photo)
  app.post('/api/messages', (req, res) => {
    const userId = String(req.body?.userId || '').trim();
    const username = String(req.body?.username || '').trim().slice(0, 64) || 'User';
    const mobileNumber = normalizeMobile(req.body?.mobileNumber) || '—';
    const text = String(req.body?.text || '').trim().slice(0, 1000);
    const hasImageInput = typeof req.body?.imageData === 'string' && req.body.imageData.length > 0;
    const imageUrl = hasImageInput ? saveChatImageDataUrl(req.body.imageData) : undefined;

    if (hasImageInput && !imageUrl) {
      res.status(400).json({ error: 'INVALID_IMAGE' });
      return;
    }
    if (!userId || (!text && !imageUrl)) {
      res.status(400).json({ error: 'INVALID_MESSAGE' });
      return;
    }

    const msg: StoredChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      userId,
      username,
      mobileNumber,
      sender: 'user',
      text,
      ...(imageUrl ? { imageUrl } : {}),
      createdAt: nowTimestamp(),
      readByAdmin: false,
      readByUser: true,
    };

    const all = ensureMessages();
    all.push(msg);
    saveMessages(all);
    res.json({ ok: true, message: msg });
  });

  // Admin: WhatsApp-style inbox of all users & messages (locked to +91 7285009425)
  app.get('/api/admin/messages', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!isAdminRequest(req)) {
      res.status(403).json({ error: 'ADMIN_ONLY' });
      return;
    }

    const allMessages = ensureMessages();
    const accounts = ensureAdminAccountSeeded();
    const wallets = ensureWallets();

    const threadsMap = new Map<
      string,
      {
        userId: string;
        username: string;
        mobileNumber: string;
        referralCode?: string;
        unreadCount: number;
        lastMessage?: string;
        lastTime?: string;
        messages: StoredChatMessage[];
      }
    >();

    // Seed every registered / wallet user profile so audience profiles appear like WhatsApp contacts
    for (const acc of accounts) {
      threadsMap.set(acc.userId, {
        userId: acc.userId,
        username: acc.username,
        mobileNumber: acc.mobileNumber,
        referralCode: acc.referralCode,
        unreadCount: 0,
        messages: [],
      });
    }

    for (const [walletUserId, rawWallet] of Object.entries(wallets)) {
      if (threadsMap.has(walletUserId)) continue;
      if (!rawWallet || typeof rawWallet !== 'object') continue;
      const w = rawWallet as Record<string, unknown>;
      const authAcc =
        typeof w.authAccount === 'object' && w.authAccount
          ? (w.authAccount as Record<string, unknown>)
          : undefined;
      const profile =
        typeof w.profile === 'object' && w.profile
          ? (w.profile as Record<string, unknown>)
          : undefined;
      const linkedApp =
        typeof w.linkedPaymentApp === 'object' && w.linkedPaymentApp
          ? (w.linkedPaymentApp as Record<string, unknown>)
          : undefined;

      const mobileNumber = normalizeMobile(
        authAcc?.mobileNumber || profile?.mobileNumber || linkedApp?.mobileNumber
      );
      const username = String(authAcc?.username || profile?.username || '').trim();
      if (!username && !mobileNumber) continue;

      threadsMap.set(walletUserId, {
        userId: walletUserId,
        username: username || `User_${walletUserId.slice(-2)}`,
        mobileNumber: mobileNumber || '—',
        referralCode: String(authAcc?.referralCode || `AUREX-${walletUserId}`),
        unreadCount: 0,
        messages: [],
      });
    }

    for (const msg of allMessages) {
      let thread = threadsMap.get(msg.userId);
      if (!thread) {
        thread = {
          userId: msg.userId,
          username: msg.username || `User_${msg.userId.slice(-2)}`,
          mobileNumber: msg.mobileNumber || '—',
          referralCode: `AUREX-${msg.userId}`,
          unreadCount: 0,
          messages: [],
        };
        threadsMap.set(msg.userId, thread);
      }
      if (msg.username && (!thread.username || thread.username.startsWith('User_'))) {
        thread.username = msg.username;
      }
      if (msg.mobileNumber && msg.mobileNumber !== '—' && (!thread.mobileNumber || thread.mobileNumber === '—')) {
        thread.mobileNumber = msg.mobileNumber;
      }
      thread.messages.push(msg);
      thread.lastMessage = msg.text || (msg.imageUrl ? '📷 Photo' : '');
      thread.lastTime = msg.createdAt;
      if (msg.sender === 'user' && !msg.readByAdmin) {
        thread.unreadCount += 1;
      }
    }

    // Sort: threads with latest messages at top (newest first), then contacts without messages
    const threads = Array.from(threadsMap.values()).sort((a, b) => {
      if (a.lastTime && b.lastTime) {
        return b.lastTime.localeCompare(a.lastTime);
      }
      if (a.lastTime) return -1;
      if (b.lastTime) return 1;
      return a.username.localeCompare(b.username);
    });

    res.json({ threads });
  });

  // Admin: reply to a user's message thread (text and/or photo, locked to +91 7285009425)
  app.post('/api/admin/messages/:userId/reply', (req, res) => {
    if (!isAdminRequest(req)) {
      res.status(403).json({ error: 'ADMIN_ONLY' });
      return;
    }
    const userId = String(req.params.userId || '').trim();
    const text = String(req.body?.text || '').trim().slice(0, 1000);
    const hasImageInput = typeof req.body?.imageData === 'string' && req.body.imageData.length > 0;
    const imageUrl = hasImageInput ? saveChatImageDataUrl(req.body.imageData) : undefined;

    if (hasImageInput && !imageUrl) {
      res.status(400).json({ error: 'INVALID_IMAGE' });
      return;
    }
    if (!userId || (!text && !imageUrl)) {
      res.status(400).json({ error: 'INVALID_MESSAGE' });
      return;
    }

    const all = ensureMessages();
    const existingThreadMsg = all.find((m) => m.userId === userId);
    const accounts = ensureAdminAccountSeeded();
    const acc = accounts.find((a) => a.userId === userId);

    const replyMsg: StoredChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      userId,
      username: acc?.username || existingThreadMsg?.username || `User_${userId.slice(-2)}`,
      mobileNumber: acc?.mobileNumber || existingThreadMsg?.mobileNumber || '—',
      sender: 'agent',
      text,
      ...(imageUrl ? { imageUrl } : {}),
      createdAt: nowTimestamp(),
      readByAdmin: true,
      readByUser: false,
    };

    const nextAll = all.map((m) =>
      m.userId === userId && m.sender === 'user' && !m.readByAdmin
        ? { ...m, readByAdmin: true }
        : m
    );
    nextAll.push(replyMsg);
    saveMessages(nextAll);
    res.json({ ok: true, message: replyMsg });
  });

  // Admin: mark a user's messages as read (locked to +91 7285009425)
  app.post('/api/admin/messages/:userId/read', (req, res) => {
    if (!isAdminRequest(req)) {
      res.status(403).json({ error: 'ADMIN_ONLY' });
      return;
    }
    const userId = String(req.params.userId || '').trim();
    const all = ensureMessages();
    let changed = false;
    const nextAll = all.map((m) => {
      if (m.userId === userId && m.sender === 'user' && !m.readByAdmin) {
        changed = true;
        return { ...m, readByAdmin: true };
      }
      return m;
    });
    if (changed) {
      saveMessages(nextAll);
    }
    res.json({ ok: true });
  });

  // Shared Admin Orders Feed (so admin-added orders appear across sessions)
  app.get('/api/orders', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ orders: ensureSharedOrders() });
  });

  app.post('/api/orders', (req, res) => {
    if (!isAdminRequest(req)) {
      res.status(403).json({ error: 'ADMIN_ONLY' });
      return;
    }
    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount < 100) {
      res.status(400).json({ error: 'MIN_ORDER_100' });
      return;
    }
    const paymentLink = String(req.body?.paymentLink || 'sunpay://auto')
      .trim()
      .slice(0, 500);
    const order: StoredSharedOrder = {
      id: String(req.body?.id || `adm-ord-${Date.now()}`),
      orderCode: String(
        req.body?.orderCode || `ORD-${Math.floor(1000 + Math.random() * 9000)}`
      ),
      amount: Math.round((amount + Number.EPSILON) * 100) / 100,
      paymentLink: paymentLink || 'sunpay://auto',
      commissionRate: 0.11,
      createdAt: String(req.body?.createdAt || nowTimestamp()),
      status: 'active',
    };
    const all = ensureSharedOrders();
    all.unshift(order);
    saveSharedOrders(all);
    res.json({ ok: true, order });
  });

  app.delete('/api/orders/:id', (req, res) => {
    if (!isAdminRequest(req)) {
      res.status(403).json({ error: 'ADMIN_ONLY' });
      return;
    }
    const id = String(req.params.id || '').trim();
    const next = ensureSharedOrders().filter((o) => o.id !== id);
    saveSharedOrders(next);
    res.json({ ok: true });
  });

  // =========================================================================
  // Order Submissions & Agent Panel Endpoints
  // =========================================================================

  // Agent statistics are computed via top-level computeAgentStats(agent)

  // User submits payment -> saved on server for Admin & Agent Panel visibility
  app.post('/api/order-submissions', (req, res) => {
    const amount = Number(req.body?.amount);
    const orderId = String(req.body?.orderId || '').trim();
    const orderCode = String(req.body?.orderCode || '').trim() || 'ORD-1000';
    const userUid = String(req.body?.userUid || '').trim();
    const userName = String(req.body?.userName || 'User').trim().slice(0, 64);
    const userMobile = req.body?.userMobile ? normalizeMobile(req.body.userMobile) : undefined;
    const paymentLink = String(req.body?.paymentLink || 'sunpay://auto').trim().slice(0, 500);
    const utrRef = String(req.body?.utrRef || '').trim().slice(0, 64);
    let referredBy = req.body?.referredBy
      ? String(req.body.referredBy).trim().toUpperCase().slice(0, 32)
      : null;

    if (!Number.isFinite(amount) || amount <= 0 || !userUid) {
      res.status(400).json({ error: 'INVALID_SUBMISSION' });
      return;
    }

    // Backfill referredBy from persisted accounts / referrals / wallets if missing in payload
    if (!referredBy) {
      const accounts = ensureAccounts();
      const matchedAcc = accounts.find(
        (a) => a.userId === userUid || (userMobile && normalizeMobile(a.mobileNumber) === userMobile)
      );
      if (matchedAcc?.referredBy) {
        referredBy = matchedAcc.referredBy.toUpperCase();
      } else {
        const refs = ensureStore();
        const matchedRef = refs.find((r) => r.inviteeId === userUid);
        if (matchedRef?.referrerCode) {
          referredBy = matchedRef.referrerCode.toUpperCase();
        } else {
          const wallets = ensureWallets();
          const w = wallets[userUid] as Record<string, unknown> | undefined;
          const wRef =
            w && typeof w.referredBy === 'string' && w.referredBy.trim()
              ? w.referredBy.trim().toUpperCase()
              : null;
          if (wRef) referredBy = wRef;
        }
      }
    }

    const subId = String(
      req.body?.id || `sub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    );
    const all = ensureOrderSubmissions();
    const existing = all.find((s) => s.id === subId);
    if (existing) {
      res.json({ ok: true, submission: existing });
      return;
    }

    const now = nowTimestamp();
    const submission: StoredOrderSubmission = {
      id: subId,
      orderId,
      orderCode,
      userUid,
      userName,
      userMobile,
      amount: Math.round((amount + Number.EPSILON) * 100) / 100,
      paymentLink,
      utrRef: utrRef || 'UTR-PENDING',
      referredBy,
      status: 'pending',
      paidAt: now,
      createdAt: now,
    };

    all.unshift(submission);
    saveOrderSubmissions(all);

    // Ensure referral attribution record exists if user has referredBy
    if (referredBy) {
      const referrals = ensureStore();
      const hasRef = referrals.some(
        (r) =>
          r.referrerCode.toUpperCase() === referredBy &&
          r.inviteeId === userUid
      );
      if (!hasRef) {
        referrals.unshift({
          id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          referrerCode: referredBy,
          inviteeId: userUid,
          inviteeName: userName,
          codeUsed: referredBy,
          registeredAt: now,
          status: 'registered',
        });
        saveStore(referrals);
      }
    }

    res.json({ ok: true, submission });
  });

  // Admin: list all user payment submissions across devices
  app.get('/api/admin/order-submissions', (req, res) => {
    if (!isAdminRequest(req)) {
      res.status(403).json({ error: 'ADMIN_ONLY' });
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ submissions: ensureOrderSubmissions() });
  });

  // User: list their own payment submissions to reflect admin approval/rejection
  app.get('/api/order-submissions/user/:userId', (req, res) => {
    const userId = String(req.params.userId || '').trim();
    res.setHeader('Cache-Control', 'no-store');
    const list = ensureOrderSubmissions().filter((s) => s.userUid === userId);
    res.json({ submissions: list });
  });

  // Admin: approve or reject a user payment submission (updates user wallet + agent 5% commission)
  app.post('/api/admin/order-submissions/:id/status', (req, res) => {
    if (!isAdminRequest(req)) {
      res.status(403).json({ error: 'ADMIN_ONLY' });
      return;
    }
    const targetId = String(req.params.id || '').trim();
    const nextStatus = req.body?.status === 'success' ? 'success' : req.body?.status === 'rejected' ? 'rejected' : null;
    if (!targetId || !nextStatus) {
      res.status(400).json({ error: 'INVALID_STATUS' });
      return;
    }

    const all = ensureOrderSubmissions();
    const idx = all.findIndex((s) => s.id === targetId || s.orderId === targetId);
    if (idx === -1) {
      res.status(404).json({ error: 'SUBMISSION_NOT_FOUND' });
      return;
    }

    const prevSub = all[idx];
    if (prevSub.status !== 'pending') {
      res.json({ ok: true, submission: prevSub });
      return;
    }

    const now = nowTimestamp();
    const updatedSub: StoredOrderSubmission = {
      ...prevSub,
      status: nextStatus,
      updatedAt: now,
    };
    all[idx] = updatedSub;
    saveOrderSubmissions(all);

    // Update referral status if approved
    if (nextStatus === 'success') {
      const referrals = ensureStore();
      let refChanged = false;
      const nextRefs = referrals.map((r) => {
        if (r.inviteeId === prevSub.userUid && r.status === 'registered') {
          refChanged = true;
          return { ...r, status: 'completed' as const, completedAt: now };
        }
        return r;
      });
      if (refChanged) {
        saveStore(nextRefs);
      }
    }

    res.json({ ok: true, submission: updatedSub });
  });

  // Admin: list all created Agents with live metrics
  app.get('/api/admin/agents', (req, res) => {
    if (!isAdminRequest(req)) {
      res.status(403).json({ error: 'ADMIN_ONLY' });
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    const origin = resolveRequestOrigin(req);
    const { agents: reconciled } = reconcileAgentAccounts(origin);
    const agents = reconciled.map((ag) => {
      const stats = computeAgentStats(ag);
      return {
        id: ag.id,
        mobileNumber: ag.mobileNumber,
        password: ag.passwordPlain || '••••••',
        referralCode: ag.referralCode,
        shareUrl: `${origin}/?agent=${encodeURIComponent(ag.referralCode)}`,
        createdAt: ag.createdAt,
        loginsCount: stats.joinedCount,
        commissionEarned: stats.commissionEarned,
        totalOrdersCount: stats.totalOrdersCount,
        approvedCount: stats.approvedCount,
        rejectedCount: stats.rejectedCount,
      };
    });
    res.json({ agents });
  });

  // Admin: create a new Agent ID + Mobile Number + Password
  app.post('/api/admin/agents', (req, res) => {
    if (!isAdminRequest(req)) {
      res.status(403).json({ error: 'ADMIN_ONLY' });
      return;
    }
    const mobileNumber = normalizeMobile(req.body?.mobileNumber);
    const password = String(req.body?.password || '').trim();
    if (mobileNumber.length !== 10) {
      res.status(400).json({ error: 'INVALID_MOBILE' });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: 'INVALID_PASSWORD' });
      return;
    }
    if (mobileNumber === ADMIN_MOBILE_NUMBER) {
      res.status(400).json({ error: 'CANNOT_USE_ADMIN_MOBILE' });
      return;
    }

    const origin = resolveRequestOrigin(req);
    const { agents, accounts } = reconcileAgentAccounts(origin);
    if (agents.some((a) => normalizeMobile(a.mobileNumber) === mobileNumber)) {
      res.status(409).json({ error: 'AGENT_EXISTS' });
      return;
    }

    const existingAgentIds = new Set(agents.map((a) => a.id));
    let agentId = `AGT-${Math.floor(1000 + Math.random() * 9000)}`;
    while (existingAgentIds.has(agentId)) {
      agentId = `AGT-${Math.floor(1000 + Math.random() * 9000)}`;
    }
    const referralCode = `AGENT-${agentId}`;
    const shareUrl = `${origin}/?agent=${encodeURIComponent(referralCode)}`;
    const now = nowTimestamp();
    const passwordHash = hashPassword(password);

    const accIdx = accounts.findIndex((a) => normalizeMobile(a.mobileNumber) === mobileNumber);
    const existingAcc = accIdx !== -1 ? accounts[accIdx] : null;
    const aliasCodes = existingAcc
      ? Array.from(
          new Set(
            [
              existingAcc.referralCode,
              `AUREX-${existingAcc.userId}`,
              `AGENT-${existingAcc.userId}`,
            ]
              .map((c) => String(c || '').trim().toUpperCase())
              .filter((c) => c && c !== referralCode)
          )
        )
      : [];

    const newAgent: StoredAgent = {
      id: agentId,
      userId: existingAcc?.userId || agentId,
      mobileNumber,
      passwordHash,
      passwordPlain: password,
      referralCode,
      aliasCodes,
      shareUrl,
      createdAt: now,
    };
    agents.unshift(newAgent);
    saveAgents(agents);

    if (accIdx !== -1) {
      accounts[accIdx] = {
        ...accounts[accIdx],
        passwordHash,
        role: 'agent',
        agentId,
        referralCode,
      };
    } else {
      accounts.unshift({
        userId: agentId,
        mobileNumber,
        username: `Agent_${agentId}`,
        passwordHash,
        referredBy: null,
        referralCode,
        createdAt: now,
        role: 'agent',
        agentId,
      });
    }
    saveAccounts(accounts);

    res.json({
      ok: true,
      agent: {
        id: newAgent.id,
        mobileNumber: newAgent.mobileNumber,
        password,
        referralCode: newAgent.referralCode,
        shareUrl: newAgent.shareUrl,
        createdAt: newAgent.createdAt,
        loginsCount: 0,
        commissionEarned: 0,
      },
    });
  });

  // Admin: bulk sync / restore cached Agents back to server (prevents loss after Vercel update/cold start)
  app.post('/api/admin/agents/sync', (req, res) => {
    if (!isAdminRequest(req)) {
      res.status(403).json({ error: 'ADMIN_ONLY' });
      return;
    }
    const incoming = Array.isArray(req.body?.agents) ? req.body.agents : [];
    const origin = resolveRequestOrigin(req);
    const { agents, accounts } = reconcileAgentAccounts(origin);
    let agentsChanged = false;
    let accountsChanged = false;

    for (const raw of incoming) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Record<string, unknown>;
      const mobileNumber = normalizeMobile(item.mobileNumber);
      if (mobileNumber.length !== 10 || mobileNumber === ADMIN_MOBILE_NUMBER) continue;

      const rawId = String(item.id || '').trim();
      const rawRefCode = String(item.referralCode || '')
        .trim()
        .toUpperCase();
      const agentId = rawId || `AGT-${mobileNumber.slice(-4)}`;
      const referralCode = rawRefCode || `AGENT-${agentId}`;
      const rawPassword = String(item.password || '').trim();
      const hasPlainPassword = rawPassword.length >= 6 && !rawPassword.includes('•');
      const createdAt = String(item.createdAt || nowTimestamp());

      const existingIdx = agents.findIndex(
        (a) => normalizeMobile(a.mobileNumber) === mobileNumber || a.id === agentId
      );
      if (existingIdx === -1) {
        const acc = accounts.find((a) => normalizeMobile(a.mobileNumber) === mobileNumber);
        const passwordHash = hasPlainPassword
          ? hashPassword(rawPassword)
          : acc?.passwordHash || hashPassword(mobileNumber);
        agents.unshift({
          id: agentId,
          userId: acc?.userId || agentId,
          mobileNumber,
          passwordHash,
          ...(hasPlainPassword ? { passwordPlain: rawPassword } : {}),
          referralCode,
          aliasCodes: acc?.referralCode && acc.referralCode.toUpperCase() !== referralCode
            ? [acc.referralCode.toUpperCase()]
            : [],
          shareUrl: `${origin}/?agent=${encodeURIComponent(referralCode)}`,
          createdAt,
        });
        agentsChanged = true;

        if (!acc) {
          accounts.unshift({
            userId: agentId,
            mobileNumber,
            username: `Agent_${agentId}`,
            passwordHash,
            referredBy: null,
            referralCode,
            createdAt,
            role: 'agent',
            agentId,
          });
          accountsChanged = true;
        } else if (acc.role !== 'agent' || acc.agentId !== agentId) {
          acc.role = 'agent';
          acc.agentId = agentId;
          accountsChanged = true;
        }
      } else if (hasPlainPassword && !agents[existingIdx].passwordPlain) {
        agents[existingIdx].passwordPlain = rawPassword;
        agentsChanged = true;
      }
    }

    if (agentsChanged) saveAgents(agents);
    if (accountsChanged) saveAccounts(accounts);

    const mapped = agents.map((ag) => {
      const stats = computeAgentStats(ag);
      return {
        id: ag.id,
        mobileNumber: ag.mobileNumber,
        password: ag.passwordPlain || '••••••',
        referralCode: ag.referralCode,
        shareUrl: `${origin}/?agent=${encodeURIComponent(ag.referralCode)}`,
        createdAt: ag.createdAt,
        loginsCount: stats.joinedCount,
        commissionEarned: stats.commissionEarned,
        totalOrdersCount: stats.totalOrdersCount,
        approvedCount: stats.approvedCount,
        rejectedCount: stats.rejectedCount,
      };
    });
    res.json({ ok: true, agents: mapped });
  });

  // Admin: delete an Agent
  app.delete('/api/admin/agents/:agentId', (req, res) => {
    if (!isAdminRequest(req)) {
      res.status(403).json({ error: 'ADMIN_ONLY' });
      return;
    }
    const agentId = String(req.params.agentId || '').trim();
    const agents = ensureAgents();
    const target = agents.find((a) => a.id === agentId);
    const nextAgents = agents.filter((a) => a.id !== agentId);
    saveAgents(nextAgents);

    if (target) {
      const accounts = ensureAdminAccountSeeded().filter(
        (a) => !(a.role === 'agent' && normalizeMobile(a.mobileNumber) === normalizeMobile(target.mobileNumber))
      );
      saveAccounts(accounts);
    }
    res.json({ ok: true });
  });

  // Agent: fetch scoped dashboard (only users & orders from THIS agent's URL)
  app.get('/api/agent/dashboard', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const origin = resolveRequestOrigin(req);
    const agentMobile = normalizeMobile(req.header('x-agent-mobile') || req.query?.mobile);
    const agentId = String(req.query?.agentId || '').trim();
    const { agents } = reconcileAgentAccounts(origin);
    const agent = agents.find(
      (a) =>
        (agentMobile && normalizeMobile(a.mobileNumber) === agentMobile) ||
        (agentId && (a.id === agentId || a.userId === agentId))
    );
    if (!agent) {
      res.status(404).json({ error: 'AGENT_NOT_FOUND' });
      return;
    }

    const stats = computeAgentStats(agent);
    res.json({
      ok: true,
      agent: {
        id: agent.id,
        mobileNumber: agent.mobileNumber,
        referralCode: agent.referralCode,
        shareUrl: `${origin}/?agent=${encodeURIComponent(agent.referralCode)}`,
        createdAt: agent.createdAt,
      },
      ...stats,
    });
  });

  // =========================================================================
  // SunPay / SilkPay Payment Gateway Routes
  // =========================================================================

  const handleConfigStatus = (_req: express.Request, res: express.Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const cfg = getGatewayConfig();
    res.json({
      ok: true,
      gateway: 'SunPay / SilkPay',
      configured: cfg.configured,
      baseUrl: cfg.baseUrl,
    });
  };
  app.get('/api/gateway/config-status', handleConfigStatus);
  app.get('/api/sunpay/config-status', handleConfigStatus);
  app.get('/api/silkpay/config-status', handleConfigStatus);

  // Create Payin Order (POST /merchant/api/payin/create)
  const handlePayinCreate = async (req: express.Request, res: express.Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const client = createGatewayClient();
    if (!client) {
      res.status(503).json({
        ok: false,
        error: 'GATEWAY_NOT_CONFIGURED',
        message:
          'Gateway API token (SUNPAY_API_TOKEN / SILKPAY_API_TOKEN) is not configured on the server.',
      });
      return;
    }

    const amountNum = Number(req.body?.amount);
    if (!Number.isFinite(amountNum) || amountNum < 10) {
      res.status(400).json({
        ok: false,
        error: 'INVALID_AMOUNT',
        message: 'Minimum payment gateway amount is ₹10.00.',
      });
      return;
    }

    const orderId = String(req.body?.orderId || '').trim();
    const orderCode = String(req.body?.orderCode || '').trim();
    const userId = String(req.body?.userId || '').trim();
    const username = String(req.body?.username || 'VaultPay User').trim().slice(0, 64);
    const mobile = normalizeMobile(req.body?.mobileNumber) || '9876543210';
    const emailSlug = username.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'user';
    const payinEmail = `${emailSlug}@vaultpay89.app`;
    const origin = resolveRequestOrigin(req);
    const merchantOrderNo = `ORD-${Date.now()}-${crypto
      .randomBytes(2)
      .toString('hex')
      .toUpperCase()}`;

    const rawReturnUrl =
      typeof req.body?.returnUrl === 'string' && /^https?:\/\//i.test(req.body.returnUrl)
        ? req.body.returnUrl
        : origin;
    const returnUrlSep = rawReturnUrl.includes('?') ? '&' : '?';
    const returnUrl = `${rawReturnUrl}${returnUrlSep}vp_order=${encodeURIComponent(
      merchantOrderNo
    )}`;
    const notifyUrl = `${origin}/api/payin-webhook`;

    try {
      const result = await client.createPayinOrder({
        merchantOrderNo,
        amount: amountNum.toFixed(2),
        currency: 'INR',
        payinName: username || 'VaultPay User',
        payinPhone: mobile,
        payinEmail,
        notifyUrl,
        returnUrl,
        mark: orderCode || orderId || 'VaultPay Order',
      });

      const records = ensureGatewayOrders();
      records.unshift({
        merchantOrderNo: result.merchantOrderNo || merchantOrderNo,
        gatewayOrderNo: result.gatewayOrderNo,
        type: 'payin',
        orderId: orderId || undefined,
        orderCode: orderCode || undefined,
        userId: userId || undefined,
        username: username || undefined,
        amount: amountNum,
        cashierUrl: result.cashierUrl,
        payinState: result.payinState ?? 1,
        isPaid: result.payinState === 2,
        createdAt: nowTimestamp(),
      });
      saveGatewayOrders(records);

      res.json({
        ok: true,
        gateway: 'SunPay / SilkPay',
        merchantOrderNo: result.merchantOrderNo || merchantOrderNo,
        gatewayOrderNo: result.gatewayOrderNo,
        cashierUrl: result.cashierUrl,
        amount: result.amount,
        payinState: result.payinState,
      });
    } catch (err) {
      if (err instanceof SunPayGatewayError) {
        const httpStatus =
          err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 502;
        res.status(httpStatus).json({
          ok: false,
          error: 'GATEWAY_ERROR',
          code: err.code,
          message: err.message,
        });
        return;
      }
      res.status(502).json({
        ok: false,
        error: 'GATEWAY_ERROR',
        message: err instanceof Error ? err.message : 'Unable to create gateway order',
      });
    }
  };
  app.post('/api/gateway/payin/create', handlePayinCreate);
  app.post('/api/sunpay/payin/create', handlePayinCreate);
  app.post('/api/silkpay/payin/create', handlePayinCreate);

  // Check Payin Status (supports POST body { orderNo } or GET /:orderNo)
  const handlePayinStatus = async (req: express.Request, res: express.Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const client = createGatewayClient();
    if (!client) {
      res.status(503).json({
        ok: false,
        error: 'GATEWAY_NOT_CONFIGURED',
        message: 'Gateway credentials are not configured on the server.',
      });
      return;
    }

    const orderNo = String(
      req.params?.orderNo || req.body?.orderNo || req.query?.orderNo || ''
    ).trim();
    if (!orderNo) {
      res.status(400).json({
        ok: false,
        error: 'ORDER_NO_REQUIRED',
        message: 'orderNo is required',
      });
      return;
    }

    try {
      const status = await client.queryPayinStatus(orderNo);
      const records = ensureGatewayOrders();
      const idx = records.findIndex(
        (r) =>
          r.merchantOrderNo === status.merchantOrderNo ||
          r.merchantOrderNo === orderNo ||
          r.gatewayOrderNo === orderNo
      );
      if (idx !== -1) {
        records[idx] = {
          ...records[idx],
          payinState: status.payinState,
          status: status.status,
          isPaid: Boolean(status.isPaid || status.payinState === 2),
          utr: status.utr ?? records[idx].utr ?? null,
          actualAmount: status.actualAmount,
          settleAmount: status.settleAmount,
          paidAt: status.paidAt ?? records[idx].paidAt ?? null,
          updatedAt: nowTimestamp(),
        };
        saveGatewayOrders(records);
      }

      res.json({ ok: true, ...status });
    } catch (err) {
      if (err instanceof SunPayGatewayError) {
        const httpStatus =
          err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 502;
        res.status(httpStatus).json({
          ok: false,
          error: 'GATEWAY_ERROR',
          code: err.code,
          message: err.message,
        });
        return;
      }
      res.status(502).json({
        ok: false,
        error: 'GATEWAY_ERROR',
        message: err instanceof Error ? err.message : 'Failed to query payin status',
      });
    }
  };
  app.post('/api/gateway/payin/status', handlePayinStatus);
  app.get('/api/gateway/payin/status/:orderNo', handlePayinStatus);
  app.post('/api/sunpay/payin/status', handlePayinStatus);
  app.get('/api/sunpay/payin/status/:orderNo', handlePayinStatus);
  app.post('/api/silkpay/payin/status', handlePayinStatus);
  app.get('/api/silkpay/payin/status/:orderNo', handlePayinStatus);

  // Submit 12-digit UTR for confirmation (POST /merchant/api/payin/utr/submit)
  const handlePayinUtr = async (req: express.Request, res: express.Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const client = createGatewayClient();
    if (!client) {
      res.status(503).json({
        ok: false,
        error: 'GATEWAY_NOT_CONFIGURED',
        message: 'Gateway credentials are not configured on the server.',
      });
      return;
    }

    const merchantOrderNo = String(req.body?.merchantOrderNo || '').trim();
    const utr = String(req.body?.utr || '').trim();
    if (!merchantOrderNo || !utr) {
      res.status(400).json({
        ok: false,
        error: 'INVALID_PARAMS',
        message: 'merchantOrderNo and utr are required',
      });
      return;
    }

    try {
      const data = await client.submitPayinUtr(merchantOrderNo, utr);
      const records = ensureGatewayOrders();
      const idx = records.findIndex((r) => r.merchantOrderNo === merchantOrderNo);
      if (idx !== -1) {
        records[idx] = {
          ...records[idx],
          utr,
          updatedAt: nowTimestamp(),
        };
        saveGatewayOrders(records);
      }
      res.json({ ok: true, data });
    } catch (err) {
      if (err instanceof SunPayGatewayError) {
        const httpStatus =
          err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 502;
        res.status(httpStatus).json({
          ok: false,
          error: 'GATEWAY_ERROR',
          code: err.code,
          message: err.message,
        });
        return;
      }
      res.status(502).json({
        ok: false,
        error: 'GATEWAY_ERROR',
        message: err instanceof Error ? err.message : 'Failed to submit UTR',
      });
    }
  };
  app.post('/api/gateway/payin/utr', handlePayinUtr);
  app.post('/api/sunpay/payin/utr', handlePayinUtr);
  app.post('/api/silkpay/payin/utr', handlePayinUtr);

  // Admin: Payin List & Summary
  const handlePayinList = async (req: express.Request, res: express.Response) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!isAdminRequest(req)) {
      res.status(403).json({ error: 'ADMIN_ONLY' });
      return;
    }
    const client = createGatewayClient();
    if (!client) {
      res.status(503).json({ error: 'GATEWAY_NOT_CONFIGURED' });
      return;
    }
    try {
      const limit = Number(req.query?.limit || 20);
      const offset = Number(req.query?.offset || 0);
      const state = String(req.query?.state || 'all');
      const data = await client.listPayinOrders(limit, offset, state);
      res.json({ ok: true, data });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: 'GATEWAY_ERROR',
        message: err instanceof Error ? err.message : 'Failed to list payin orders',
      });
    }
  };
  app.get('/api/gateway/payin/list', handlePayinList);
  app.get('/api/sunpay/payin/list', handlePayinList);

  const handlePayinSummary = async (req: express.Request, res: express.Response) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!isAdminRequest(req)) {
      res.status(403).json({ error: 'ADMIN_ONLY' });
      return;
    }
    const client = createGatewayClient();
    if (!client) {
      res.status(503).json({ error: 'GATEWAY_NOT_CONFIGURED' });
      return;
    }
    try {
      const data = await client.getPayinSummary();
      res.json({ ok: true, data });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: 'GATEWAY_ERROR',
        message: err instanceof Error ? err.message : 'Failed to fetch payin summary',
      });
    }
  };
  app.get('/api/gateway/payin/summary', handlePayinSummary);
  app.get('/api/sunpay/payin/summary', handlePayinSummary);

  // Admin: Merchant Balance, Account & Ledger
  const handleGatewayBalance = async (req: express.Request, res: express.Response) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!isAdminRequest(req)) {
      res.status(403).json({ error: 'ADMIN_ONLY' });
      return;
    }
    const client = createGatewayClient();
    if (!client) {
      res.status(503).json({ error: 'GATEWAY_NOT_CONFIGURED' });
      return;
    }
    try {
      const balance = await client.getBalance();
      res.json({ ok: true, balance });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: 'GATEWAY_ERROR',
        message: err instanceof Error ? err.message : 'Failed to fetch merchant balance',
      });
    }
  };
  app.get('/api/gateway/balance', handleGatewayBalance);
  app.get('/api/sunpay/balance', handleGatewayBalance);
  app.get('/api/silkpay/balance', handleGatewayBalance);

  const handleGatewayLedger = async (req: express.Request, res: express.Response) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!isAdminRequest(req)) {
      res.status(403).json({ error: 'ADMIN_ONLY' });
      return;
    }
    const client = createGatewayClient();
    if (!client) {
      res.status(503).json({ error: 'GATEWAY_NOT_CONFIGURED' });
      return;
    }
    try {
      const limit = Number(req.query?.limit || 50);
      const offset = Number(req.query?.offset || 0);
      const data = await client.getLedger(limit, offset);
      res.json({ ok: true, data });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: 'GATEWAY_ERROR',
        message: err instanceof Error ? err.message : 'Failed to fetch ledger',
      });
    }
  };
  app.get('/api/gateway/ledger', handleGatewayLedger);
  app.get('/api/sunpay/ledger', handleGatewayLedger);

  // Admin: Automated Bank (V2) or UPI (V3) Payout
  const handlePayoutCreate = async (req: express.Request, res: express.Response) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!isAdminRequest(req)) {
      res.status(403).json({ error: 'ADMIN_ONLY' });
      return;
    }
    const client = createGatewayClient();
    if (!client) {
      res.status(503).json({ error: 'GATEWAY_NOT_CONFIGURED' });
      return;
    }

    const withdrawalId = String(req.body?.withdrawalId || '').trim();
    if (!withdrawalId) {
      res.status(400).json({ error: 'WITHDRAWAL_ID_REQUIRED' });
      return;
    }

    const allWithdrawals = ensureWithdrawals();
    const w = allWithdrawals.find((item) => item.id === withdrawalId);
    if (!w) {
      res.status(404).json({ error: 'WITHDRAWAL_NOT_FOUND' });
      return;
    }

    const origin = resolveRequestOrigin(req);
    const merchantOrderNo = `WD-${Date.now()}-${crypto
      .randomBytes(2)
      .toString('hex')
      .toUpperCase()}`;
    const notifyUrl = `${origin}/api/payout-webhook`;

    try {
      let payoutResult: Record<string, unknown>;
      if (w.method === 'bank') {
        if (!w.accountNumber || !w.ifscCode) {
          res.status(400).json({
            error: 'MISSING_BANK_IFSC',
            message: 'Bank account number and IFSC code are required for V2 Bank Payout.',
          });
          return;
        }
        payoutResult = await client.createBankPayout({
          merchantOrderNo,
          amount: w.amount.toFixed(2),
          cashName: w.username,
          cashPhone: normalizeMobile(w.userMobile) || '9876543210',
          cashNumber: w.accountNumber,
          ifsc: w.ifscCode,
          bankName: w.bankName,
          notifyUrl,
        });
      } else if (w.method === 'upi' && w.upiId) {
        payoutResult = await client.createUpiPayout({
          merchantOrderNo,
          amount: w.amount.toFixed(2),
          cashName: w.username,
          cashPhone: normalizeMobile(w.userMobile) || '9876543210',
          cashNumber: w.upiId,
          notifyUrl,
        });
      } else {
        res.status(400).json({
          error: 'UNSUPPORTED_PAYOUT_METHOD',
          message: 'Automated gateway payout supports Bank (V2) and UPI ID (V3) withdrawals.',
        });
        return;
      }

      const gwOrders = ensureGatewayOrders();
      gwOrders.unshift({
        merchantOrderNo: String(payoutResult.merchantOrderNo || merchantOrderNo),
        gatewayOrderNo: payoutResult.gatewayOrderNo
          ? String(payoutResult.gatewayOrderNo)
          : undefined,
        type: 'payout',
        withdrawalId: w.id,
        userId: w.userId,
        username: w.username,
        amount: w.amount,
        cashState: Number(payoutResult.cashState ?? 1),
        createdAt: nowTimestamp(),
      });
      saveGatewayOrders(gwOrders);

      res.json({ ok: true, payout: payoutResult });
    } catch (err) {
      if (err instanceof SunPayGatewayError) {
        const httpStatus =
          err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 502;
        res.status(httpStatus).json({
          ok: false,
          error: 'GATEWAY_ERROR',
          code: err.code,
          message: err.message,
        });
        return;
      }
      res.status(502).json({
        ok: false,
        error: 'GATEWAY_ERROR',
        message: err instanceof Error ? err.message : 'Failed to initiate payout',
      });
    }
  };
  app.post('/api/gateway/payout/create', handlePayoutCreate);
  app.post('/api/sunpay/payout/create', handlePayoutCreate);
  app.post('/api/silkpay/payout/create', handlePayoutCreate);

  // Admin: Query Payout Status
  const handlePayoutStatus = async (req: express.Request, res: express.Response) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!isAdminRequest(req)) {
      res.status(403).json({ error: 'ADMIN_ONLY' });
      return;
    }
    const client = createGatewayClient();
    if (!client) {
      res.status(503).json({ error: 'GATEWAY_NOT_CONFIGURED' });
      return;
    }
    const orderNo = String(req.params?.orderNo || req.body?.orderNo || '').trim();
    if (!orderNo) {
      res.status(400).json({ error: 'ORDER_NO_REQUIRED' });
      return;
    }
    try {
      const status = await client.queryPayoutStatus(orderNo);
      res.json({ ok: true, status });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: 'GATEWAY_ERROR',
        message: err instanceof Error ? err.message : 'Failed to check payout status',
      });
    }
  };
  app.post('/api/gateway/payout/status', handlePayoutStatus);
  app.get('/api/gateway/payout/status/:orderNo', handlePayoutStatus);
  app.post('/api/sunpay/payout/status', handlePayoutStatus);
  app.post('/api/silkpay/payout/status', handlePayoutStatus);

  // MD5-Verified Webhook Receivers (/api/payin-webhook, /api/payout-webhook, /api/gateway/webhook)
  const handleGatewayWebhook = (req: express.Request, res: express.Response) => {
    const client = createGatewayClient();
    if (!client) {
      res.status(503).json({ error: 'Gateway credentials not configured' });
      return;
    }
    const payload = req.body as Record<string, unknown> | undefined;
    const isValid = client.verifyWebhookSignature(payload);
    if (!isValid || !payload) {
      res.status(400).json({ error: 'Invalid signature' });
      return;
    }

    const merchantOrderNo = String(payload.merchantOrderNo || '').trim();
    const gatewayOrderNo = String(payload.gatewayOrderNo || '').trim();
    const records = ensureGatewayOrders();
    const idx = records.findIndex(
      (r) =>
        (merchantOrderNo && r.merchantOrderNo === merchantOrderNo) ||
        (gatewayOrderNo && r.gatewayOrderNo === gatewayOrderNo)
    );

    if (idx !== -1) {
      const payinState =
        typeof payload.payinState === 'number'
          ? payload.payinState
          : Number(payload.payinState);
      const cashState =
        typeof payload.cashState === 'number'
          ? payload.cashState
          : Number(payload.cashState);

      records[idx] = {
        ...records[idx],
        ...(Number.isFinite(payinState)
          ? { payinState, isPaid: payinState === 2 }
          : {}),
        ...(Number.isFinite(cashState) ? { cashState } : {}),
        ...(payload.utr ? { utr: String(payload.utr) } : {}),
        ...(payload.actualAmount ? { actualAmount: String(payload.actualAmount) } : {}),
        ...(payload.settleAmount ? { settleAmount: String(payload.settleAmount) } : {}),
        updatedAt: nowTimestamp(),
      };
      saveGatewayOrders(records);
    }

    res.status(200).send('SUCCESS');
  };
  app.post('/api/payin-webhook', handleGatewayWebhook);
  app.post('/api/payout-webhook', handleGatewayWebhook);
  app.post('/api/gateway/webhook', handleGatewayWebhook);
  app.post('/api/sunpay/webhook', handleGatewayWebhook);
  app.post('/api/silkpay/webhook', handleGatewayWebhook);

  return app;
}

export const app = createApp();
export default app;

async function startStandaloneServer() {
  const port = Number(process.env.PORT) || 3000;

  if (process.env.NODE_ENV !== 'production') {
    const vitePkg = 'vite';
    const { createServer: createViteServer } = await import(vitePkg);
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${port}`);
  });
}

const isStandaloneEntry =
  !IS_VERCEL &&
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  Boolean(process.argv[1]) &&
  path.basename(process.argv[1]).startsWith('server.');

if (isStandaloneEntry) {
  void startStandaloneServer();
}
