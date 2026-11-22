import React, { useCallback, useEffect, useState } from 'react';
import { useWalletStore } from './hooks/useWalletStore';
import { usePWAInstall } from './hooks/usePWAInstall';
import { AdminOrder, NavTab } from './types/wallet';
import { useLanguage } from './i18n/LanguageContext';
import { isAdminMobile, normalizeIndianMobile } from './utils/formatters';
import { TopHeader } from './components/TopHeader';
import { BalanceHeroCard } from './components/BalanceHeroCard';
import { OrderGrabSection } from './components/OrderGrabSection';
import {
  OrderBreakdownModal,
  PENDING_GATEWAY_ORDER_KEY,
  PendingGatewayOrder,
} from './components/OrderBreakdownModal';
import { DepositWithdrawModal } from './components/DepositWithdrawModal';
import { AuthPage } from './components/AuthPage';
import { DownloadAppPage } from './components/DownloadAppPage';
import { PaymentView } from './components/PaymentView';
import { WalletView } from './components/WalletView';
import { StatisticsView } from './components/StatisticsView';
import { ProfileView } from './components/ProfileView';
import { SupportWidget } from './components/UtilityModals';
import { BottomNavBar } from './components/BottomNavBar';
import { AgentDashboardView } from './components/AgentDashboardView';
import { LaunchIntroOverlay } from './components/MoneyAnimations';

export default function App() {
  const { lang } = useLanguage();
  const { isStandalone, envChecked } = usePWAInstall();
  const {
    state,
    adminUsers,
    userMessages,
    adminChatThreads,
    registerAccount,
    loginAccount,
    logoutAccount,
    linkPaymentApp,
    unlinkPaymentApp,
    addAdminOrder,
    removeAdminOrder,
    submitOrderPayment,
    approvePendingOrder,
    rejectPendingOrder,
    withdrawFunds,
    approveWithdrawalRequest,
    rejectWithdrawalRequest,
    settlePendingWithdrawal,
    updateProfile,
    markNotificationsRead,
    syncAdminUsersFromServer,
    syncUserMessagesFromServer,
    sendUserSupportMessage,
    syncAdminMessagesFromServer,
    sendAdminChatReply,
    markAdminChatRead,
    resetUserPassword,
  } = useWalletStore(lang);

  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [selectedOrder, setSelectedOrder] = useState<AdminOrder | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [introPhase, setIntroPhase] = useState<'idle' | 'playing' | 'done'>(() =>
    isStandalone ? 'playing' : 'idle'
  );

  useEffect(() => {
    if (isStandalone && introPhase === 'idle') {
      setIntroPhase('playing');
    }
  }, [isStandalone, introPhase]);

  const handleFinishIntro = useCallback(() => {
    setIntroPhase('done');
  }, []);
  const [returningOrderNo] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get('vp_order')?.trim() || null;
    } catch {
      return null;
    }
  });
  const [continueInBrowser, setContinueInBrowser] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('vp_order')) {
        window.sessionStorage.setItem('vaultpay_web_app_open_v1', '1');
        return true;
      }
      return window.sessionStorage.getItem('vaultpay_web_app_open_v1') === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!returningOrderNo || !state.authAccount) return;

    // Clean ?vp_order= from the browser address bar once captured
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has('vp_order')) {
        url.searchParams.delete('vp_order');
        const nextUrl = `${url.pathname}${url.search}${url.hash}`;
        window.history.replaceState({}, '', nextUrl);
      }
    } catch {
      // ignore URL rewrite errors
    }

    let pendingRecord: PendingGatewayOrder | null = null;
    try {
      const raw = window.localStorage.getItem(PENDING_GATEWAY_ORDER_KEY);
      if (raw) {
        pendingRecord = JSON.parse(raw) as PendingGatewayOrder;
      }
    } catch {
      pendingRecord = null;
    }

    let cancelled = false;
    const verifyReturnOrder = async () => {
      try {
        const res = await fetch('/api/gateway/payin/status', {
          method: 'POST',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderNo: returningOrderNo }),
        });
        const contentType = res.headers.get('content-type') || '';
        if (contentType.toLowerCase().includes('application/json')) {
          const data = (await res.json()) as {
            ok?: boolean;
            isPaid?: boolean;
            payinState?: number;
            utr?: string | null;
          };
          if (!cancelled && data.ok && (data.isPaid || data.payinState === 2) && pendingRecord) {
            const matchedOrder = state.adminOrders.find(
              (o) => o.id === pendingRecord?.orderId && o.status === 'active'
            );
            if (matchedOrder) {
              submitOrderPayment(
                matchedOrder.id,
                matchedOrder.amount,
                (data.utr && String(data.utr).trim()) || returningOrderNo
              );
              try {
                window.localStorage.removeItem(PENDING_GATEWAY_ORDER_KEY);
              } catch {
                // ignore
              }
              return;
            }
          }
        }
      } catch {
        // ignore network errors and allow manual recovery below
      }

      if (!cancelled && pendingRecord) {
        const activeMatched = state.adminOrders.find(
          (o) => o.id === pendingRecord?.orderId && o.status === 'active'
        );
        if (activeMatched) {
          setSelectedOrder(activeMatched);
        }
      }
    };

    void verifyReturnOrder();
    return () => {
      cancelled = true;
    };
  }, [returningOrderNo, state.authAccount, state.adminOrders, submitOrderPayment]);

  const isAdminUser = isAdminMobile(state.authAccount?.mobileNumber);

  const handleOpenWebsiteApp = () => {
    try {
      window.sessionStorage.setItem('vaultpay_web_app_open_v1', '1');
    } catch {
      // ignore storage errors
    }
    setContinueInBrowser(true);
  };

  const handleFullLogout = () => {
    try {
      window.sessionStorage.removeItem('vaultpay_web_app_open_v1');
    } catch {
      // ignore storage errors
    }
    setContinueInBrowser(false);
    logoutAccount();
    setActiveTab('home');
  };

  const isAgentUser = (() => {
    if (isAdminUser) return false;
    if (state.authAccount?.role === 'agent' || Boolean(state.authAccount?.agentId)) {
      return true;
    }
    try {
      const raw = window.localStorage.getItem('aurex_vault_agents_v1');
      if (raw) {
        const list = JSON.parse(raw) as Array<{ mobileNumber?: string }>;
        const mob = normalizeIndianMobile(state.authAccount?.mobileNumber);
        return Boolean(
          mob && list.some((a) => normalizeIndianMobile(a.mobileNumber) === mob)
        );
      }
    } catch {
      // ignore storage errors
    }
    return false;
  })();

  const handleOpenWallet = () => {
    setActiveTab('order');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleOpenPaymentApps = () => {
    setActiveTab('payment');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const pendingCount = state.adminOrders.filter((o) => o.status === 'pending').length;
  const isPaymentAppLinked = Boolean(state.linkedPaymentApp);

  const renderContent = () => {
    // Step 1: Always require Login / Sign Up first when clicking any link
    if (!state.authAccount) {
      return (
        <AuthPage
          prefilledReferralCode={state.referredBy}
          onRegister={registerAccount}
          onLogin={loginAccount}
        />
      );
    }

    if (isAgentUser) {
      return (
        <AgentDashboardView
          authAccount={state.authAccount}
          onLogout={handleFullLogout}
        />
      );
    }

    // Step 2: In browser (outside the installed app / APK), show the Download screen with an "Open in Website" option.
    // Inside the installed standalone app or Android APK (isStandalone === true), this Download screen never appears.
    if (!isStandalone && !continueInBrowser) {
      if (!envChecked) {
        return (
          <div className="flex min-h-screen items-center justify-center bg-[#070B14]">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-amber-400/25 border-t-amber-400" />
          </div>
        );
      }
      return (
        <DownloadAppPage
          authAccount={state.authAccount}
          referredBy={state.referredBy}
          onOpenWebsite={handleOpenWebsiteApp}
          onLogout={handleFullLogout}
        />
      );
    }

    return (


    <div className="min-h-screen bg-[#04070E] text-slate-100">
      <div className="relative mx-auto min-h-screen max-w-[430px] border-x border-white/[0.06] bg-[#070B14] pb-20 shadow-2xl shadow-black">
        <TopHeader
          profile={state.profile}
          notifications={state.notifications}
          onSelectTab={setActiveTab}
          onMarkNotificationsRead={markNotificationsRead}
        />

        <main className="px-3.5 pt-3.5">
          {activeTab === 'home' && (
            <div className="space-y-3.5">
              <BalanceHeroCard
                walletBalance={state.walletBalance}
                totalPaid={state.totalPaid}
                totalWithdrawal={state.totalWithdrawal}
                totalCashbackEarned={state.totalCashbackEarned}
                onOpenWallet={handleOpenWallet}
                onOpenWithdraw={() => setWithdrawOpen(true)}
              />

              <OrderGrabSection
                adminOrders={state.adminOrders}
                isPaymentAppLinked={isPaymentAppLinked}
                onSelectOrder={(order) => setSelectedOrder(order)}
                onGoToPaymentApps={handleOpenPaymentApps}
                showPaidStatuses={false}
              />
            </div>
          )}

          {activeTab === 'order' && (
            <WalletView
              state={state}
              onSelectOrder={(order) => setSelectedOrder(order)}
              onOpenWithdraw={() => setWithdrawOpen(true)}
              onSettlePending={settlePendingWithdrawal}
              onGoToPaymentApps={handleOpenPaymentApps}
            />
          )}

          {activeTab === 'payment' && (
            <PaymentView
              linkedPaymentApp={state.linkedPaymentApp}
              onLinkPaymentApp={linkPaymentApp}
              onUnlinkPaymentApp={unlinkPaymentApp}
              onOrdersUnlockedGoHome={() => setActiveTab('home')}
            />
          )}

          {activeTab === 'statistics' && (
            <StatisticsView
              state={state}
              onSettlePending={settlePendingWithdrawal}
            />
          )}

          {activeTab === 'my' && (
            <ProfileView
              isAdmin={isAdminUser}
              walletBalance={state.walletBalance}
              totalPaid={state.totalPaid}
              totalWithdrawal={state.totalWithdrawal}
              defaultPaymentLink={state.defaultPaymentLink}
              profile={state.profile}
              referredBy={state.referredBy}
              authAccount={state.authAccount}
              adminOrders={state.adminOrders}
              withdrawRequests={state.withdrawRequests}
              adminUsers={adminUsers}
              adminChatThreads={adminChatThreads}
              referrals={state.referrals}
              referralBonusEarned={state.referralBonusEarned}
              onSaveProfile={updateProfile}
              onLogoutAccount={handleFullLogout}
              onAddAdminOrder={addAdminOrder}
              onApproveOrder={approvePendingOrder}
              onRejectOrder={rejectPendingOrder}
              onRemoveAdminOrder={removeAdminOrder}
              onApproveWithdrawal={approveWithdrawalRequest}
              onRejectWithdrawal={rejectWithdrawalRequest}
              onUpdateWithdrawStatus={(withdrawalId, status) => {
                if (status === 'Success') {
                  approveWithdrawalRequest(withdrawalId);
                } else {
                  rejectWithdrawalRequest(withdrawalId);
                }
              }}
              onUpdatePaymentSubmissionStatus={(submissionId, status) => {
                if (status === 'success') {
                  approvePendingOrder(submissionId);
                } else {
                  rejectPendingOrder(submissionId);
                }
              }}
              onRefreshAdminUsers={syncAdminUsersFromServer}
              onRefreshAdminMessages={syncAdminMessagesFromServer}
              onSendAdminChatReply={sendAdminChatReply}
              onMarkAdminChatRead={markAdminChatRead}
              onResetUserPassword={resetUserPassword}
            />
          )}
        </main>

        <BottomNavBar
          activeTab={activeTab}
          pendingCount={pendingCount}
          onSelectTab={setActiveTab}
        />

        <SupportWidget
          availableBalance={state.walletBalance}
          messages={userMessages}
          onSendMessage={sendUserSupportMessage}
          onOpenMarkRead={() => {
            void syncUserMessagesFromServer(true);
          }}
        />
      </div>

      <OrderBreakdownModal
        order={selectedOrder}
        isStandalone={isStandalone}
        userInfo={{
          userId: state.profile.userId,
          username: state.profile.username,
          mobileNumber:
            state.authAccount?.mobileNumber || state.profile.mobileNumber,
        }}
        onClose={() => setSelectedOrder(null)}
        onSubmitPayment={submitOrderPayment}
      />

      <DepositWithdrawModal
        isOpen={withdrawOpen}
        walletBalance={state.walletBalance}
        profile={state.profile}
        authMobile={state.authAccount?.mobileNumber}
        onClose={() => setWithdrawOpen(false)}
        onWithdraw={withdrawFunds}
      />
    </div>
    );
  };

  return (
    <>
      {isStandalone && introPhase === 'playing' && (
        <LaunchIntroOverlay onFinish={handleFinishIntro} />
      )}
      {renderContent()}
    </>
  );
}
