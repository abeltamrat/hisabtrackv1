import type { Account, Budget, Loan, RecurringTransaction, Transaction } from '@/types/database';
import type { AssistantProposal } from './AssistantActionService';
import { money, operatingExpense, operatingIncome, sumMoney } from '@/utils/finance';

/**
 * Tool-calling financial agent. Instead of sending the model a fixed summary
 * and hoping it guesses, the model asks for exactly the records it needs
 * (search, breakdowns, budgets, loans...) and every number in its answer
 * comes from the user's own ledger. Changes are never applied here: write
 * tools only produce an AssistantProposal that the user confirms (and can
 * undo) through AssistantActionService.
 */

export interface AgentScope {
  transactions: Transaction[];
  accounts: Account[];
  budgets: Budget[];
  loans: Loan[];
  recurring: RecurringTransaction[];
  goals: Array<{ id: string; title: string; targetAmount: number; currentAmount: number; deadline?: string }>;
  categories: string[];
  currency: string;
}

export interface AgentKeys { topToolsApiKey?: string; groqApiKey?: string }
export interface AgentTurn { role: 'user' | 'assistant'; content: string }
export interface AgentResult { answer: string; proposal?: AssistantProposal; evidenceIds: string[]; provider: 'toptools' | 'groq'; toolCalls: number }

interface ToolState { evidence: Set<string>; proposal?: AssistantProposal }

const DAY = 86400000;
const MAX_STEPS = 8;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const lower = (v: unknown) => String(v ?? '').toLowerCase();

function parseDay(value: unknown, endOfDay: boolean): number | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [y, m, d] = value.split('-').map(Number);
  const date = endOfDay ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? undefined : date.getTime();
}

function matchName<T>(items: T[], name: unknown, pick: (item: T) => string): T | undefined {
  const wanted = lower(name).trim();
  if (!wanted) return undefined;
  return items.find(item => lower(pick(item)) === wanted)
    ?? (items.filter(item => lower(pick(item)).includes(wanted)).length === 1 ? items.find(item => lower(pick(item)).includes(wanted)) : undefined);
}

/** Amount of a transaction attributable to a category (split-aware). */
function categoryAmount(tx: Transaction, category: string): number {
  if (tx.splits?.length) return sumMoney(tx.splits.filter(s => lower(s.category) === lower(category)).map(s => s.amount));
  return lower(tx.category) === lower(category) ? (tx.type === 'EXPENSE' ? operatingExpense(tx) : tx.amount) : 0;
}

/** Category slices of a transaction, so splits are counted where they belong. */
function slices(tx: Transaction): Array<{ category: string; amount: number }> {
  const total = tx.type === 'EXPENSE' ? operatingExpense(tx) : tx.type === 'INCOME' ? operatingIncome(tx) : 0;
  if (!total) return [];
  if (!tx.splits?.length) return [{ category: tx.category, amount: total }];
  return tx.splits.map(s => ({ category: s.category, amount: s.amount }));
}

export const AGENT_TOOLS = [
  {
    type: 'function', function: {
      name: 'search_transactions',
      description: 'Find individual transactions. All filters optional and combined with AND. Category matches category splits too. Returns matching rows (newest first), their count and total.',
      parameters: {
        type: 'object', properties: {
          text: { type: 'string', description: 'Words to match in description, counterparty, category or tags' },
          category: { type: 'string' },
          account: { type: 'string', description: 'Account name' },
          type: { type: 'string', enum: ['INCOME', 'EXPENSE', 'TRANSFER'] },
          from: { type: 'string', description: 'YYYY-MM-DD inclusive' },
          to: { type: 'string', description: 'YYYY-MM-DD inclusive' },
          min_amount: { type: 'number' }, max_amount: { type: 'number' },
          limit: { type: 'number', description: 'Rows to return, default 25, max 100' },
        },
      },
    },
  },
  {
    type: 'function', function: {
      name: 'spending_breakdown',
      description: 'Totals grouped by category, merchant, account, month or weekday for a period. Excludes transfers between own accounts and loan principal. Use it for "where does my money go", comparisons and trends.',
      parameters: {
        type: 'object', required: ['group_by'], properties: {
          group_by: { type: 'string', enum: ['category', 'merchant', 'account', 'month', 'weekday'] },
          type: { type: 'string', enum: ['EXPENSE', 'INCOME'], description: 'Default EXPENSE' },
          from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' },
          category: { type: 'string', description: 'Restrict to one category' },
        },
      },
    },
  },
  { type: 'function', function: { name: 'get_accounts', description: 'Accounts with type and current balance.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'get_budgets', description: 'Budgets with limit, amount spent in the current period and remaining.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'get_loans', description: 'Loans borrowed and lent with remaining balance, rate, due date and status.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'get_recurring_and_goals', description: 'Recurring payment rules and savings goals with progress.', parameters: { type: 'object', properties: {} } } },
  {
    type: 'function', function: {
      name: 'propose_budget',
      description: 'Prepare a monthly budget for a category. Nothing is saved until the user confirms in the app.',
      parameters: { type: 'object', required: ['category', 'amount'], properties: { category: { type: 'string' }, amount: { type: 'number' } } },
    },
  },
  {
    type: 'function', function: {
      name: 'propose_goal',
      description: 'Prepare a savings goal. Nothing is saved until the user confirms.',
      parameters: { type: 'object', required: ['name', 'amount', 'deadline'], properties: { name: { type: 'string' }, amount: { type: 'number' }, deadline: { type: 'string', description: 'YYYY-MM-DD' } } },
    },
  },
  {
    type: 'function', function: {
      name: 'propose_recurring',
      description: 'Prepare a recurring payment or income rule. Nothing is saved until the user confirms.',
      parameters: {
        type: 'object', required: ['name', 'amount', 'category', 'account', 'frequency', 'type'], properties: {
          name: { type: 'string' }, amount: { type: 'number' }, category: { type: 'string' }, account: { type: 'string' },
          frequency: { type: 'string', enum: ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] }, type: { type: 'string', enum: ['EXPENSE', 'INCOME'] },
        },
      },
    },
  },
] as const;

/** Executes one tool against the local ledger. Exported for tests. */
export function runAgentTool(name: string, args: Record<string, any>, scope: AgentScope, state: ToolState): unknown {
  const accountName = new Map(scope.accounts.map(a => [a.id, a.name]));
  const fmt = (n: number) => `${scope.currency} ${money(n).toFixed(2)}`;

  switch (name) {
    case 'search_transactions': {
      const from = parseDay(args.from, false), to = parseDay(args.to, true);
      const account = args.account ? matchName(scope.accounts, args.account, a => a.name) : undefined;
      if (args.account && !account) return { error: `No account named "${args.account}". Accounts: ${scope.accounts.map(a => a.name).join(', ')}` };
      const words = lower(args.text).split(/\s+/).filter(w => w.length > 1);
      const rows = scope.transactions.filter(tx => {
        if (args.type && tx.type !== args.type) return false;
        if (from !== undefined && tx.date < from) return false;
        if (to !== undefined && tx.date > to) return false;
        if (account && tx.account_id !== account.id && tx.to_account_id !== account.id) return false;
        const amount = args.category ? categoryAmount(tx, args.category) : tx.amount;
        if (args.category && !amount) return false;
        if (Number.isFinite(args.min_amount) && amount < args.min_amount) return false;
        if (Number.isFinite(args.max_amount) && amount > args.max_amount) return false;
        if (words.length) {
          const hay = lower([tx.description, tx.sender_receiver, tx.category, ...(tx.tags || []), ...(tx.splits || []).flatMap(s => [s.category, s.description, ...(s.tags || [])])].join(' '));
          if (!words.every(w => hay.includes(w))) return false;
        }
        return true;
      }).sort((a, b) => b.date - a.date);
      const limit = Math.min(Math.max(Number(args.limit) || 25, 1), 100);
      rows.slice(0, 200).forEach(tx => state.evidence.add(tx.id));
      const amountOf = (tx: Transaction) => (args.category ? categoryAmount(tx, args.category) : tx.amount);
      return {
        count: rows.length,
        total: fmt(sumMoney(rows.map(amountOf))),
        rows: rows.slice(0, limit).map(tx => ({
          date: iso(tx.date), description: tx.description, amount: money(amountOf(tx)), type: tx.type, category: tx.category,
          account: accountName.get(tx.account_id), ...(tx.to_account_id ? { to_account: accountName.get(tx.to_account_id) } : {}),
          ...(tx.sender_receiver ? { counterparty: tx.sender_receiver } : {}),
          ...(tx.splits?.length ? { splits: tx.splits.map(s => ({ category: s.category, amount: s.amount, ...(s.description ? { note: s.description } : {}) })) } : {}),
          ...(tx.tags?.length ? { tags: tx.tags } : {}),
        })),
        ...(rows.length > limit ? { note: `Showing ${limit} of ${rows.length}; totals cover all.` } : {}),
      };
    }

    case 'spending_breakdown': {
      const type = args.type === 'INCOME' ? 'INCOME' : 'EXPENSE';
      const from = parseDay(args.from, false), to = parseDay(args.to, true);
      const groups = new Map<string, { total: number[]; count: number }>();
      const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      for (const tx of scope.transactions) {
        if (tx.type !== type) continue;
        if (from !== undefined && tx.date < from) continue;
        if (to !== undefined && tx.date > to) continue;
        for (const slice of slices(tx)) {
          if (args.category && lower(slice.category) !== lower(args.category)) continue;
          const key = args.group_by === 'merchant' ? (tx.sender_receiver || tx.description || 'Unknown')
            : args.group_by === 'account' ? (accountName.get(tx.account_id) || 'Unknown')
            : args.group_by === 'month' ? iso(tx.date).slice(0, 7)
            : args.group_by === 'weekday' ? weekdays[new Date(tx.date).getDay()]
            : slice.category;
          const entry = groups.get(key) ?? { total: [], count: 0 };
          entry.total.push(slice.amount); entry.count += 1; groups.set(key, entry);
          state.evidence.add(tx.id);
        }
      }
      const totals = [...groups.entries()].map(([key, g]) => ({ key, total: sumMoney(g.total), count: g.count }));
      const grand = sumMoney(totals.map(g => g.total));
      const sorted = args.group_by === 'month' ? totals.sort((a, b) => a.key.localeCompare(b.key)) : totals.sort((a, b) => b.total - a.total);
      return {
        type, period: `${args.from || 'start'} to ${args.to || 'today'}`, total: fmt(grand),
        groups: sorted.slice(0, 30).map(g => ({ [args.group_by]: g.key, total: money(g.total), count: g.count, share_pct: grand ? Math.round((g.total / grand) * 1000) / 10 : 0 })),
      };
    }

    case 'get_accounts':
      return { currency: scope.currency, accounts: scope.accounts.map(a => ({ name: a.name, type: a.type, balance: money(a.balance), ...(a.reserve_amount ? { reserve: a.reserve_amount } : {}) })), total: fmt(sumMoney(scope.accounts.map(a => a.balance))) };

    case 'get_budgets':
      return {
        budgets: scope.budgets.map(b => {
          const spent = sumMoney(scope.transactions.filter(tx => tx.type === 'EXPENSE' && tx.date >= b.start_date && tx.date <= b.end_date).map(tx => categoryAmount(tx, b.category)));
          return { category: b.category, period: b.period, limit: money(b.limit_amount), spent: money(spent), remaining: money(b.limit_amount - spent), used_pct: b.limit_amount ? Math.round((spent / b.limit_amount) * 100) : 0, from: iso(b.start_date), to: iso(b.end_date) };
        }),
      };

    case 'get_loans':
      return {
        loans: scope.loans.map(l => ({
          name: l.person_name_snapshot || l.lender_borrower_name, direction: l.type === 'BORROWED' ? 'I borrowed' : 'I lent', status: l.status,
          principal: money(l.principal_amount), remaining: money(l.remaining_balance), annual_rate_pct: l.interest_rate,
          start: iso(l.start_date), due: iso(l.due_date), days_until_due: Math.ceil((l.due_date - Date.now()) / DAY),
        })),
      };

    case 'get_recurring_and_goals':
      return {
        recurring: scope.recurring.map(r => ({ name: r.name, amount: r.amount, type: r.type, category: r.category, frequency: r.frequency, next: iso(r.nextDate), active: r.isActive, account: accountName.get(r.accountId) })),
        goals: scope.goals.map(g => ({ name: g.title, target: g.targetAmount, saved: g.currentAmount, progress_pct: g.targetAmount ? Math.round((g.currentAmount / g.targetAmount) * 100) : 0, deadline: g.deadline })),
      };

    case 'propose_budget': {
      const category = matchName(scope.categories, args.category, c => c);
      const amount = Number(args.amount);
      if (!category) return { error: `Unknown category "${args.category}". Use one of: ${scope.categories.join(', ')}` };
      if (!Number.isFinite(amount) || amount <= 0) return { error: 'Amount must be positive.' };
      state.proposal = { id: `proposal-${Date.now()}`, kind: 'BUDGET', title: 'Confirm monthly budget', summary: `Set ${category} to ${fmt(amount)} for this month.`, category, amount: money(amount), period: 'MONTHLY' };
      return { prepared: true, awaiting_user_confirmation: state.proposal.summary };
    }

    case 'propose_goal': {
      const amount = Number(args.amount);
      const name = String(args.name || '').trim();
      if (!name || !Number.isFinite(amount) || amount <= 0 || parseDay(args.deadline, false) === undefined) return { error: 'Need a name, positive amount and deadline as YYYY-MM-DD.' };
      state.proposal = { id: `proposal-${Date.now()}`, kind: 'GOAL', title: 'Confirm savings goal', summary: `Create “${name}” for ${fmt(amount)} by ${args.deadline}.`, name, amount: money(amount), deadline: args.deadline };
      return { prepared: true, awaiting_user_confirmation: state.proposal.summary };
    }

    case 'propose_recurring': {
      const category = matchName(scope.categories, args.category, c => c);
      const account = matchName(scope.accounts, args.account, a => a.name);
      const amount = Number(args.amount);
      const frequency = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(args.frequency) ? args.frequency : undefined;
      if (!category) return { error: `Unknown category "${args.category}". Use one of: ${scope.categories.join(', ')}` };
      if (!account) return { error: `Unknown account "${args.account}". Use one of: ${scope.accounts.map(a => a.name).join(', ')}` };
      if (!Number.isFinite(amount) || amount <= 0 || !frequency) return { error: 'Need a positive amount and a frequency.' };
      const type = args.type === 'INCOME' ? 'INCOME' : 'EXPENSE';
      state.proposal = { id: `proposal-${Date.now()}`, kind: 'RECURRING', title: 'Confirm recurring rule', summary: `${frequency.toLowerCase()} ${type === 'INCOME' ? 'income' : 'payment'} “${args.name || category}” of ${fmt(amount)} (${category}) from ${account.name}.`, name: String(args.name || category), amount: money(amount), category, accountId: account.id, frequency, type };
      return { prepared: true, awaiting_user_confirmation: state.proposal.summary };
    }

    default:
      return { error: `Unknown tool ${name}` };
  }
}

const PROVIDERS = {
  toptools: { url: 'https://top-tools-ai.com/api/v1/chat/completions', models: ['Top-Tools-Ai'] },
  groq: { url: 'https://api.groq.com/openai/v1/chat/completions', models: ['openai/gpt-oss-20b', 'llama-3.3-70b-versatile'] },
} as const;

async function callModel(url: string, apiKey: string, model: string, messages: any[]): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ model, messages, tools: AGENT_TOOLS, tool_choice: 'auto', temperature: 0.2, stream: false }),
    });
    if (!response.ok) {
      let detail = '';
      try { const body = await response.json(); detail = body?.error?.message || body?.message || ''; } catch { /* not JSON */ }
      throw new Error(`${model} ${response.status}${detail ? `: ${detail}` : ''}`);
    }
    const message = (await response.json())?.choices?.[0]?.message;
    if (!message) throw new Error(`${model} returned no message`);
    return message;
  } finally {
    clearTimeout(timer);
  }
}

function systemPrompt(scope: AgentScope): string {
  return [
    "You are HisabTrack's personal finance agent, with tools that read the user's own ledger on their phone.",
    `Today is ${iso(Date.now())}. All amounts are in ${scope.currency}; never use another currency symbol.`,
    `Accounts: ${scope.accounts.map(a => a.name).join(', ') || 'none'}.`,
    `Categories: ${scope.categories.join(', ') || 'none'}.`,
    'Rules:',
    '- Every number you state must come from a tool result in this conversation. Never estimate or invent amounts, dates or merchants. If the data is missing, say so.',
    '- Call as many tools as needed before answering (for comparisons, call spending_breakdown once per period).',
    '- Transfers between the user\'s own accounts are not spending.',
    '- To change anything (budget, goal, recurring rule) call a propose_* tool. It is NOT saved until the user taps Confirm in the app; say that plainly and never claim it is saved.',
    '- Be concise and specific: short paragraphs or bullets, concrete amounts, one actionable recommendation when useful.',
    "- Reply in the user's language (English, Amharic, Afaan Oromo or Tigrinya).",
  ].join('\n');
}

export class FinancialAgent {
  static isAvailable(keys: AgentKeys): boolean {
    return !!(keys.topToolsApiKey?.trim() || keys.groqApiKey?.trim());
  }

  static async run(question: string, history: AgentTurn[], scope: AgentScope, keys: AgentKeys): Promise<AgentResult> {
    const { loadStoredAppSettings } = await import('@/contexts/AppSettingsContext');
    if (!(await loadStoredAppSettings()).aiSharingEnabled) throw new Error('Enable AI data sharing in Settings first.');

    const attempts: Array<{ provider: 'toptools' | 'groq'; key: string }> = [];
    if (keys.topToolsApiKey?.trim()) attempts.push({ provider: 'toptools', key: keys.topToolsApiKey.trim() });
    if (keys.groqApiKey?.trim()) attempts.push({ provider: 'groq', key: keys.groqApiKey.trim() });

    const errors: string[] = [];
    for (const { provider, key } of attempts) {
      for (const model of PROVIDERS[provider].models) {
        const state: ToolState = { evidence: new Set() };
        const messages: any[] = [
          { role: 'system', content: systemPrompt(scope) },
          ...history.slice(-8).map(turn => ({ role: turn.role, content: turn.content })),
          { role: 'user', content: question },
        ];
        try {
          let toolCalls = 0;
          for (let step = 0; step < MAX_STEPS; step++) {
            const message = await callModel(PROVIDERS[provider].url, key, model, messages);
            const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
            if (!calls.length) {
              const answer = String(message.content ?? '').trim();
              if (!answer) throw new Error(`${model} returned an empty answer`);
              return { answer, proposal: state.proposal, evidenceIds: [...state.evidence], provider, toolCalls };
            }
            messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: calls });
            for (const call of calls) {
              toolCalls += 1;
              let args: Record<string, any> = {};
              try { args = typeof call.function?.arguments === 'string' ? JSON.parse(call.function.arguments || '{}') : (call.function?.arguments || {}); } catch { args = {}; }
              let result: unknown;
              try { result = runAgentTool(call.function?.name, args, scope, state); } catch (error) { result = { error: (error as Error).message }; }
              messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 12000) });
            }
          }
          throw new Error(`${model} did not finish within ${MAX_STEPS} steps`);
        } catch (error) {
          errors.push(`${provider}/${model}: ${(error as Error).message}`);
        }
      }
    }
    throw new Error(errors.join(' | ') || 'No tool-capable AI provider is configured.');
  }
}

export default FinancialAgent;
