import { getFirebaseApp } from '@/config/firebaseApp';
import type {
  FundCategory,
  FundChangelogEntry,
  FundDepositSource,
  FundEntry,
  FundEntryFlag,
  FundEntryKind,
  FundType,
  SharedFund,
  TransactionSplit,
} from '@/types/database';
import { collection, doc, getFirestore, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';

/** Thrown when the backend callable has not been deployed yet. */
export class FundsUnavailableError extends Error {
  constructor() {
    super("Funds isn't available yet. Please try again after the next update.");
    this.name = 'FundsUnavailableError';
  }
}

const FRIENDLY: Record<string, string> = {
  'functions/unauthenticated': 'Sign in again to use funds.',
  'functions/unavailable': "You're offline. It will be saved when you reconnect.",
  'functions/deadline-exceeded': "You're offline. It will be saved when you reconnect.",
  'functions/internal': 'Something went wrong on our side. Please try again.',
};

/** Errors the server will repeat no matter how often the call is retried. */
export const PERMANENT_FUND_ERRORS = new Set([
  'functions/permission-denied',
  'functions/failed-precondition',
  'functions/invalid-argument',
  'functions/already-exists',
  'functions/not-found',
]);

export function fundErrorCode(error: unknown): string {
  return typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : '';
}

export function fundErrorMessage(error: unknown): string {
  if (error instanceof FundsUnavailableError) return error.message;
  const code = fundErrorCode(error);
  if (FRIENDLY[code]) return FRIENDLY[code];
  const message = (error as { message?: unknown })?.message;
  return typeof message === 'string' && message ? message : 'Something went wrong. Please try again.';
}

async function call<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  const { getFunctions, httpsCallable } = await import('firebase/functions');
  try {
    const result = await httpsCallable(getFunctions(getFirebaseApp()), 'mutateSharedFund')({ action, ...payload });
    return result.data as T;
  } catch (error) {
    // Only a missing function maps to "unavailable": the SDK reports it with a
    // bare "not-found" message, while a missing invite carries the server's text.
    if (fundErrorCode(error) === 'functions/not-found' && /^\s*(not[-_ ]?found)?\s*$/i.test(String((error as Error)?.message || ''))) {
      throw new FundsUnavailableError();
    }
    throw error;
  }
}

// ── Defensive parsing: a malformed document is dropped, never thrown. ──────
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const str = (value: unknown) => (typeof value === 'string' ? value : '');
const optStr = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

function parseSplits(value: unknown): TransactionSplit[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const splits = value
    .filter(item => item && typeof item.id === 'string' && typeof item.category === 'string' && Number.isFinite(item.amount))
    .map(item => ({
      id: item.id,
      amount: item.amount,
      category: item.category,
      description: optStr(item.description),
      tags: Array.isArray(item.tags) ? item.tags.filter((tag: unknown) => typeof tag === 'string') : undefined,
    }));
  return splits.length >= 2 ? splits : undefined;
}

export function parseFund(id: string, data: Record<string, any> | undefined): SharedFund | null {
  if (!data || typeof data.ownerUid !== 'string' || !Array.isArray(data.members) || typeof data.name !== 'string') return null;
  const categories: FundCategory[] = Array.isArray(data.categories)
    ? data.categories.filter((c: any) => c && typeof c.name === 'string').map((c: any) => ({
      name: c.name,
      parentName: optStr(c.parentName),
      icon: str(c.icon) || 'folder',
      color: str(c.color) || '#64748b',
      type: c.type === 'income' ? 'income' : 'expense',
    }))
    : [];
  return {
    id,
    ownerUid: data.ownerUid,
    ownerName: str(data.ownerName) || 'Owner',
    custodianUid: typeof data.custodianUid === 'string' ? data.custodianUid : null,
    custodianName: typeof data.custodianName === 'string' ? data.custodianName : null,
    members: data.members.filter((member: unknown) => typeof member === 'string'),
    invitedUid: typeof data.invitedUid === 'string' ? data.invitedUid : null,
    inviteEmailHint: typeof data.inviteEmailHint === 'string' ? data.inviteEmailHint : null,
    inviteCode: typeof data.inviteCode === 'string' ? data.inviteCode : null,
    inviteExpiresAt: num(data.inviteExpiresAt) || undefined,
    name: data.name,
    fundType: (['PETTY_CASH', 'REVOLVING', 'HELD_FOR_ME'] as FundType[]).includes(data.fundType) ? data.fundType : 'PETTY_CASH',
    currency: str(data.currency) || 'ETB',
    floatTarget: typeof data.floatTarget === 'number' && data.floatTarget > 0 ? data.floatTarget : null,
    lowBalancePct: num(data.lowBalancePct) || 20,
    linkStatus: ['PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED'].includes(data.linkStatus) ? data.linkStatus : 'PENDING',
    status: data.status === 'CLOSED' ? 'CLOSED' : 'ACTIVE',
    balance: num(data.balance),
    totalIn: num(data.totalIn),
    totalSpent: num(data.totalSpent),
    totalReturned: num(data.totalReturned),
    pendingIn: num(data.pendingIn),
    entryVersion: num(data.entryVersion),
    categories,
    createdAt: num(data.createdAt),
    updatedAt: num(data.updatedAt),
    acceptedAt: num(data.acceptedAt) || undefined,
    closedAt: num(data.closedAt) || undefined,
  };
}

export function parseEntry(id: string, data: Record<string, any> | undefined): FundEntry | null {
  if (!data || !['DEPOSIT', 'SPEND', 'RETURN'].includes(data.kind) || !(num(data.amount) > 0) || !num(data.date)) return null;
  const flag: FundEntryFlag | undefined = data.flag && typeof data.flag.note === 'string'
    ? {
      byUid: str(data.flag.byUid),
      note: data.flag.note,
      at: num(data.flag.at),
      reply: optStr(data.flag.reply),
      repliedAt: num(data.flag.repliedAt) || undefined,
      resolved: data.flag.resolved === true,
      resolvedAt: num(data.flag.resolvedAt) || undefined,
    }
    : undefined;
  return {
    id,
    kind: data.kind as FundEntryKind,
    source: ['OWNER', 'THIRD_PARTY', 'OWNER_UNRECORDED'].includes(data.source) ? data.source as FundDepositSource : undefined,
    amount: data.amount,
    date: data.date,
    description: str(data.description),
    note: optStr(data.note),
    payerName: optStr(data.payerName),
    recipient: optStr(data.recipient),
    reference_number: optStr(data.reference_number),
    receipt_url: optStr(data.receipt_url),
    sms_linked: data.sms_linked === true,
    category: optStr(data.category),
    splits: parseSplits(data.splits),
    tags: Array.isArray(data.tags) ? data.tags.filter((tag: unknown) => typeof tag === 'string') : undefined,
    recordedByUid: str(data.recordedByUid),
    recordedByRole: data.recordedByRole === 'OWNER' ? 'OWNER' : 'CUSTODIAN',
    createdAt: num(data.createdAt),
    status: ['PENDING', 'ACTIVE', 'VOIDED'].includes(data.status) ? data.status : 'ACTIVE',
    voidReason: optStr(data.voidReason),
    voidedAt: num(data.voidedAt) || undefined,
    ackByUid: optStr(data.ackByUid),
    ackAt: num(data.ackAt) || undefined,
    ownerCategory: typeof data.ownerCategory === 'string' ? data.ownerCategory : null,
    ownerPurpose: data.ownerPurpose === 'OPERATING' || data.ownerPurpose === 'FINANCING' ? data.ownerPurpose : null,
    ownerSplits: parseSplits(data.ownerSplits) ?? null,
    ownerAccountId: typeof data.ownerAccountId === 'string' ? data.ownerAccountId : null,
    classifiedAt: num(data.classifiedAt) || undefined,
    flag,
  };
}

export function fundRole(fund: SharedFund, uid: string | undefined | null): 'OWNER' | 'CUSTODIAN' | 'INVITEE' | null {
  if (!uid) return null;
  if (fund.ownerUid === uid) return 'OWNER';
  if (fund.custodianUid === uid) return 'CUSTODIAN';
  if (fund.invitedUid === uid) return 'INVITEE';
  return null;
}

export function formatInviteCode(code: string | null | undefined): string {
  return code ? `${code.slice(0, 4)}-${code.slice(4)}` : '';
}

export interface FundInviteResult {
  fundId: string;
  code: string | null;
  found: boolean;
  displayName: string | null;
  emailHint: string | null;
}

export interface FundEntryInput {
  kind: FundEntryKind;
  source?: FundDepositSource;
  amount: number;
  date: number;
  description?: string;
  note?: string;
  payerName?: string;
  recipient?: string;
  reference_number?: string;
  receipt_url?: string;
  sms_linked?: boolean;
  category?: string;
  splits?: TransactionSplit[];
  tags?: string[];
  ownerAccountId?: string;
}

const firestore = () => getFirestore(getFirebaseApp());

export class SharedFundService {
  // ── Membership ────────────────────────────────────────────────────────────
  static create(input: {
    fundId: string; name: string; fundType: FundType; currency: string; floatTarget: number | null;
    categories: FundCategory[]; email?: string; myName: string;
  }) {
    return call<FundInviteResult>('create', input);
  }
  static reinvite(fundId: string, email?: string) { return call<FundInviteResult>('reinvite', { fundId, email }); }
  static acceptCode(code: string, myName: string) { return call<{ fundId: string }>('accept', { code, myName }); }
  static acceptInvite(fundId: string, myName: string) { return call<{ fundId: string }>('accept', { fundId, myName }); }
  static decline(fundId: string) { return call('decline', { fundId }); }
  static cancelInvite(fundId: string) { return call('cancel', { fundId }); }
  static leave(fundId: string) { return call('leave', { fundId }); }
  static update(fundId: string, patch: { name?: string; fundType?: FundType; floatTarget?: number | null; lowBalancePct?: number; categories?: FundCategory[] }) {
    return call('update', { fundId, ...patch });
  }
  static close(fundId: string) { return call('close', { fundId }); }
  static reopen(fundId: string) { return call('reopen', { fundId }); }

  // ── Entries ───────────────────────────────────────────────────────────────
  static record(fundId: string, entryId: string, input: FundEntryInput) { return call<{ saved: boolean; existing?: boolean }>('record', { fundId, entryId, ...input }); }
  static announce(fundId: string, entryId: string, input: { amount: number; date: number; payerName: string; note?: string; description?: string }) {
    return call('announce', { fundId, entryId, ...input });
  }
  static ack(fundId: string, entryId: string, evidence: { reference_number?: string; receipt_url?: string; sms_linked?: boolean } = {}) {
    return call('ack', { fundId, entryId, ...evidence });
  }
  static unack(fundId: string, entryId: string) { return call('unack', { fundId, entryId }); }
  static reject(fundId: string, entryId: string, reason?: string) { return call('reject', { fundId, entryId, reason }); }
  static void(fundId: string, entryId: string, reason?: string) { return call('void', { fundId, entryId, reason }); }
  static classify(fundId: string, entryId: string, patch: {
    ownerCategory?: string | null; ownerPurpose?: 'OPERATING' | 'FINANCING' | null;
    ownerSplits?: TransactionSplit[] | null; ownerAccountId?: string | null;
  }) {
    return call('classify', { fundId, entryId, ...patch });
  }
  static flag(fundId: string, entryId: string, note: string) { return call('flag', { fundId, entryId, note }); }
  static reply(fundId: string, entryId: string, reply: string) { return call('reply', { fundId, entryId, reply }); }
  static resolve(fundId: string, entryId: string) { return call('resolve', { fundId, entryId }); }

  // ── Live listeners (every one reports errors instead of throwing) ─────────
  static listenToMyFunds(uid: string, onFunds: (funds: SharedFund[]) => void, onError?: (error: unknown) => void): () => void {
    return onSnapshot(
      query(collection(firestore(), 'sharedFunds'), where('members', 'array-contains', uid)),
      snap => onFunds(snap.docs.map(d => parseFund(d.id, d.data())).filter((fund): fund is SharedFund => !!fund)),
      error => onError?.(error),
    );
  }

  static listenToFund(fundId: string, onFund: (fund: SharedFund | null) => void, onError?: (error: unknown) => void): () => void {
    return onSnapshot(
      doc(firestore(), 'sharedFunds', fundId),
      snap => onFund(snap.exists() ? parseFund(snap.id, snap.data()) : null),
      error => onError?.(error),
    );
  }

  static listenToEntries(fundId: string, max: number, onEntries: (entries: FundEntry[]) => void, onError?: (error: unknown) => void): () => void {
    return onSnapshot(
      query(collection(firestore(), 'sharedFunds', fundId, 'entries'), orderBy('date', 'desc'), limit(max)),
      snap => onEntries(snap.docs.map(d => parseEntry(d.id, d.data())).filter((entry): entry is FundEntry => !!entry)),
      error => onError?.(error),
    );
  }

  static listenToChangelog(fundId: string, onLog: (items: FundChangelogEntry[]) => void, onError?: (error: unknown) => void): () => void {
    return onSnapshot(
      query(collection(firestore(), 'sharedFunds', fundId, 'changelog'), orderBy('timestamp', 'desc'), limit(200)),
      snap => onLog(snap.docs.map(d => {
        const data = d.data();
        return { id: d.id, actorUid: str(data.actorUid), actorName: str(data.actorName), timestamp: num(data.timestamp), action: str(data.action), entryId: optStr(data.entryId) };
      })),
      error => onError?.(error),
    );
  }

  /** One-shot read of every entry, used by the owner's ledger reconciler. */
  static async getAllEntries(fundId: string): Promise<FundEntry[]> {
    const { getDocs } = await import('firebase/firestore');
    const snap = await getDocs(collection(firestore(), 'sharedFunds', fundId, 'entries'));
    return snap.docs.map(d => parseEntry(d.id, d.data())).filter((entry): entry is FundEntry => !!entry);
  }
}
