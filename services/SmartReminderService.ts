import AsyncStorage from '@/services/SessionStorage';
import { Platform } from 'react-native';

import { loadStoredAppSettings } from '@/contexts/AppSettingsContext';
import { createSerialQueue } from '@/utils/asyncLock';
import { getDatabase } from './database';
import { NotificationService } from './NotificationService';

const STORAGE_KEY = '@hisabtrack_smart_reminders';
const DAY_MS = 24 * 60 * 60 * 1000;
const enqueueStateOperation = createSerialQueue();

interface SmartReminderState {
  recordingTimes: number[];
  scheduledHabitNotificationId?: string;
  lastRecordedTransactionAt?: number;
  scheduledHabitMinute?: number;
  lastSmartInsightDay?: string;
  lastTransactionGapReminderAt?: number;
}

async function loadState(): Promise<SmartReminderState> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) return { recordingTimes: [], ...JSON.parse(raw) };
  } catch { }
  return { recordingTimes: [] };
}

async function saveState(state: SmartReminderState) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function preferredTime(samples: number[]): { hour: number; minute: number } {
  if (samples.length < 3) return { hour: 20, minute: 0 };
  const minutes = samples.map(timestamp => {
    const date = new Date(timestamp);
    return date.getHours() * 60 + date.getMinutes();
  }).sort((a, b) => a - b);
  const median = minutes[Math.floor(minutes.length / 2)];
  const rounded = Math.round(median / 5) * 5 % (24 * 60);
  return { hour: Math.floor(rounded / 60), minute: rounded % 60 };
}

export class SmartReminderService {
  static async recordTransactionHabit(recordedAt = Date.now()): Promise<void> {
    if (Platform.OS === 'web') return;
    await enqueueStateOperation(async () => {
      const settings = await loadStoredAppSettings();
      const state = await loadState();
      state.recordingTimes = [...state.recordingTimes, recordedAt].slice(-30);
      state.lastRecordedTransactionAt = recordedAt;

      if (settings.backgroundReminders.habitRemindersEnabled) {
        const time = preferredTime(state.recordingTimes);
        const learnedMinute = time.hour * 60 + time.minute;
        if (!state.scheduledHabitNotificationId || state.scheduledHabitMinute !== learnedMinute) {
          await NotificationService.cancelScheduledNotification(state.scheduledHabitNotificationId);
          state.scheduledHabitNotificationId = await NotificationService.scheduleDailyHabitReminder(time.hour, time.minute) ?? undefined;
          state.scheduledHabitMinute = state.scheduledHabitNotificationId ? learnedMinute : undefined;
        }
      }
      await saveState(state);
    });
  }

  static async refreshHabitSchedule(enabledOverride?: boolean): Promise<void> {
    if (Platform.OS === 'web') return;
    await enqueueStateOperation(async () => {
      const settings = await loadStoredAppSettings();
      const state = await loadState();
      await NotificationService.cancelScheduledNotification(state.scheduledHabitNotificationId);
      state.scheduledHabitNotificationId = undefined;
      state.scheduledHabitMinute = undefined;
      if (enabledOverride ?? settings.backgroundReminders.habitRemindersEnabled) {
        const time = preferredTime(state.recordingTimes);
        state.scheduledHabitNotificationId = await NotificationService.scheduleDailyHabitReminder(time.hour, time.minute) ?? undefined;
        state.scheduledHabitMinute = state.scheduledHabitNotificationId ? time.hour * 60 + time.minute : undefined;
      }
      await saveState(state);
    });
  }

  static async maybeSendSmartNotification(now = Date.now()): Promise<boolean> {
    if (Platform.OS === 'web' || !(await NotificationService.hasPermission())) return false;
    return enqueueStateOperation(async () => {
    const settings = await loadStoredAppSettings();
    const flags = settings.backgroundReminders;
    if (!flags.dailySummaryAlertsEnabled && !flags.personalizedTipsEnabled && !flags.inactivityAlertsEnabled) return false;

    const state = await loadState();
    const todayKey = new Date(now).toISOString().slice(0, 10);
    const db = await getDatabase();
    const transactions = await db.getTransactions();
    const latestTransactionDate = transactions.reduce((max, transaction) => Math.max(max, transaction.date), 0);
    const lastRecordedAt = state.lastRecordedTransactionAt ?? latestTransactionDate;

    if (
      flags.inactivityAlertsEnabled && lastRecordedAt > 0 && now - lastRecordedAt >= 4 * DAY_MS &&
      now - (state.lastTransactionGapReminderAt ?? 0) >= 3 * DAY_MS
    ) {
      const days = Math.floor((now - lastRecordedAt) / DAY_MS);
      await NotificationService.showImmediateNotification(
        'Anything to record?',
        `It has been ${days} days since your last recorded transaction. Add anything missing or review your SMS drafts.`,
        { actionType: 'view_drafts', channelId: 'insights', inAppType: 'tip', icon: 'pencil', color: '#0ea5e9', sourceKey: `smart:gap:${todayKey}` }
      );
      state.lastTransactionGapReminderAt = now;
      await saveState(state);
      return true;
    }

    // Send at most one rotating status/tip per day, during evening maintenance.
    if (new Date(now).getHours() < 17 || state.lastSmartInsightDay === todayKey || transactions.length === 0) return false;
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const todayTransactions = transactions.filter(transaction => transaction.date >= start.getTime());
    const income = todayTransactions.filter(transaction => transaction.type === 'INCOME').reduce((sum, transaction) => sum + transaction.amount, 0);
    const expenseTransactions = todayTransactions.filter(transaction => transaction.type === 'EXPENSE');
    const expenses = expenseTransactions.reduce((sum, transaction) => sum + transaction.amount, 0);
    const currency = settings.currency;
    const seed = Number(todayKey.replace(/-/g, '')) % 3;

    if (flags.dailySummaryAlertsEnabled && (seed !== 1 || !flags.personalizedTipsEnabled)) {
      await NotificationService.showImmediateNotification(
        'Today’s financial snapshot',
        todayTransactions.length
          ? settings.balancesHidden
            ? `${todayTransactions.length} transactions recorded today. Open HisabTrack to view the private totals.`
            : `${todayTransactions.length} transactions · ${currency} ${income.toFixed(2)} in · ${currency} ${expenses.toFixed(2)} out.`
          : 'No transactions recorded today. If you spent or received money, take a moment to add it.',
        { actionType: 'view_reports', channelId: 'insights', inAppType: 'info', icon: 'bar-chart', color: '#3b82f6', sourceKey: `smart:daily:${todayKey}` }
      );
    } else if (flags.personalizedTipsEnabled) {
      const categoryTotals = expenseTransactions.reduce((totals, transaction) => {
        totals[transaction.category || 'Other'] = (totals[transaction.category || 'Other'] || 0) + transaction.amount;
        return totals;
      }, {} as Record<string, number>);
      const top = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1])[0];
      const body = top
        ? settings.balancesHidden
          ? `${top[0]} was your largest spending area today. Open HisabTrack to review it privately.`
          : `${top[0]} was your largest spending area today at ${currency} ${top[1].toFixed(2)}. Is that aligned with your plan?`
        : 'A short daily money check makes missed expenses and subscriptions easier to catch.';
      await NotificationService.showImmediateNotification(
        'A tip based on your day', body,
        { actionType: 'view_reports', channelId: 'insights', inAppType: 'tip', icon: 'lightbulb-o', color: '#eab308', isAI: true, sourceKey: `smart:tip:${todayKey}` }
      );
    }
    state.lastSmartInsightDay = todayKey;
    await saveState(state);
    return true;
    });
  }
}
