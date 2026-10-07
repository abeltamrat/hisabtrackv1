import AsyncStorage, { sessionLocalStorage } from '@/services/SessionStorage';
import { NotificationService } from '@/services/NotificationService';
import type { RecurringFrequency, RecurringTransaction, TransactionSplit, TransactionType } from '@/types/database';
import { advanceDate, money } from '@/utils/finance';
import { generateUUID } from '@/utils/uuid';
import { Platform } from 'react-native';

const STORAGE_KEY = Platform.OS === 'web' ? 'recurring_transactions' : '@hisabtrack_recurring_transactions';

const read = () => Platform.OS === 'web'
  ? Promise.resolve(sessionLocalStorage.getItem(STORAGE_KEY))
  : AsyncStorage.getItem(STORAGE_KEY);
const write = (value: string) => Platform.OS === 'web'
  ? Promise.resolve(sessionLocalStorage.setItem(STORAGE_KEY, value))
  : AsyncStorage.setItem(STORAGE_KEY, value);

export interface CreateRecurringInput {
  name: string;
  amount: number;
  type: TransactionType;
  category: string;
  accountId: string;
  toAccountId?: string;
  fees?: number;
  tax?: number;
  description?: string;
  tags?: string[];
  frequency: RecurringFrequency;
  startDate: number;
  reminderEnabled: boolean;
  reminderDaysBefore: number;
  reminderHour: number;
  reminderMinute: number;
  nextDate?: number;
  endDate?: number;
  totalRepetitions?: number;
  splits?: TransactionSplit[];
}

export class RecurringTransactionService {
  static async getAll(): Promise<RecurringTransaction[]> {
    const stored = await read();
    return stored ? JSON.parse(stored) : [];
  }

  static async create(input: CreateRecurringInput): Promise<RecurringTransaction> {
    if (!input.name.trim() || !Number.isFinite(input.startDate) || money(input.amount) <= 0) {
      throw new Error('Invalid recurring transaction');
    }
    if (input.type === 'TRANSFER' && (!input.toAccountId || input.toAccountId === input.accountId)) {
      throw new Error('Choose a different destination account');
    }
    const fees = money(input.fees ?? 0);
    const tax = money(input.tax ?? 0);
    if (fees < 0 || tax < 0 || money(fees + tax) > money(input.amount)) {
      throw new Error('Transfer fees and tax must be valid and cannot exceed the debit');
    }
    if (input.type !== 'TRANSFER' && (fees || tax)) throw new Error('Fees and tax estimates only apply to transfers');
    const nextDate = input.nextDate ?? advanceDate(input.frequency, input.startDate, input.startDate);
    if (!Number.isFinite(nextDate) || nextDate <= input.startDate) throw new Error('Next due date must be after the recorded transaction');
    if (input.endDate !== undefined && (!Number.isFinite(input.endDate) || input.endDate < nextDate)) throw new Error('End date must be on or after the next due date');
    if (input.totalRepetitions !== undefined && (!Number.isInteger(input.totalRepetitions) || input.totalRepetitions < 1)) throw new Error('Occurrences must be a positive whole number');
    if (input.splits && (input.type === 'TRANSFER' || input.splits.length < 2 || input.splits.some(split => !split.category.trim() || money(split.amount) <= 0) || money(input.splits.reduce((sum, split) => sum + split.amount, 0)) !== money(input.amount))) throw new Error('Recurring splits must equal the transaction amount');
    const reminderTime = new Date(nextDate);
    reminderTime.setHours(input.reminderHour, input.reminderMinute, 0, 0);
    const item: RecurringTransaction = {
      id: generateUUID(),
      name: input.name.trim(),
      amount: money(input.amount),
      type: input.type,
      category: input.category,
      tags: input.tags,
      frequency: input.frequency,
      startDate: input.startDate,
      nextDate,
      endDate: input.endDate,
      isActive: true,
      accountId: input.accountId,
      toAccountId: input.type === 'TRANSFER' ? input.toAccountId : undefined,
      fees: input.type === 'TRANSFER' && fees ? fees : undefined,
      tax: input.type === 'TRANSFER' && tax ? tax : undefined,
      description: input.description?.trim() || undefined,
      completedRepetitions: 0,
      totalRepetitions: input.totalRepetitions,
      reminderEnabled: input.reminderEnabled,
      reminderDaysBefore: Math.max(0, Math.floor(input.reminderDaysBefore)),
      reminderTime: input.reminderEnabled ? reminderTime.getTime() : undefined,
      splits: input.splits,
    };
    const all = await this.getAll();
    await write(JSON.stringify([...all, item]));
    if (item.reminderEnabled) {
      const trigger = new Date(item.nextDate);
      trigger.setDate(trigger.getDate() - item.reminderDaysBefore);
      trigger.setHours(input.reminderHour, input.reminderMinute, 0, 0);
      item.notificationId = await NotificationService.scheduleRecurringReminder(
        item.id, item.name, item.amount, item.type, trigger, item.frequency
      ) || undefined;
      await write(JSON.stringify([...all, item]));
    }
    return item;
  }

  static async remove(id: string): Promise<void> {
    const all = await this.getAll();
    const item = all.find(rule => rule.id === id);
    if (item?.notificationId) await NotificationService.cancelNotification(item.notificationId);
    await write(JSON.stringify(all.filter(rule => rule.id !== id)));
  }
}
