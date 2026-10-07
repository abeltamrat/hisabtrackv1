import AsyncStorage, { sessionLocalStorage } from '@/services/SessionStorage';
import { NotificationService } from '@/services/NotificationService';
import type { RecurringFrequency, RecurringTransaction, TransactionType } from '@/types/database';
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
  description?: string;
  tags?: string[];
  frequency: RecurringFrequency;
  startDate: number;
  reminderEnabled: boolean;
  reminderDaysBefore: number;
  reminderHour: number;
  reminderMinute: number;
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
    const nextDate = advanceDate(input.frequency, input.startDate, input.startDate);
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
      isActive: true,
      accountId: input.accountId,
      toAccountId: input.type === 'TRANSFER' ? input.toAccountId : undefined,
      description: input.description?.trim() || undefined,
      completedRepetitions: 0,
      reminderEnabled: input.reminderEnabled,
      reminderDaysBefore: Math.max(0, Math.floor(input.reminderDaysBefore)),
      reminderTime: input.reminderEnabled ? reminderTime.getTime() : undefined,
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
}
