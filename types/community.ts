import type { CalendarSystem } from '@/utils/ethiopianCalendar';
import type { Transaction } from '@/types/database';

export type CommunityGroupKind = 'EQUB' | 'IDDIR';
export type CommunityFrequency = 'WEEKLY' | 'MONTHLY';
export type CommunityScheduleStatus = 'DUE' | 'PARTIAL' | 'PAID' | 'MISSED';

export interface CommunityMember {
  id: string;
  name: string;
  turn: number;
  phone?: string;
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
}

export interface CommunityAuditEntry {
  id: string;
  at: number;
  action: 'CONTRIBUTION' | 'PAYOUT' | 'MISSED' | 'SMS_LINK' | 'CORRECTION' | 'UNDO';
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
