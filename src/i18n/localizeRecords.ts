import { AppNotification, Transaction } from '../types/wallet';
import { Language } from './translations';

function stripAdminWordEn(text: string): string {
  return text
    .replace(/Awaiting Admin Approval/gi, 'Awaiting Approval')
    .replace(/Pending Admin Approval/gi, 'Pending Approval')
    .replace(/Pending Admin/gi, 'Pending')
    .replace(/Rejected by Admin/gi, 'Payment Rejected')
    .replace(/Admin approved /gi, 'Approved ')
    .replace(/Admin rejected payment/gi, 'Payment rejected')
    .replace(/Admin sent a /gi, 'New ')
    .replace(/Waiting for Admin approval/gi, 'Waiting for verification')
    .replace(/\bAdmin orders\b/gi, 'orders')
    .replace(/\bAdmin\b\s*/gi, '')
    .trim();
}

export function localizeTransaction(
  tx: Transaction,
  lang: Language
): { title: string; subtitle: string } {
  if (lang === 'en') {
    return {
      title: stripAdminWordEn(tx.title),
      subtitle: stripAdminWordEn(tx.subtitle),
    };
  }

  if (tx.titleZh && tx.subtitleZh) {
    return {
      title: tx.titleZh.replace(/管理员/g, ''),
      subtitle: tx.subtitleZh.replace(/已被管理员拒绝/g, '已被拒绝').replace(/管理员/g, ''),
    };
  }

  let title = tx.title;
  let subtitle = tx.subtitle;

  if (title === 'Order Payment Link') title = '订单支付链接';
  else if (title === 'Order Approved · +11% Payout') title = '订单已通过 · +11% 返现到账';
  else if (title === 'Withdrawal') title = '提现';
  else if (title === 'Daily Task Check-in Reward') title = '每日任务签到奖励';
  else if (title === 'Referral Bonus (5 Qualified)') title = '邀请奖励（满5位达标好友）';
  else if (title.startsWith('Order Payment (')) {
    title = title.replace('Order Payment', '订单付款');
  } else if (title.startsWith('Order Rejected (')) {
    title = title.replace('Order Rejected', '订单已拒绝');
  }

  if (subtitle === 'Link Session Expired') subtitle = '链接会话已过期';
  else if (
    subtitle === 'Rejected by Admin · No wallet payout' ||
    subtitle === 'Payment Rejected · No wallet payout'
  ) {
    subtitle = '订单已拒绝 · 未发放钱包收益';
  } else if (
    subtitle.includes('Awaiting Admin Approval') ||
    subtitle.includes('Awaiting Approval')
  ) {
    subtitle = subtitle
      .replace('Awaiting Admin Approval', '等待审核')
      .replace('Awaiting Approval', '等待审核')
      .replace('Paid ', '已付 ');
  } else if (subtitle.includes('Credited')) {
    subtitle = subtitle
      .replace('Paid ', '已付 ')
      .replace('Credited', '已到账');
  } else if (subtitle.includes('Attendance Bonus')) {
    subtitle = subtitle.replace('Day ', '第 ').replace(' Attendance Bonus', ' 天签到奖励');
  }

  return { title, subtitle };
}

export function localizeNotification(
  n: AppNotification,
  lang: Language
): { title: string; message: string } {
  if (lang === 'en') {
    return {
      title: stripAdminWordEn(n.title),
      message: stripAdminWordEn(n.message),
    };
  }

  if (n.titleZh && n.messageZh) {
    return {
      title: n.titleZh.replace(/管理员/g, ''),
      message: n.messageZh
        .replace(/管理员已通过/g, '已通过')
        .replace(/管理员拒绝了/g, '已拒绝')
        .replace(/管理员派发了一笔/g, '新增一笔')
        .replace(/管理员/g, ''),
    };
  }

  let title = n.title;
  let message = n.message;

  if (title === 'Link Your Payment App') title = '绑定您的支付应用';
  if (
    message ===
      'Verify PhonePe, Paytm, or Google Pay in the Payment tab to start receiving Admin orders.' ||
    message ===
      'Verify PhonePe, Paytm, or Google Pay in the Payment tab to start receiving orders.'
  ) {
    message = '请在“支付”页验证 PhonePe、Paytm 或 Google Pay 后即可开始接收订单。';
  }

  if (title.endsWith(' Connected')) {
    title = title.replace(' Connected', ' 已绑定');
  }
  if (title.startsWith('New Order: ')) {
    title = title.replace('New Order:', '新订单：');
  }
  if (title === 'Payment Submitted · Pending Approval') {
    title = '付款已提交 · 等待审核';
  }
  if (title.startsWith('Order Approved · ')) {
    title = title
      .replace('Order Approved', '订单已通过')
      .replace(' Credited', ' 已到账');
  }
  if (title.startsWith('Order Rejected · ')) {
    title = title.replace('Order Rejected', '订单已拒绝');
  }
  if (title === 'Withdrawal Queued') title = '提现排队处理中';
  if (title === 'Withdrawal Dispatched') title = '提现已发放';
  if (title === 'Daily Check-In Credited') title = '每日签到奖励已到账';

  return { title, message };
}
