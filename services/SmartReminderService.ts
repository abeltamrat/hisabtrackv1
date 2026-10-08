import AsyncStorage from '@/services/SessionStorage';
import { Platform } from 'react-native';

import { loadStoredAppSettings } from '@/contexts/AppSettingsContext';
import { createSerialQueue } from '@/utils/asyncLock';
import { getDatabase } from './database';
import { NotificationService } from './NotificationService';
import { operatingExpense, operatingIncome, operatingTransactions, sumMoney } from '@/utils/finance';
import ForecastService from '@/services/ForecastService';
import { RecurringTransactionService } from '@/services/RecurringTransactionService';

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
  forecastWarnings?: Record<string, { signature: string; lastSentAt: number }>;
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
    const [transactions, accounts, loans, recurring] = await Promise.all([
      db.getTransactions(), db.getAccounts(), db.getLoans(), RecurringTransactionService.getAll(),
    ]);
    const latestTransactionDate = transactions.reduce((max, transaction) => Math.max(max, transaction.date), 0);
    const lastRecordedAt = state.lastRecordedTransactionAt ?? latestTransactionDate;

    if (flags.dailySummaryAlertsEnabled && accounts.length > 0) {
      const forecast = ForecastService.generateForecast({ accounts, loans, recurring, transactions, days: 30, startDate: now });
      const current = state.forecastWarnings || {};
      const activeIds = new Set(forecast.lowBalanceWarnings.map(warning => warning.accountId));
      for (const accountId of Object.keys(current)) if (!activeIds.has(accountId)) delete current[accountId];
      let sent = 0;
      for (const warning of forecast.lowBalanceWarnings) {
        const day = new Date(warning.crossingDate).toISOString().slice(0, 10);
        const signature = `${day}:${warning.reserveAmount}:${warning.projectedBalance}`;
        const previous = current[warning.accountId];
        if (previous?.signature === signature || sent >= 2) continue;
        if (previous && now - previous.lastSentAt < DAY_MS) continue;
        const cause = warning.causingEvents.filter(event => event.type !== 'INCOME').map(event => event.title).slice(0, 2).join(' and ');
        const body = settings.balancesHidden
          ? `${warning.accountName} may fall below its reserve on ${new Date(warning.crossingDate).toLocaleDateString()}. Open HisabTrack for the private details.`
          : `${warning.accountName} may fall below ${settings.currency} ${warning.reserveAmount.toFixed(2)} on ${new Date(warning.crossingDate).toLocaleDateString()}${cause ? ` after ${cause}` : ''}.`;
        const didSend = await NotificationService.showImmediateNotification(
          'Low-balance forecast', body,
          { actionType: 'view_reports', channelId: 'finance_alerts', inAppType: 'warning', icon: 'line-chart', color: '#dc2626', sourceKey: `forecast:system:${warning.accountId}:${signature}` }
        );
        if (didSend) {
          current[warning.accountId] = { signature, lastSentAt: now };
          sent += 1;
        }
      }
      state.forecastWarnings = current;
      await saveState(state);
      if (sent > 0) return true;
    }

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
    const income = sumMoney(todayTransactions.map(operatingIncome));
    const expenseTransactions = operatingTransactions(todayTransactions).filter(transaction => transaction.type === 'EXPENSE');
    const expenses = sumMoney(todayTransactions.map(operatingExpense));
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
        totals[transaction.category || 'Other'] = sumMoney([totals[transaction.category || 'Other'] || 0, transaction.amount]);
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
