import type { Account, Transaction, TransactionSplit, TransactionType } from '@/types/database';

export interface QuickAddCategory { id?: string; name: string; type: string; parentId?: string }
export interface QuickAddDraft {
  amount: number;
  accountId?: string;
  type: TransactionType;
  category?: string;
  recipient?: string;
  description: string;
  date: number;
  tags: string[];
  splits: TransactionSplit[];
  issues: string[];
  confidence: number;
  fingerprint: string;
}

export const parseLocaleAmount = (raw: string): number | null => {
  let value = raw.trim().replace(/(?:etb|birr|br)/gi, '').replace(/\s/g, '');
  if (!value || !/^[\d.,]+$/.test(value)) return null;
  const comma = value.lastIndexOf(',');
  const dot = value.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? ',' : '.';
    value = value.replace(decimal === ',' ? /\./g : /,/g, '').replace(decimal, '.');
  } else if (comma >= 0) {
    const tail = value.length - comma - 1;
    value = tail === 3 && value.indexOf(',') === comma ? value.replace(',', '') : value.replace(',', '.');
  } else if (dot >= 0) {
    const tail = value.length - dot - 1;
    if (tail === 3 && value.indexOf('.') === dot) value = value.replace('.', '');
  }
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : null;
};

const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9\u1200-\u137f]+/g, ' ').trim();
const hash = (value: string) => {
  let result = 2166136261;
  for (let i = 0; i < value.length; i += 1) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  return (result >>> 0).toString(36);
};
const dateOnly = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12).getTime();

function extractDate(text: string, now: Date): { date: number; clean: string } {
  let clean = text;
  let date = now.getTime();
  if (/\byesterday\b/i.test(clean)) { const d = new Date(now); d.setDate(d.getDate() - 1); date = dateOnly(d); clean = clean.replace(/\byesterday\b/ig, ''); }
  else if (/\btoday\b/i.test(clean)) { date = now.getTime(); clean = clean.replace(/\btoday\b/ig, ''); }
  else {
    const match = clean.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
    if (match) {
      const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
      if (!Number.isNaN(parsed.getTime())) date = parsed.getTime();
      clean = clean.replace(match[0], '');
    }
  }
  return { date, clean };
}

function bestCategory(label: string, categories: QuickAddCategory[], history: Transaction[]): string | undefined {
  const normalized = norm(label);
  const direct = categories.find(category => normalized.includes(norm(category.name)) || norm(category.name).includes(normalized));
  if (direct) return direct.name;
  const aliases: Array<[RegExp, RegExp]> = [
    [/\b(lunch|dinner|breakfast|coffee|food|restaurant|grocery)\b/, /food|dining|grocer/],
    [/\b(taxi|ride|fuel|bus|transport|uber|bolt)\b/, /transport|travel|fuel/],
    [/\b(electric|water|internet|phone|bill|utility)\b/, /bill|utilit/],
    [/\b(movie|cinema|game|entertainment)\b/, /entertain/],
    [/\b(medicine|doctor|clinic|health)\b/, /health|medical/],
    [/\b(salary|wage|payroll)\b/, /salary|income/],
  ];
  const alias = aliases.find(([words]) => words.test(normalized));
  if (alias) {
    const matched = categories.find(category => alias[1].test(norm(category.name)));
    if (matched) return matched.name;
  }
  const scores = new Map<string, number>();
  history.forEach(item => {
    const identity = norm(`${item.description} ${item.sender_receiver || ''}`);
    if (identity && normalized && (identity.includes(normalized) || normalized.includes(identity))) scores.set(item.category, (scores.get(item.category) || 0) + 1);
  });
  return [...scores.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
}

export function parseQuickAdd(input: string, accounts: Account[], categories: QuickAddCategory[], history: Transaction[] = [], now = new Date()): QuickAddDraft {
  const source = input.trim();
  const tags = [...source.matchAll(/#([\p{L}\p{N}_-]+)/gu)].map(match => match[1]);
  let working = source.replace(/#[\p{L}\p{N}_-]+/gu, ' ');
  const dated = extractDate(working, now); working = dated.clean;
  const type: TransactionType = /\b(income|received|salary|earned)\b/i.test(working) ? 'INCOME' : 'EXPENSE';
  const accountMatches = accounts.filter(account => {
    const names = [account.name, account.type.replace('_', ' '), ...(account.aliases || [])].map(norm).filter(Boolean);
    return names.some(name => norm(working).includes(name));
  });
  const account = accountMatches.length === 1 ? accountMatches[0] : undefined;
  const recipientMatch = working.match(/\bto\s+(.+?)(?=\s+(?:from|on|for)\b|$)/i);
  const recipient = recipientMatch?.[1]?.replace(/\b(?:etb|birr|br)?\s*[\d.,]+\b/ig, '').trim() || undefined;
  const parts = working.split(/\s+(?:and|&)\s+/i).map(part => part.trim()).filter(Boolean);
  const parsedParts = parts.map((part, index) => {
    const amountMatch = part.match(/(?:etb|birr|br)?\s*([\d][\d.,]*(?:\s*[\d]{3})?)/i);
    const amount = amountMatch ? parseLocaleAmount(amountMatch[1]) : null;
    const label = part.replace(amountMatch?.[0] || '', '').replace(/\b(?:from|using|via|on|today|yesterday|income|received|salary|earned)\b.*$/i, '').replace(/\bto\s+.*$/i, '').replace(new RegExp(`\\b(?:${accounts.flatMap(item => [item.name, item.type.replace('_', ' '), ...(item.aliases || [])]).filter(Boolean).map(item => norm(item).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') || 'a^'})\\b`, 'ig'), '').trim();
    return { amount, label: label || `Part ${index + 1}`, category: bestCategory(label, categories.filter(c => c.type.toLowerCase() === type.toLowerCase()), history) };
  });
  const validParts = parsedParts.filter(part => part.amount !== null) as Array<{ amount: number; label: string; category?: string }>;
  const amount = Math.round(validParts.reduce((sum, part) => sum + part.amount, 0) * 100) / 100;
  const issues: string[] = [];
  if (!amount) issues.push('Enter one clear positive amount.');
  if (!account) issues.push(accountMatches.length > 1 ? 'More than one account matches. Choose one.' : 'Choose an account.');
  if (validParts.some(part => !part.category)) issues.push('Choose a category for each unmatched part.');
  if (parsedParts.some(part => part.amount === null)) issues.push('A phrase part has no clear amount.');
  const splits = validParts.length > 1 ? validParts.map((part, index) => ({ id: `quick-${index}-${hash(part.label)}`, amount: part.amount, category: part.category || '', description: part.label, tags: [...tags] })) : [];
  const category = validParts.length === 1 ? validParts[0].category : (validParts.every(part => part.category === validParts[0]?.category) ? validParts[0]?.category : undefined);
  const description = validParts.map(part => part.label).join(' + ') || source;
  const fingerprint = hash(`${norm(source)}|${amount}|${account?.id || ''}|${dateOnly(new Date(dated.date))}`);
  return { amount, accountId: account?.id, type, category, recipient, description, date: dated.date, tags, splits, issues, confidence: Math.max(0, Math.min(1, 1 - issues.length * 0.2)), fingerprint };
}
