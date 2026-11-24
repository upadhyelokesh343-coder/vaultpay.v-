export type NavTab = 'home' | 'payment' | 'order' | 'statistics' | 'my';

export type TransactionType =
  | 'order_payout'
  | 'withdrawal'
  | 'daily_bonus'
  | 'referral_bonus';

export type TransactionStatus = 'Success' | 'Pending' | 'Rejected' | 'Closed';

export type AdminOrderStatus = 'active' | 'pending' | 'success' | 'rejected';

export type ReferralStatus = 'registered' | 'completed';

export interface ReferralRecord {
  id: string;
  inviteeId?: string;
  inviteeName: string;
  codeUsed: string;
  registeredAt: string;
  completedAt?: string;
  status: ReferralStatus;
}

export interface LinkedPaymentApp {
  appId: string;
  appName: string;
  mobileNumber: string;
  linkedAt: string;
}

export interface Transaction {
  id: string;
  orderId?: string;
  type: TransactionType;
  title: string;
  titleZh?: string;
  subtitle: string;
  subtitleZh?: string;
  amount: number;
  paidAmount?: number;
  commissionAmount?: number;
  status: TransactionStatus;
  timestamp: string;
  referenceId: string;
}

export interface AdminOrder {
  id: string;
  submissionId?: string;
  userUid?: string;
  userName?: string;
  userMobile?: string;
  orderCode: string;
  amount: number;
  paymentLink: string;
  commissionRate: number;
  createdAt: string;
  paidAt?: string;
  utrRef?: string;
  referredBy?: string | null;
  status: AdminOrderStatus;
}

export interface AppNotification {
  id: string;
  title: string;
  titleZh?: string;
  message: string;
  messageZh?: string;
  timestamp: string;
  read: boolean;
  kind: 'payout' | 'withdrawal' | 'system';
}

export interface AuthAccount {
  userId: string;
  mobileNumber: string;
  username: string;
  referredBy: string | null;
  referralCode: string;
  createdAt: string;
  role?: 'admin' | 'agent' | 'user';
  agentId?: string;
}

export interface UserProfile {
  username: string;
  userId: string;
  mobileNumber?: string;
  upiId: string;
  bankName: string;
  accountLast4: string;
}

export interface SupportMessage {
  id: string;
  sender: 'user' | 'agent';
  text: string;
  time: string;
}

export interface ChatMessage {
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

export interface AdminChatThread {
  userId: string;
  username: string;
  mobileNumber: string;
  referralCode?: string;
  unreadCount: number;
  lastMessage?: string;
  lastTime?: string;
  messages: ChatMessage[];
}

export type WithdrawMethod = 'upi' | 'bank' | 'mobile';

export type WithdrawStatus = 'Pending' | 'Success' | 'Rejected';

export interface WithdrawRequest {
  id: string;
  txId: string;
  userId: string;
  username: string;
  userMobile?: string;
  amount: number;
  method: WithdrawMethod;
  upiId?: string;
  bankName?: string;
  accountNumber?: string;
  ifscCode?: string;
  mobileNumber?: string;
  accountDetailSummary: string;
  status: WithdrawStatus;
  createdAt: string;
  processedAt?: string;
  requesterRole?: 'user' | 'agent';
  agentId?: string;
}

export interface AdminUserRecord {
  userId: string;
  mobileNumber: string;
  username: string;
  hasPassword: boolean;
  password?: string;
  referralCode: string;
  referredBy: string | null;
  createdAt: string;
  walletBalance: number;
  totalPaid: number;
  totalWithdrawal: number;
  linkedAppName?: string;
  upiId?: string;
}

export interface AgentAccount {
  id: string;
  mobileNumber: string;
  email?: string;
  password: string;
  referralCode: string;
  shareUrl: string;
  createdAt: string;
  loginsCount: number;
  commissionEarned: number;
  totalOrdersCount?: number;
  approvedCount?: number;
  rejectedCount?: number;
}

export interface AgentJoinedUser {
  userId: string;
  username: string;
  mobileNumber?: string;
  joinedAt: string;
  status: 'registered' | 'completed';
}

export interface AgentOrderSubmissionItem {
  id: string;
  orderId: string;
  orderCode: string;
  userUid: string;
  userName: string;
  userMobile?: string;
  amount: number;
  utrRef: string;
  referredBy: string | null;
  status: 'pending' | 'success' | 'rejected';
  paidAt: string;
  createdAt: string;
  commissionEarned: number;
}

export interface AgentDashboardData {
  agent: {
    id: string;
    mobileNumber: string;
    referralCode: string;
    shareUrl: string;
    createdAt: string;
  };
  joinedUsers: AgentJoinedUser[];
  joinedCount: number;
  orders: AgentOrderSubmissionItem[];
  totalOrdersCount: number;
  approvedCount: number;
  rejectedCount: number;
  pendingCount: number;
  approvedVolume: number;
  commissionEarned: number;
  withdrawnTotal?: number;
  availableBalance?: number;
  withdrawals?: WithdrawRequest[];
}

export interface AgentLoginState {
  agentId: string;
  mobileNumber: string;
  email?: string;
}

export interface WalletState {
  walletBalance: number;
  totalPaid: number;
  totalWithdrawal: number;
  totalCashbackEarned: number;
  completedOrdersCount: number;
  dailyCheckInDate: string | null;
  streakDays: number;
  defaultPaymentLink: string;
  linkedPaymentApp: LinkedPaymentApp | null;
  adminOrders: AdminOrder[];
  withdrawRequests: WithdrawRequest[];
  referredBy: string | null;
  referrals: ReferralRecord[];
  referralBonusEarned: number;
  referralMilestonesPaid: number;
  authAccount?: AuthAccount | null;
  profile: UserProfile;
  transactions: Transaction[];
  notifications: AppNotification[];
}

