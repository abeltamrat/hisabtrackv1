import type { CalendarSystem } from '@/utils/ethiopianCalendar';
import type { Transaction } from '@/types/database';

export type CommunityGroupKind = 'EQUB' | 'IDDIR';
export type CommunityFrequency = 'WEEKLY' | 'MONTHLY';
export type CommunityScheduleStatus = 'DUE' | 'PARTIAL' | 'PAID' | 'MISSED';
export type EqubMode = 'PERSONAL_TRACKER' | 'GROUP_MANAGED';
export type EqubMigrationStatus = 'NATIVE_V2' | 'MIGRATED' | 'REVIEW_REQUIRED';
export type EqubMemberStatus = 'ACTIVE' | 'SUSPENDED' | 'LEFT' | 'DEFAULTED';
export type EqubShareStatus = 'ACTIVE' | 'TRANSFERRED' | 'CANCELLED';
export type EqubPayoutStatus = 'PENDING' | 'ALLOCATED' | 'PAID' | 'CANCELLED';
export type EqubAllocationMethod = 'FIXED_ORDER' | 'LOTTERY' | 'NEED_BASED' | 'AUCTION' | 'HYBRID';

export interface EqubMemberV2 {
  id: string;
  name: string;
  personId?: string;
  phone?: string;
  emailHint?: string;
  linkedUid?: string;
  notes?: string;
  joinedAt?: number;
  leftAt?: number;
  shareCount: number;
  status: EqubMemberStatus;
}

export interface EqubShareV2 {
  id: string;
  memberId: string;
  shareNumber: number;
  contributionAmount: number;
  payoutPosition?: number;
  status: EqubShareStatus;
}

export interface EqubPayoutEntitlementV2 {
  id: string;
  shareId: string;
  memberId: string;
  grossAmount: number;
  position?: number;
  /** Entitlements may be paid together while remaining distinct for reconciliation. */
  combinedPayoutGroupId?: string;
  status: EqubPayoutStatus;
}

export interface EqubRoundV2 {
  id: string;
  number: number;
  dueDate: number;
  expectedPot: number;
  status: 'OPEN' | 'CLOSED' | 'CANCELLED';
}

export interface EqubMemberObligationV2 {
  id: string;
  roundId: string;
  memberId: string;
  shareId: string;
  amountDue: number;
  amountPaid: number;
  status: 'DUE' | 'PARTIAL' | 'PAID' | 'MISSED';
  penaltyDue: number;
  penaltyPaid: number;
  penaltyWaived: number;
}

export interface EqubPaymentAllocationV2 {
  obligationId: string;
  amount: number;
}

export interface EqubContributionPaymentV2 {
  id: string;
  receiptNumber: string;
  memberId: string;
  amount: number;
  principalAmount: number;
  penaltyAmount: number;
  date: number;
  status: 'ANNOUNCED' | 'RECEIVED' | 'VERIFIED' | 'DISPUTED' | 'REVERSED' | 'VOIDED';
  method?: 'CASH' | 'BANK' | 'TELEBIRR' | 'MPESA' | 'OTHER';
  reference?: string;
  note?: string;
  payerName?: string;
  payerPersonId?: string;
  allocations: EqubPaymentAllocationV2[];
  unappliedAmount: number;
  late: boolean;
  recordedBy?: 'ORGANIZER' | 'MEMBER';
}

export interface EqubPenaltyRuleV2 {
  graceDays: number;
  type: 'NONE' | 'FIXED' | 'PERCENTAGE';
  value: number;
}

export interface EqubMemberCreditV2 {
  memberId: string;
  balance: number;
}

export interface EqubCreditRefundV2 {
  id: string;
  memberId: string;
  amount: number;
  date: number;
  method?: 'CASH' | 'BANK' | 'TELEBIRR' | 'MPESA' | 'OTHER';
  reference?: string;
}

export interface EqubGuarantorV2 {
  id: string;
  memberId: string;
  name: string;
  personId?: string;
  phone?: string;
  linkedUid?: string;
  guaranteedAmount?: number;
  acknowledgedAt?: number;
  status: 'ACTIVE' | 'RELEASED' | 'ENFORCED';
  createdAt: number;
}

export interface EqubRoundFundingAdjustmentV2 {
  id: string;
  roundId: string;
  type: 'ORGANIZER_ADVANCE' | 'REDUCED_POT';
  amount: number;
  reason: string;
  date: number;
}

export interface EqubManagedPayoutV2 {
  id: string;
  roundId: string;
  entitlementIds: string[];
  memberId: string;
  grossAmount: number;
  bidDiscount: number;
  fees: number;
  deductions: number;
  netAmount: number;
  date: number;
  method?: 'CASH' | 'BANK' | 'TELEBIRR' | 'MPESA' | 'OTHER';
  reference?: string;
  status: 'RECORDED' | 'ACKNOWLEDGED' | 'DISPUTED' | 'REVERSED';
}

export interface EqubCycleV2 {
  id: string;
  number: number;
  baseContributionAmount: number;
  memberCount: number;
  totalShares: number;
  potPerRound: number;
  roundCount: number;
  fullCycleValue: number;
  allocationMethod: EqubAllocationMethod;
  members: EqubMemberV2[];
  shares: EqubShareV2[];
  payoutEntitlements: EqubPayoutEntitlementV2[];
  rounds: EqubRoundV2[];
  obligations: EqubMemberObligationV2[];
  contributionPayments: EqubContributionPaymentV2[];
  memberCredits: EqubMemberCreditV2[];
  creditRefunds: EqubCreditRefundV2[];
  penaltyRule: EqubPenaltyRuleV2;
  guarantors: EqubGuarantorV2[];
  fundingAdjustments: EqubRoundFundingAdjustmentV2[];
  managedPayouts: EqubManagedPayoutV2[];
  status: 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
}

/** Versioned bridge carried by Phase 4 records while the normalized group ledger is introduced. */
export interface EqubConfigurationV2 {
  schemaVersion: 2;
  mode: EqubMode;
  cycleId: string;
  baseContributionAmount: number;
  memberCount: number;
  totalShares: number;
  myShares: number;
  allocationMethod: EqubAllocationMethod;
  migrationStatus: EqubMigrationStatus;
}

export interface CommunityMember {
  id: string;
  name: string;
  personId?: string;
  turn: number;
  phone?: string;
  shareCount?: number;
}

export interface CommunityScheduleItem {
  id: string;
  dueDate: number;
  amountDue: number;
  amountPaid: number;
  feePaid?: number;
  status: CommunityScheduleStatus;
  transactionIds: string[];
  smsDraftIds?: string[];
  notificationId?: string;
}

export interface CommunityPayout {
  id: string;
  date: number;
  amount: number;
  fee: number;
  transactionIds: string[];
  smsDraftId?: string;
}

export interface CommunitySnapshot {
  schedule: CommunityScheduleItem[];
  payouts: CommunityPayout[];
  status: CommunityGroup['status'];
  equbCycle?: EqubCycleV2;
}

export interface CommunityAuditEntry {
  id: string;
  at: number;
  action: 'CONTRIBUTION' | 'MANAGED_CONTRIBUTION' | 'MANAGED_REFUND' | 'MANAGED_OVERDUE' | 'MANAGED_ALLOCATION' | 'MANAGED_PAYOUT' | 'PAYOUT' | 'MISSED' | 'SMS_LINK' | 'CORRECTION' | 'UNDO';
  description: string;
  transactionIds: string[];
  createdTransactionIds?: string[];
  linkedTransactionBefore?: Transaction;
  before: CommunitySnapshot;
  undone?: boolean;
}

export interface CommunityGroup {
  id: string;
  kind: CommunityGroupKind;
  name: string;
  currency: string;
  accountId: string;
  contributionAmount: number;
  frequency: CommunityFrequency;
  startDate: number;
  rounds: number;
  myTurn?: number;
  payoutDate?: number;
  payoutAmount?: number;
  recoverable: boolean;
  calendarSystem: Exclude<CalendarSystem, 'BOTH'>;
  reminderEnabled: boolean;
  reminderDaysBefore: number;
  members: CommunityMember[];
  equb?: EqubConfigurationV2;
  /** Present for managed Equbs; personal trackers continue to use the compact schedule above. */
  equbCycle?: EqubCycleV2;
  schedule: CommunityScheduleItem[];
  payouts: CommunityPayout[];
  audit: CommunityAuditEntry[];
  status: 'ACTIVE' | 'COMPLETED' | 'DEFAULTED';
  createdAt: number;
  updatedAt: number;
}

export interface CommunityPosition {
  contributed: number;
  payouts: number;
  fees: number;
  claim: number;
  remainingScheduled: number;
  outstandingObligation: number;
  missed: number;
}
