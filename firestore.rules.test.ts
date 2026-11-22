// Reference security assertions verifying the Dirty Dozen payloads against firestore.rules.
export interface DirtyDozenCase {
  id: number;
  name: string;
  collectionPath: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  expected: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_TESTS: DirtyDozenCase[] = [
  { id: 1, name: 'Unauthenticated wallet read', collectionPath: '/wallets/userA', operation: 'get', expected: 'PERMISSION_DENIED' },
  { id: 2, name: 'Cross-user wallet read', collectionPath: '/wallets/userA', operation: 'get', expected: 'PERMISSION_DENIED' },
  { id: 3, name: 'Cross-user PII read', collectionPath: '/wallets/userA/private/info', operation: 'get', expected: 'PERMISSION_DENIED' },
  { id: 4, name: 'Self-referral forgery', collectionPath: '/referrals/userA', operation: 'create', expected: 'PERMISSION_DENIED' },
  { id: 5, name: 'Referral shortcutting directly to completed', collectionPath: '/referrals/userB', operation: 'create', expected: 'PERMISSION_DENIED' },
  { id: 6, name: 'Shadow ghost field on wallet create', collectionPath: '/wallets/userA', operation: 'create', expected: 'PERMISSION_DENIED' },
  { id: 7, name: 'Non-admin creating admin_orders', collectionPath: '/admin_orders/ord1', operation: 'create', expected: 'PERMISSION_DENIED' },
  { id: 8, name: 'Non-admin self-approving order_submission', collectionPath: '/order_submissions/sub1', operation: 'update', expected: 'PERMISSION_DENIED' },
  { id: 9, name: 'Mutating terminal completed referral', collectionPath: '/referrals/userB', operation: 'update', expected: 'PERMISSION_DENIED' },
  { id: 10, name: 'Oversized invalid document ID', collectionPath: '/wallets/invalid id!!', operation: 'create', expected: 'PERMISSION_DENIED' },
  { id: 11, name: 'Client-spoofed createdAt timestamp', collectionPath: '/order_submissions/sub1', operation: 'create', expected: 'PERMISSION_DENIED' },
  { id: 12, name: 'Blanket list scraping on order_submissions', collectionPath: '/order_submissions', operation: 'list', expected: 'PERMISSION_DENIED' },
];
