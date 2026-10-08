import AsyncStorage, { sessionLocalStorage } from '@/services/SessionStorage';
import { NotificationService } from '@/services/NotificationService';
import type { RecurringFrequency, RecurringTransaction, TransactionSplit, TransactionType } from '@/types/database';
import { advanceDate, money } from '@/utils/finance';
import { generateUUID } from '@/utils/uuid';
import { createSerialQueue } from '@/utils/asyncLock';
import { Platform } from 'react-native';
import { advanceEthiopianDate } from '@/utils/ethiopianCalendar';

const STORAGE_KEY = Platform.OS === 'web' ? 'recurring_transactions' : '@hisabtrack_recurring_transactions';

const read = () => Platform.OS === 'web'
  ? Promise.resolve(sessionLocalStorage.getItem(STORAGE_KEY))
  : AsyncStorage.getItem(STORAGE_KEY);
const write = (value: string) => Platform.OS === 'web'
  ? Promise.resolve(sessionLocalStorage.setItem(STORAGE_KEY, value))
  : AsyncStorage.setItem(STORAGE_KEY, value);
const mutate = createSerialQueue();

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
  reminderDaysBeforeList?: number[];
  reminderHour: number;
  reminderMinute: number;
  nextDate?: number;
  endDate?: number;
  totalRepetitions?: number;
  splits?: TransactionSplit[];
  calendar_system?: 'GREGORIAN' | 'ETHIOPIAN';
}

const nextOccurrence = (rule: Pick<RecurringTransaction, 'frequency' | 'startDate' | 'calendar_system'>, current: number) =>
  rule.calendar_system === 'ETHIOPIAN'
    ? advanceEthiopianDate(rule.frequency, current, rule.startDate)
    : advanceDate(rule.frequency, current, rule.startDate);

export class RecurringTransactionService {
  private static async replaceReminders(rule: RecurringTransaction): Promise<RecurringTransaction> {
    await Promise.all([...new Set([...(rule.notificationIds || []), ...(rule.notificationId ? [rule.notificationId] : [])])].map(id => NotificationService.cancelNotification(id)));
    if (!rule.isActive || !rule.reminderEnabled) return this.update(rule.id, { notificationId: undefined, notificationIds: undefined });
    const reminder = rule.reminderTime ? new Date(rule.reminderTime) : new Date(rule.nextDate);
    const days = rule.reminderDaysBeforeList?.length ? rule.reminderDaysBeforeList : [rule.reminderDaysBefore];
    const ids = (await Promise.all(days.map(daysBefore => {
      const trigger = new Date(rule.nextDate);
      trigger.setDate(trigger.getDate() - daysBefore);
      trigger.setHours(reminder.getHours(), reminder.getMinutes(), 0, 0);
      return NotificationService.scheduleRecurringReminder(rule.id, rule.name, rule.amount, rule.type, trigger, rule.frequency);
    }))).filter((id): id is string => !!id);
    return this.update(rule.id, { notificationId: ids[0], notificationIds: ids });
  }
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
    const nextDate = input.nextDate ?? (input.calendar_system === 'ETHIOPIAN' ? advanceEthiopianDate(input.frequency, input.startDate, input.startDate) : advanceDate(input.frequency, input.startDate, input.startDate));
    if (!Number.isFinite(nextDate) || nextDate <= input.startDate) throw new Error('Next due date must be after the recorded transaction');
    if (input.endDate !== undefined && (!Number.isFinite(input.endDate) || input.endDate < nextDate)) throw new Error('End date must be on or after the next due date');
    if (input.totalRepetitions !== undefined && (!Number.isInteger(input.totalRepetitions) || input.totalRepetitions < 1)) throw new Error('Occurrences must be a positive whole number');
    if (input.splits && (input.type === 'TRANSFER' || input.splits.length < 2 || input.splits.some(split => !split.category.trim() || money(split.amount) <= 0) || money(input.splits.reduce((sum, split) => sum + split.amount, 0)) !== money(input.amount))) throw new Error('Recurring splits must equal the transaction amount');
    const reminderDays = [...new Set((input.reminderDaysBeforeList?.length ? input.reminderDaysBeforeList : [input.reminderDaysBefore]).map(value => Math.floor(value)))].sort((a, b) => b - a);
    if (reminderDays.some(value => !Number.isFinite(value) || value < 0 || value > 365)) throw new Error('Reminder days must be between 0 and 365');
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
      reminderDaysBefore: reminderDays[0] ?? 0,
      reminderDaysBeforeList: reminderDays,
      reminderTime: input.reminderEnabled ? reminderTime.getTime() : undefined,
      splits: input.splits,
      calendar_system: input.calendar_system,
    };
    const all = await this.getAll();
    await write(JSON.stringify([...all, item]));
    if (item.reminderEnabled) {
      item.notificationIds = (await Promise.all(reminderDays.map(daysBefore => {
        const trigger = new Date(item.nextDate);
        trigger.setDate(trigger.getDate() - daysBefore);
        trigger.setHours(input.reminderHour, input.reminderMinute, 0, 0);
        return NotificationService.scheduleRecurringReminder(item.id, item.name, item.amount, item.type, trigger, item.frequency);
      }))).filter((id): id is string => !!id);
      item.notificationId = item.notificationIds[0];
      await write(JSON.stringify([...all, item]));
    }
    return item;
  }

  static async remove(id: string): Promise<void> {
    const all = await this.getAll();
    const item = all.find(rule => rule.id === id);
    await Promise.all([...new Set([...(item?.notificationIds || []), ...(item?.notificationId ? [item.notificationId] : [])])].map(notificationId => NotificationService.cancelNotification(notificationId)));
    await write(JSON.stringify(all.filter(rule => rule.id !== id)));
  }

  /** Update one expected rule without creating a cash posting. */
  static async update(id: string, patch: Partial<RecurringTransaction>): Promise<RecurringTransaction> {
    return mutate(async () => {
      const all = await this.getAll();
      const index = all.findIndex(item => item.id === id);
      if (index < 0) throw new Error('Recurring rule not found');
      const next = { ...all[index], ...patch, id: all[index].id };
      if (money(next.amount) <= 0 || !Number.isFinite(next.nextDate)) throw new Error('Invalid recurring rule update');
      all[index] = next;
      await write(JSON.stringify(all));
      return next;
    });
  }

  static async pause(id: string): Promise<RecurringTransaction> {
    const updated = await this.update(id, { isActive: false });
    return this.replaceReminders(updated);
  }

  /** Skip advances only the expectation; it deliberately does not post money. */
  static async skipOccurrence(id: string): Promise<RecurringTransaction> {
    const rule = (await this.getAll()).find(item => item.id === id);
    if (!rule) throw new Error('Recurring rule not found');
    const nextDate = nextOccurrence(rule, rule.nextDate);
    const completedRepetitions = rule.completedRepetitions + 1;
    const updated = await this.update(id, {
      nextDate,
      completedRepetitions,
      isActive: (!rule.totalRepetitions || completedRepetitions < rule.totalRepetitions) && (!rule.endDate || nextDate <= rule.endDate),
    });
    return this.replaceReminders(updated);
  }

  static async moveExpectedDate(id: string, nextDate: number): Promise<RecurringTransaction> {
    if (!Number.isFinite(nextDate)) return Promise.reject(new Error('Enter a valid expected date'));
    const updated = await this.update(id, { nextDate });
    return this.replaceReminders(updated);
  }

  static acceptNewAmount(id: string, amount: number): Promise<RecurringTransaction> {
    if (money(amount) <= 0) return Promise.reject(new Error('Amount must be greater than zero'));
    return this.update(id, { amount: money(amount) });
  }

  /** Reconcile one observed occurrence and advance its expectation once. */
  static async settleObservedOccurrence(id: string, expectedDate: number, newAmount?: number): Promise<RecurringTransaction | undefined> {
    const updated = await mutate(async () => {
      const all = await this.getAll();
      const index = all.findIndex(item => item.id === id);
      if (index < 0 || all[index].nextDate !== expectedDate) return undefined;
      const rule = all[index];
      const nextDate = nextOccurrence(rule, rule.nextDate);
      const completedRepetitions = rule.completedRepetitions + 1;
      const updated: RecurringTransaction = {
        ...rule,
        ...(newAmount === undefined ? {} : { amount: money(newAmount) }),
        nextDate,
        completedRepetitions,
        isActive: (!rule.totalRepetitions || completedRepetitions < rule.totalRepetitions) && (!rule.endDate || nextDate <= rule.endDate),
      };
      all[index] = updated;
      await write(JSON.stringify(all));
      return updated;
    });
    return updated ? this.replaceReminders(updated) : undefined;
  }
}
