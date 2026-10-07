import type { RecurringFrequency, Transaction } from '@/types/database';

export interface RecurringSuggestion {
  frequency: RecurringFrequency;
  confidence: number;
  occurrences: number;
  reason: string;
}

const DAY = 24 * 60 * 60 * 1000;
const normalize = (value?: string) => (value || '').trim().toLocaleLowerCase().replace(/\s+/g, ' ');

export function detectRecurringPattern(candidate: Pick<Transaction, 'type' | 'amount' | 'category' | 'sender_receiver' | 'description' | 'date'>, history: Transaction[]): RecurringSuggestion | null {
  const identity = normalize(candidate.sender_receiver) || normalize(candidate.description);
  const matches = history.filter(item => item.type === candidate.type
    && (normalize(item.sender_receiver) || normalize(item.description)) === identity
    && (item.category === candidate.category || identity.length > 0)
    && Math.abs(item.amount - candidate.amount) <= Math.max(0.01, candidate.amount * 0.05))
    .map(item => item.date)
    .concat(candidate.date)
    .sort((a, b) => a - b);
  if (matches.length < 3) return null;
  const intervals = matches.slice(1).map((date, index) => (date - matches[index]) / DAY);
  const median = [...intervals].sort((a, b) => a - b)[Math.floor(intervals.length / 2)];
  const choices: Array<{ frequency: RecurringFrequency; days: number; tolerance: number }> = [
    { frequency: 'DAILY', days: 1, tolerance: 0.35 },
    { frequency: 'WEEKLY', days: 7, tolerance: 2 },
    { frequency: 'MONTHLY', days: 30.44, tolerance: 6 },
    { frequency: 'YEARLY', days: 365.25, tolerance: 20 },
  ];
  const choice = choices.find(item => Math.abs(median - item.days) <= item.tolerance);
  if (!choice) return null;
  const consistent = intervals.filter(value => Math.abs(value - choice.days) <= choice.tolerance).length;
  const confidence = Math.round((consistent / intervals.length) * 100);
  if (confidence < 60) return null;
  return { frequency: choice.frequency, confidence, occurrences: matches.length, reason: `${matches.length} similar transactions follow an approximately ${choice.frequency.toLowerCase()} schedule.` };
}
