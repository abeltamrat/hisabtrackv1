import Storage from '@/services/SessionStorage';
import { CommunityGroupService } from '@/services/CommunityGroupService';
import { getDatabase } from '@/services/database';
import { RecurringTransactionService } from '@/services/RecurringTransactionService';
import type { CommunityGroup } from '@/types/community';
import type { Account, Loan, RecurringTransaction, Transaction } from '@/types/database';
import { accountDelta, money, sumMoney } from '@/utils/finance';

export type AuditSeverity = 'CRITICAL' | 'WARNING' | 'INFO';
export type AuditArea = 'DUPLICATES' | 'TRANSFERS' | 'BALANCES' | 'CLASSIFICATION' | 'OBLIGATIONS';

export interface AuditFinding {
  id: string;
  severity: AuditSeverity;
  area: AuditArea;
  title: string;
  explanation: string;
  recommendation: string;
  evidenceIds: string[];
  amount?: number;
  route: string;
}

export interface AuditSnapshot {
  generatedAt: number;
  score: number;
  findings: AuditFinding[];
  counts: Record<AuditSeverity, number>;
  recordsReviewed: number;
}

export interface AuditInput {
  accounts: Account[];
  transactions: Transaction[];
  loans: Loan[];
  recurring: RecurringTransaction[];
  communities: CommunityGroup[];
  now?: number;
}

export interface AuditDecision {
  findingId: string;
  status: 'ACKNOWLEDGED' | 'FALSE_ALARM';
  at: number;
}

const DECISIONS_KEY = 'digital_auditor_decisions_v1';
const SAME_EVENT_WINDOW_MS = 5 * 60 * 1000;
const normalizeReference = (value?: string) => (value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const normalizeWords = (value?: string) => (value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const amountForDuplicate = (row: Transaction) => money(row.type === 'EXPENSE' ? row.gross_amount ?? row.amount : row.amount);
const dayStart = (timestamp: number) => { const date = new Date(timestamp); date.setHours(0, 0, 0, 0); return date.getTime(); };
const findingId = (prefix: string, values: string[]) => {
  let hash = 2166136261;
  for (const character of [...values].sort().join('|')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}:${(hash >>> 0).toString(36)}`;
};

function duplicateFindings(transactions: Transaction[]): AuditFinding[] {
  const rows = transactions
    .filter(row => !row.fund_mirror)
    .sort((left, right) => left.date - right.date);
  const used = new Set<string>();
  const results: AuditFinding[] = [];

  for (let index = 0; index < rows.length; index += 1) {
    const left = rows[index];
    if (used.has(left.id)) continue;
    const leftReference = normalizeReference(left.reference_number);
    const leftWords = normalizeWords(`${left.description} ${left.sender_receiver || ''}`);
    const matches = [left];

    for (let cursor = index + 1; cursor < rows.length; cursor += 1) {
      const right = rows[cursor];
      if (right.date - left.date > SAME_EVENT_WINDOW_MS) break;
      if (used.has(right.id) || left.account_id !== right.account_id || left.type !== right.type || amountForDuplicate(left) !== amountForDuplicate(right)) continue;
      const sameSms = !!left.sms_id && left.sms_id === right.sms_id;
      const rightReference = normalizeReference(right.reference_number);
      const sameReference = leftReference.length >= 4 && leftReference === rightReference;
      const sameWords = leftWords.length >= 6 && leftWords === normalizeWords(`${right.description} ${right.sender_receiver || ''}`) && right.date - left.date <= 60_000;
      if (sameSms || sameReference || sameWords) matches.push(right);
    }

    if (matches.length < 2) continue;
    matches.forEach(row => used.add(row.id));
    const ids = matches.map(row => row.id).sort();
    const evidence = left.sms_id ? 'the same SMS identifier' : leftReference ? `reference ${left.reference_number}` : 'the same amount and description within one minute';
    results.push({
      id: findingId('duplicate', ids),
      severity: 'CRITICAL',
      area: 'DUPLICATES',
      title: `${matches.length} records may describe one transaction`,
      explanation: `These records use ${evidence} on the same account and direction. Keeping all of them may overstate the account movement.`,
      recommendation: 'Open the records, keep the entry supported by the original evidence, and remove a duplicate only after confirming it.',
      evidenceIds: ids,
      amount: amountForDuplicate(left),
      route: `/transaction/${left.id}`,
    });
  }
  return results;
}

function transferFindings(accounts: Account[], transactions: Transaction[]): AuditFinding[] {
  const byId = new Map(accounts.map(account => [account.id, account]));
  return transactions.flatMap(row => {
    if (row.type !== 'TRANSFER') return [];
    const source = byId.get(row.account_id);
    const destination = byId.get(row.to_account_id);
    const problems: string[] = [];
    if (!source) problems.push('the source account is missing');
    if (!destination) problems.push('the destination account is missing');
    if (row.account_id === row.to_account_id) problems.push('the source and destination are the same');
    if (source && destination && source.currency !== destination.currency) problems.push(`the accounts use different currencies (${source.currency} and ${destination.currency})`);
    if (!problems.length) return [];
    return [{
      id: `transfer:${row.id}`,
      severity: 'CRITICAL' as const,
      area: 'TRANSFERS' as const,
      title: 'Transfer needs account review',
      explanation: `This transfer cannot be audited correctly because ${problems.join(' and ')}.`,
      recommendation: 'Open the transaction and select valid source and destination accounts.',
      evidenceIds: [row.id],
      amount: row.amount,
      route: `/transaction/${row.id}`,
    }];
  });
}

function balanceFindings(accounts: Account[], transactions: Transaction[]): AuditFinding[] {
  return accounts.flatMap(account => {
    const calculated = sumMoney(transactions.map(row => accountDelta(row, account.id)));
    const difference = money(account.balance - calculated);
    if (Math.abs(difference) < 0.01) return [];
    return [{
      id: `balance:${account.id}:${calculated}`,
      severity: 'CRITICAL' as const,
      area: 'BALANCES' as const,
      title: `${account.name} ledger does not reconcile`,
      explanation: `The saved balance differs from the total movement in its ledger by ${account.currency} ${Math.abs(difference).toFixed(2)}.`,
      recommendation: 'Review this account before relying on its balance. A recalculation or missing opening-balance record may be needed.',
      evidenceIds: transactions.filter(row => row.account_id === account.id || (row.type === 'TRANSFER' && row.to_account_id === account.id)).map(row => row.id).slice(0, 50),
      amount: Math.abs(difference),
      route: `/account/${account.id}`,
    }];
  });
}

function classificationFindings(transactions: Transaction[]): AuditFinding[] {
  const rows = transactions.filter(row => {
    const category = normalizeWords(row.category);
    return !row.fund_mirror && (!category || category === 'uncategorized' || category === 'unknown');
  });
  if (!rows.length) return [];
  const amount = sumMoney(rows.map(row => row.type === 'EXPENSE' ? row.amount : 0));
  return [{
    id: findingId('classification', rows.map(row => row.id)),
    severity: 'WARNING',
    area: 'CLASSIFICATION',
    title: `${rows.length} transaction${rows.length === 1 ? '' : 's'} need a category`,
    explanation: 'Unclassified records weaken spending reports, budgets, tax review, and project analysis.',
    recommendation: 'Review these records and assign the most specific category supported by their description or receipt.',
    evidenceIds: rows.map(row => row.id),
    amount,
    route: `/transaction/${rows[0].id}`,
  }];
}

function obligationFindings(loans: Loan[], recurring: RecurringTransaction[], communities: CommunityGroup[], now: number): AuditFinding[] {
  const today = dayStart(now);
  const loanRows: AuditFinding[] = loans.flatMap(loan => {
    if (loan.status !== 'ACTIVE' || money(loan.remaining_balance) <= 0 || loan.due_date >= today) return [];
    return [{
      id: `loan-overdue:${loan.id}:${loan.due_date}`,
      severity: 'CRITICAL' as const,
      area: 'OBLIGATIONS' as const,
      title: `Loan with ${loan.lender_borrower_name} is overdue`,
      explanation: `${loan.currency || 'ETB'} ${money(loan.remaining_balance).toFixed(2)} remained open after ${new Date(loan.due_date).toLocaleDateString()}.`,
      recommendation: 'Confirm the balance and record any repayment, extension, settlement, or default decision.',
      evidenceIds: [loan.id],
      amount: money(loan.remaining_balance),
      route: `/loan/${loan.id}`,
    }];
  });

  const recurringRows: AuditFinding[] = recurring.flatMap(rule => {
    if (!rule.isActive || rule.nextDate >= today || (rule.endDate !== undefined && rule.endDate < rule.nextDate)) return [];
    return [{
      id: `recurring-overdue:${rule.id}:${rule.nextDate}`,
      severity: 'WARNING' as const,
      area: 'OBLIGATIONS' as const,
      title: `${rule.name} has an unreviewed occurrence`,
      explanation: `The next expected date was ${new Date(rule.nextDate).toLocaleDateString()}, but the recurring rule is still waiting for review. This does not prove the payment was missed.`,
      recommendation: 'Match the occurrence to a transaction, move its date, skip it, or pause the rule.',
      evidenceIds: [rule.id],
      amount: rule.amount,
      route: '/recurring',
    }];
  });

  const communityRows: AuditFinding[] = communities.flatMap(group => {
    const overdue = group.schedule.filter(item => item.dueDate < today && item.status !== 'PAID' && money(item.amountDue - item.amountPaid) > 0);
    if (!overdue.length) return [];
    const outstanding = sumMoney(overdue.map(item => item.amountDue - item.amountPaid));
    return [{
      id: findingId(`community-overdue:${group.id}`, overdue.map(item => item.id)),
      severity: 'CRITICAL' as const,
      area: 'OBLIGATIONS' as const,
      title: `${group.name} has overdue contribution${overdue.length === 1 ? '' : 's'}`,
      explanation: `${overdue.length} ${group.kind} obligation${overdue.length === 1 ? '' : 's'} remain open for ${group.currency} ${outstanding.toFixed(2)}.`,
      recommendation: 'Confirm whether each contribution was paid, missed, rescheduled, or recorded elsewhere.',
      evidenceIds: overdue.map(item => item.id),
      amount: outstanding,
      route: '/community',
    }];
  });
  return [...loanRows, ...recurringRows, ...communityRows];
}

export function runDigitalAudit(input: AuditInput): AuditSnapshot {
  const now = input.now ?? Date.now();
  const findings = [
    ...duplicateFindings(input.transactions),
    ...transferFindings(input.accounts, input.transactions),
    ...balanceFindings(input.accounts, input.transactions),
    ...classificationFindings(input.transactions),
    ...obligationFindings(input.loans, input.recurring, input.communities, now),
  ].sort((left, right) => {
    const rank: Record<AuditSeverity, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };
    return rank[left.severity] - rank[right.severity] || left.title.localeCompare(right.title);
  });
  const counts = findings.reduce<Record<AuditSeverity, number>>((result, finding) => {
    result[finding.severity] += 1;
    return result;
  }, { CRITICAL: 0, WARNING: 0, INFO: 0 });
  const score = Math.max(0, 100 - counts.CRITICAL * 15 - counts.WARNING * 6 - counts.INFO * 2);
  return {
    generatedAt: now,
    score,
    findings,
    counts,
    recordsReviewed: input.accounts.length + input.transactions.length + input.loans.length + input.recurring.length + input.communities.length,
  };
}

export class DigitalAuditorService {
  static async analyze(): Promise<AuditSnapshot> {
    const database = await getDatabase();
    const [accounts, transactions, loans, recurring, communities] = await Promise.all([
      database.getAccounts(),
      database.getTransactions(),
      database.getLoans(),
      RecurringTransactionService.getAll(),
      CommunityGroupService.getAll(),
    ]);
    return runDigitalAudit({ accounts, transactions, loans, recurring, communities });
  }

  static async getDecisions(): Promise<AuditDecision[]> {
    try {
      const raw = await Storage.getItem(DECISIONS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  static async setDecision(findingId: string, status: AuditDecision['status']): Promise<void> {
    const current = (await this.getDecisions()).filter(item => item.findingId !== findingId);
    await Storage.setItem(DECISIONS_KEY, JSON.stringify([...current, { findingId, status, at: Date.now() }].slice(-500)));
  }

  static async reopen(findingId: string): Promise<void> {
    await Storage.setItem(DECISIONS_KEY, JSON.stringify((await this.getDecisions()).filter(item => item.findingId !== findingId)));
  }
}

export default DigitalAuditorService;
