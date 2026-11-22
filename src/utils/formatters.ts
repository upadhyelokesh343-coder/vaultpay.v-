export const COMMISSION_RATE = 0.11; // Fixed Flat 11%
export const MIN_WITHDRAW_AMOUNT = 1500;
export const MIN_AGENT_WITHDRAW_AMOUNT = 200;
export const ADMIN_MOBILE_NUMBER = '7285009425';

export function normalizeIndianMobile(mobile?: string | null): string {
  if (!mobile) return '';
  const digits = mobile.replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function isAdminMobile(mobile?: string | null): boolean {
  return normalizeIndianMobile(mobile) === ADMIN_MOBILE_NUMBER;
}

export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateCommission(orderAmount: number): {
  principal: number;
  commission: number;
  totalReturn: number;
} {
  const principal = roundCurrency(orderAmount);
  const commission = roundCurrency(principal * COMMISSION_RATE);
  const totalReturn = roundCurrency(principal + commission);
  return { principal, commission, totalReturn };
}

export function formatINR(amount: number, showDecimals = true): string {
  const abs = Math.abs(amount);
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  }).format(abs);
  return `₹${formatted}`;
}

export function formatTimestamp(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function generateRefId(prefix: string): string {
  const rand = Math.floor(100000 + Math.random() * 900000);
  return `${prefix}-${rand}`;
}
