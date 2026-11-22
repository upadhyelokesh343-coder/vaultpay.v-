# Firestore Security Specification (Phase 0)

## 1. Data Invariants
1. **Owner & Admin Isolation**: Every `/wallets/{userId}` document, `/wallets/{userId}/private/{docId}`, `/wallets/{userId}/transactions/{txId}`, and `/wallets/{userId}/notifications/{notifId}` belongs strictly to `userId` (`request.auth.uid == userId`) or a verified Admin (`isAdmin()`).
2. **PII Separation**: Mobile numbers, UPI IDs, and bank account details are stored exclusively under `/wallets/{userId}/private/info` and are unreadable by any other user.
3. **Referrer Integrity & Non-Self-Referral**: A `/referrals/{referralId}` document can only be created when `referralId == request.auth.uid`, `inviteeUid == request.auth.uid`, `referrerUid != request.auth.uid`, and `referral_codes/{referrerCode}` exists with matching `ownerUid`.
4. **Terminal State Locking**: Once an `OrderSubmission` reaches `'success'` or `'rejected'`, or a `ReferralRecord` reaches `'completed'`, non-admin clients cannot mutate or reset the terminal status.
5. **Temporal Integrity**: All `createdAt` and `updatedAt` timestamps on creates/updates must equal `request.time`.
6. **Non-Negative Wallet Bounds**: Wallet numeric counters (`walletBalance`, `totalPaid`, `totalWithdrawal`, `totalCashbackEarned`, `referralBonusEarned`) must be `>= 0`.

## 2. Dirty Dozen Attack Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated Read**: Read `/wallets/userA` when `request.auth == null`.
2. **Cross-User Wallet Read**: Read `/wallets/userA` while signed in as `userB`.
3. **Cross-User PII Leak**: Read `/wallets/userA/private/info` while signed in as `userB`.
4. **Self-Referral Forgery**: Create `/referrals/userA` with `referrerUid == 'userA'` and `inviteeUid == 'userA'`.
5. **Fake Referral Status Shortcut**: Create `/referrals/userB` directly with `status: 'completed'` instead of `'registered'`.
6. **Ghost Field Shadow Write**: Create `/wallets/userA` with extra undeclared field `isAdmin: true` or `isVerified: true`.
7. **Admin Order Spoofing**: Non-admin user attempts to create `/admin_orders/ord1`.
8. **Self-Approval Escalation**: Non-admin user updates `/order_submissions/sub1` `status` from `'pending'` to `'success'`.
9. **Terminal State Reversal**: User attempts to update `/referrals/userB` after `status == 'completed'`.
10. **ID Poisoning**: Attempt to write `/wallets/` with a 500-character invalid ID containing spaces/symbols.
11. **Backdated Timestamp Attack**: Create `/order_submissions/sub1` with a spoofed client timestamp instead of `request.time`.
12. **Unfiltered List Scraping**: Execute `list` on `/order_submissions` or `/referrals` without filtering by own UID (when not admin).
