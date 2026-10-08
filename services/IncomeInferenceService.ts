import type { Account, Transaction } from '@/types/database';
import { money } from '@/utils/finance';

export interface InferredIncome {
  id: string;
  accountId: string;
  accountName: string;
  label: string;
  amount: number;
  expectedDate: number;
  toleranceDays: number;
  confidence: 'MEDIUM' | 'HIGH';
  sampleCount: number;
}

const normalize = (value?: string) => (value || '').trim().toLowerCase().replace(/\s+/g, ' ');
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

export class IncomeInferenceService {
  static infer(transactions: Transaction[], accounts: Account[], startDate: number, endDate: number): InferredIncome[] {
    const names = new Map(accounts.map(account => [account.id, account.name]));
    const groups = new Map<string, Transaction[]>();
    for (const transaction of transactions) {
      if (transaction.type !== 'INCOME' || transaction.purpose && transaction.purpose !== 'OPERATING') continue;
      const identity = normalize(transaction.sender_receiver) || normalize(transaction.description) || normalize(transaction.category);
      const key = `${transaction.account_id}|${identity}`;
      groups.set(key, [...(groups.get(key) || []), transaction]);
    }

    const results: InferredIncome[] = [];
    for (const [key, raw] of groups) {
      const rows = raw.sort((a, b) => a.date - b.date).slice(-6);
      if (rows.length < 3) continue;
      const intervals = rows.slice(1).map((row, index) => (row.date - rows[index].date) / 86400000);
      const typicalInterval = median(intervals);
      if (typicalInterval < 25 || typicalInterval > 35) continue;
      const typicalAmount = median(rows.map(row => row.amount));
      if (typicalAmount <= 0 || rows.some(row => Math.abs(row.amount - typicalAmount) / typicalAmount > 0.15)) continue;

      const days = rows.map(row => new Date(row.date).getDate());
      const typicalDay = median(days);
      const maxDayDeviation = Math.max(...days.map(day => Math.abs(day - typicalDay)));
      if (maxDayDeviation > 4) continue;
      const last = new Date(rows.at(-1)!.date);
      const expected = new Date(last);
      expected.setDate(1);
      expected.setMonth(expected.getMonth() + 1);
      const monthEnd = new Date(expected.getFullYear(), expected.getMonth() + 1, 0).getDate();
      expected.setDate(Math.min(typicalDay, monthEnd));
      expected.setHours(last.getHours(), last.getMinutes(), 0, 0);
      if (expected.getTime() < startDate) {
        expected.setDate(1);
        expected.setMonth(expected.getMonth() + 1);
        expected.setDate(Math.min(typicalDay, new Date(expected.getFullYear(), expected.getMonth() + 1, 0).getDate()));
      }
      if (expected.getTime() > endDate) continue;
      const accountId = rows[0].account_id;
      const toleranceDays = Math.max(1, Math.min(4, Math.ceil(maxDayDeviation || 1)));
      results.push({
        id: `inferred-income:${key}:${expected.getFullYear()}-${expected.getMonth()}`,
        accountId,
        accountName: names.get(accountId) || 'Missing account',
        label: rows.at(-1)!.sender_receiver || rows.at(-1)!.description || rows.at(-1)!.category,
        amount: money(typicalAmount),
        expectedDate: expected.getTime(),
        toleranceDays,
        confidence: rows.length >= 5 && maxDayDeviation <= 2 ? 'HIGH' : 'MEDIUM',
        sampleCount: rows.length,
      });
    }
    return results.sort((a, b) => a.expectedDate - b.expectedDate || b.amount - a.amount);
  }
}

export default IncomeInferenceService;
