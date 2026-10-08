import type { Account, Budget, RecurringFrequency, RecurringTransaction, Transaction } from '@/types/database';
import { operatingExpense, money, sumMoney } from '@/utils/finance';
import { getDatabase } from './database';
import Storage from './SessionStorage';
import { RecurringTransactionService } from './RecurringTransactionService';

export type AssistantProposal =
  | { id: string; kind: 'BUDGET'; title: string; summary: string; category: string; amount: number; period: 'MONTHLY' }
  | { id: string; kind: 'GOAL'; title: string; summary: string; name: string; amount: number; deadline: string }
  | { id: string; kind: 'RECURRING'; title: string; summary: string; name: string; amount: number; category: string; accountId: string; frequency: RecurringFrequency; type: 'EXPENSE' | 'INCOME' };
export interface AssistantLocalResult { handled: boolean; answer?: string; evidenceIds?: string[]; proposal?: AssistantProposal; error?: string }
export interface AssistantScope { transactions: Transaction[]; accounts: Account[]; budgets: Budget[]; categories: string[]; recurring: RecurringTransaction[]; goals?: Array<{ id: string; title: string; targetAmount: number; currentAmount: number; deadline?: string }>; currency: string }
export interface AssistantUndo { kind: AssistantProposal['kind']; createdId: string; previous?: unknown }

const norm = (text: string) => text.toLowerCase().replace(/[-_]/g, ' ').replace(/[^a-z0-9\u1200-\u137f ]+/g, ' ').replace(/\s+/g, ' ').trim();
const amountFrom = (text: string) => { const m = text.match(/(?:etb|birr|br)?\s*(\d[\d,]*(?:\.\d{1,2})?)/i); return m ? Number(m[1].replace(/,/g, '')) : NaN; };
const categoryFrom = (text: string, categories: string[]) => {
  const normalized = norm(text);
  const matches = categories.filter(category => normalized.includes(norm(category)) || norm(category).includes(normalized.replace(/\b(?:cap|budget|at|etb|birr|br|this|month|spending|create|set)\b/g, '').trim()));
  return [...new Set(matches)].sort((a, b) => b.length - a.length);
};
const fmt = (currency: string, amount: number) => `${currency} ${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export class AssistantActionService {
  static analyze(text: string, scope: AssistantScope, source: 'USER' | 'SMS' | 'RECEIPT' = 'USER'): AssistantLocalResult {
    const query = norm(text);
    const isWrite = /\b(create|set|cap|make|add|schedule)\b/.test(query);
    if (isWrite && source !== 'USER') return { handled: true, error: 'Imported SMS and receipt text cannot authorize an action.' };
    if (/why.*(?:spending|expense).*(?:increase|higher)|why.*(?:increase|higher).*(?:spending|expense)/.test(query)) {
      const matches = categoryFrom(text, scope.categories);
      if (matches.length !== 1) return { handled: true, error: matches.length ? `Category is ambiguous: ${matches.join(', ')}.` : 'Name one category to compare.' };
      const category = matches[0]; const now = new Date(); const elapsed = now.getDate();
      const currentStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      const previousStartDate = new Date(now.getFullYear(), now.getMonth() - 1, 1); const previousStart = previousStartDate.getTime();
      const previousEnd = new Date(previousStartDate.getFullYear(), previousStartDate.getMonth(), Math.min(elapsed, new Date(previousStartDate.getFullYear(), previousStartDate.getMonth() + 1, 0).getDate()), 23, 59, 59, 999).getTime();
      const relevant = scope.transactions.filter(tx => tx.category === category || tx.splits?.some(split => split.category === category));
      const amountFor = (tx: Transaction) => tx.splits?.length ? sumMoney(tx.splits.filter(split => split.category === category).map(split => split.amount)) : (tx.category === category ? operatingExpense(tx) : 0);
      const current = relevant.filter(tx => tx.date >= currentStart && tx.date <= now.getTime()); const previous = relevant.filter(tx => tx.date >= previousStart && tx.date <= previousEnd);
      const currentTotal = sumMoney(current.map(amountFor)); const previousTotal = sumMoney(previous.map(amountFor)); const change = money(currentTotal - previousTotal);
      const top = [...current].sort((a, b) => amountFor(b) - amountFor(a)).slice(0, 3);
      return { handled: true, answer: `${category} spending is ${fmt(scope.currency, Math.abs(change))} ${change >= 0 ? 'higher' : 'lower'} than the same ${elapsed}-day part of last month (${fmt(scope.currency, currentTotal)} vs ${fmt(scope.currency, previousTotal)}). ${top.length ? `Largest current records: ${top.map(tx => `${tx.description} ${fmt(scope.currency, amountFor(tx))}`).join('; ')}.` : 'There are no current records in this category.'}`, evidenceIds: [...current, ...previous].map(tx => tx.id) };
    }
    if (/\b(cap|set|create)\b.*\b(budget|spending)\b|\bcap\b.*\b(?:at|to)\b/.test(query)) {
      const amount = amountFrom(text); const matches = categoryFrom(text, scope.categories);
      if (!Number.isFinite(amount) || amount <= 0) return { handled: true, error: 'Specify a positive budget amount.' };
      if (matches.length !== 1) return { handled: true, error: matches.length ? `Choose one category: ${matches.join(', ')}.` : 'Use an existing category name.' };
      const proposal: AssistantProposal = { id: `proposal-${Date.now()}`, kind: 'BUDGET', title: 'Confirm monthly budget', summary: `Set ${matches[0]} to ${fmt(scope.currency, amount)} for this month.`, category: matches[0], amount, period: 'MONTHLY' };
      return { handled: true, answer: 'I prepared a budget change. Review it before anything is saved.', proposal };
    }
    if (/\b(create|add|set)\b.*\bgoal\b/.test(query)) {
      const amount = amountFrom(text); const deadline = text.match(/20\d{2}-\d{2}-\d{2}/)?.[0];
      const name = text.replace(/\b(create|add|set|goal|for|by|etb|birr|br)\b/gi, ' ').replace(/\d[\d,.]*/g, ' ').replace(/\s+/g, ' ').trim();
      if (!Number.isFinite(amount) || amount <= 0 || !deadline || Number.isNaN(Date.parse(deadline))) return { handled: true, error: 'Use a positive amount and deadline, for example: create goal Emergency fund ETB 50,000 by 2027-12-31.' };
      const proposal: AssistantProposal = { id: `proposal-${Date.now()}`, kind: 'GOAL', title: 'Confirm savings goal', summary: `Create “${name || 'Savings goal'}” for ${fmt(scope.currency, amount)} by ${deadline}.`, name: name || 'Savings goal', amount, deadline };
      return { handled: true, answer: 'I prepared a savings goal. Review it before saving.', proposal };
    }
    if (/\b(create|add|set|make)\b.*\b(recurring|weekly|monthly|yearly|daily)\b/.test(query)) {
      const amount = amountFrom(text); const matches = categoryFrom(text, scope.categories); const accountMatches = scope.accounts.filter(account => query.includes(norm(account.name)));
      if (!Number.isFinite(amount) || amount <= 0) return { handled: true, error: 'Specify a positive recurring amount.' };
      if (matches.length !== 1 || accountMatches.length !== 1) return { handled: true, error: 'Use one exact category and one exact account name.' };
      const frequency: RecurringFrequency = /daily/.test(query) ? 'DAILY' : /weekly/.test(query) ? 'WEEKLY' : /yearly/.test(query) ? 'YEARLY' : 'MONTHLY';
      const proposal: AssistantProposal = { id: `proposal-${Date.now()}`, kind: 'RECURRING', title: 'Confirm recurring rule', summary: `${frequency.toLowerCase()} ${matches[0]} payment of ${fmt(scope.currency, amount)} from ${accountMatches[0].name}.`, name: matches[0], amount, category: matches[0], accountId: accountMatches[0].id, frequency, type: /income|salary|received/.test(query) ? 'INCOME' : 'EXPENSE' };
      return { handled: true, answer: 'I prepared a recurring rule. Review it before saving.', proposal };
    }
    if (/\b(find|search|show)\b.*\b(transaction|payment|expense|income)/.test(query)) {
      const terms = query.split(' ').filter(term => term.length > 2 && !['find', 'search', 'show', 'transaction', 'transactions', 'payment', 'payments'].includes(term));
      const found = scope.transactions.filter(tx => terms.every(term => norm(`${tx.category} ${tx.description} ${tx.sender_receiver || ''}`).includes(term))).slice(0, 10);
      return { handled: true, answer: found.length ? found.map(tx => `${new Date(tx.date).toLocaleDateString()} · ${tx.description} · ${fmt(scope.currency, tx.amount)}`).join('\n') : 'No matching transactions were found in your ledger.', evidenceIds: found.map(tx => tx.id) };
    }
    if (/\b(show|list|find)\b.*\bbudget/.test(query)) return { handled: true, answer: scope.budgets.length ? scope.budgets.map(item => `${item.category}: ${fmt(scope.currency, item.limit_amount)} ${item.period.toLowerCase()}`).join('\n') : 'No budgets are saved.' };
    if (/\b(show|list|find)\b.*\bgoal/.test(query)) return { handled: true, answer: scope.goals?.length ? scope.goals.map(item => `${item.title}: ${fmt(scope.currency, item.currentAmount)} of ${fmt(scope.currency, item.targetAmount)}${item.deadline ? ` by ${item.deadline}` : ''}`).join('\n') : 'No savings goals are saved.' };
    if (/\b(show|list|find)\b.*\brecurring/.test(query)) return { handled: true, answer: scope.recurring.length ? scope.recurring.map(item => `${item.name}: ${fmt(scope.currency, item.amount)} ${item.frequency.toLowerCase()} (${item.isActive ? 'active' : 'paused'})`).join('\n') : 'No recurring rules are saved.' };
    if (/\b(show|list|find)\b.*\b(recipient|merchant|payee)/.test(query)) {
      const recipients = [...new Set(scope.transactions.map(item => item.sender_receiver?.trim()).filter((item): item is string => !!item))].sort();
      return { handled: true, answer: recipients.length ? recipients.join('\n') : 'No recipients are saved in your ledger.' };
    }
    if (/\b(show|list|find)\b.*\bcategor/.test(query)) return { handled: true, answer: scope.categories.length ? scope.categories.join('\n') : 'No categories are available.' };
    return { handled: false };
  }

  static async execute(proposal: AssistantProposal): Promise<AssistantUndo> {
    if (proposal.kind === 'BUDGET') {
      const db = await getDatabase(); const existing = (await db.getBudgets()).find(item => item.category === proposal.category && item.period === 'MONTHLY');
      const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0); const end = new Date(start); end.setMonth(end.getMonth() + 1); end.setMilliseconds(-1);
      if (existing) { await db.updateBudget({ ...existing, limit_amount: proposal.amount, base_limit_amount: proposal.amount, start_date: start.getTime(), end_date: end.getTime() }); return { kind: 'BUDGET', createdId: existing.id, previous: existing }; }
      const created = await db.createBudget({ category: proposal.category, limit_amount: proposal.amount, base_limit_amount: proposal.amount, period: 'MONTHLY', start_date: start.getTime(), end_date: end.getTime() }); return { kind: 'BUDGET', createdId: created.id };
    }
    if (proposal.kind === 'GOAL') {
      const raw = await Storage.getItem('financial_goals'); const goals = raw ? JSON.parse(raw) : []; const id = `goal-${Date.now()}`;
      await Storage.setItem('financial_goals', JSON.stringify([...goals, { id, title: proposal.name, targetAmount: proposal.amount, currentAmount: 0, deadline: proposal.deadline, icon: 'star', color: '#6366f1', category: 'Savings' }])); return { kind: 'GOAL', createdId: id };
    }
    const created = await RecurringTransactionService.create({ name: proposal.name, amount: proposal.amount, type: proposal.type, category: proposal.category, accountId: proposal.accountId, frequency: proposal.frequency, startDate: Date.now(), reminderEnabled: true, reminderDaysBefore: 1, reminderHour: 9, reminderMinute: 0 });
    return { kind: 'RECURRING', createdId: created.id };
  }

  static async undo(token: AssistantUndo) {
    if (token.kind === 'BUDGET') { const db = await getDatabase(); if (token.previous) await db.updateBudget(token.previous as Budget); else await db.deleteBudget(token.createdId); }
    else if (token.kind === 'GOAL') { const raw = await Storage.getItem('financial_goals'); const goals = raw ? JSON.parse(raw) : []; await Storage.setItem('financial_goals', JSON.stringify(goals.filter((goal: any) => goal.id !== token.createdId))); }
    else await RecurringTransactionService.remove(token.createdId);
  }
}
