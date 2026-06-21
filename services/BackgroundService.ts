import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { loadStoredAppSettings } from '@/contexts/AppSettingsContext';
import { AppNotificationService } from './AppNotificationService';
import { DraftTransactionService } from './DraftTransactionService';
import { NotificationMetadata, NotificationService } from './NotificationService';
import { SMSSyncService } from './SMSSyncService';

const BACKGROUND_SYNC_TASK = 'BACKGROUND_SYNC_TASK';
const BACKGROUND_STATE_KEY = '@hisabtrack_background_state';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const FOREGROUND_CHECK_COOLDOWN_MS = 2 * HOUR_MS;
const BACKGROUND_CHECK_COOLDOWN_MS = HOUR_MS;
const SMS_BACKGROUND_SYNC_COOLDOWN_MS = HOUR_MS;
const INACTIVITY_THRESHOLD_MS = 7 * DAY_MS;
const INACTIVITY_REMINDER_COOLDOWN_MS = 3 * DAY_MS;
const RECONCILIATION_THRESHOLD_MS = 30 * DAY_MS;
const RECONCILIATION_REMINDER_COOLDOWN_MS = 7 * DAY_MS;
const PENDING_DRAFT_STALE_MS = DAY_MS;
const PENDING_DRAFT_REMINDER_COOLDOWN_MS = DAY_MS;
const INSIGHTS_CHECK_COOLDOWN_MS = DAY_MS;
const MAX_BACKGROUND_ALERTS_PER_RUN = 2;

type MaintenanceSource = 'launch' | 'foreground' | 'background';

export interface BackgroundState {
  firstSeenAt: number;
  lastAppActiveAt: number;
  lastReconciliationAt?: number;
  lastForegroundCheckAt?: number;
  lastBackgroundCheckAt?: number;
  lastSmsSyncAt?: number;
  lastInactivityReminderAt?: number;
  lastReconciliationReminderAt?: number;
  lastPendingDraftReminderAt?: number;
  lastInsightsCheckAt?: number;
}

export interface BackgroundStatusSnapshot {
  state: BackgroundState;
  taskRegistered: boolean;
  taskStatus: string;
  notificationsEnabled: boolean;
}

async function loadState(now = Date.now()): Promise<BackgroundState> {
  try {
    const raw = await AsyncStorage.getItem(BACKGROUND_STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<BackgroundState>;
      return {
        firstSeenAt: parsed.firstSeenAt ?? now,
        lastAppActiveAt: parsed.lastAppActiveAt ?? now,
        lastReconciliationAt: parsed.lastReconciliationAt,
        lastForegroundCheckAt: parsed.lastForegroundCheckAt,
        lastBackgroundCheckAt: parsed.lastBackgroundCheckAt,
        lastSmsSyncAt: parsed.lastSmsSyncAt,
        lastInactivityReminderAt: parsed.lastInactivityReminderAt,
        lastReconciliationReminderAt: parsed.lastReconciliationReminderAt,
        lastPendingDraftReminderAt: parsed.lastPendingDraftReminderAt,
        lastInsightsCheckAt: parsed.lastInsightsCheckAt,
      };
    }
  } catch (error) {
    console.error('[BackgroundService] Failed to load state:', error);
  }

  return {
    firstSeenAt: now,
    lastAppActiveAt: now,
  };
}

async function saveState(state: BackgroundState): Promise<void> {
  try {
    await AsyncStorage.setItem(BACKGROUND_STATE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error('[BackgroundService] Failed to save state:', error);
  }
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export const BackgroundService = {
  async markAppActive(): Promise<void> {
    if (Platform.OS === 'web') return;

    const now = Date.now();
    const state = await loadState(now);
    state.lastAppActiveAt = now;
    await saveState(state);
  },

  async markReconciliationReview(): Promise<void> {
    if (Platform.OS === 'web') return;

    const now = Date.now();
    const state = await loadState(now);
    state.lastReconciliationAt = now;
    await saveState(state);
  },

  async runMaintenance(source: MaintenanceSource = 'foreground', options?: { force?: boolean }): Promise<boolean> {
    if (Platform.OS === 'web') return false;

    const appSettings = await loadStoredAppSettings();
    const reminderSettings = appSettings.backgroundReminders;
    if (!reminderSettings.backgroundProcessingEnabled) {
      return false;
    }

    const now = Date.now();
    const state = await loadState(now);
    const lastCheckKey = source === 'background' ? 'lastBackgroundCheckAt' : 'lastForegroundCheckAt';
    const cooldown = source === 'background' ? BACKGROUND_CHECK_COOLDOWN_MS : FOREGROUND_CHECK_COOLDOWN_MS;
    const lastCheckAt = state[lastCheckKey] ?? 0;

    if (!options?.force && lastCheckAt > 0 && now - lastCheckAt < cooldown) {
      return false;
    }

    let alertsSent = 0;
    let hasWork = false;
    const notificationsEnabled = await NotificationService.hasPermission();

    const notify = async (title: string, body: string, data: NotificationMetadata): Promise<boolean> => {
      if (!notificationsEnabled || alertsSent >= MAX_BACKGROUND_ALERTS_PER_RUN) {
        return false;
      }

      await NotificationService.showImmediateNotification(title, body, data);
      alertsSent += 1;
      return true;
    };

    try {
      if (source === 'background' && Platform.OS === 'android' && reminderSettings.backgroundSmsSyncEnabled) {
        const shouldSyncSms = now - (state.lastSmsSyncAt ?? 0) >= SMS_BACKGROUND_SYNC_COOLDOWN_MS;
        if (shouldSyncSms) {
          const result = await SMSSyncService.syncAllAccountsBackground({ historicalDays: 0 });
          state.lastSmsSyncAt = now;

          if (result.newDrafts > 0) {
            const latestDraftAt = Math.max(...result.drafts.map((draft) => draft.created_at), now);
            await notify(
              'New SMS transactions',
              `${pluralize(result.newDrafts, 'transaction')} ${result.newDrafts === 1 ? 'needs' : 'need'} review in your draft list.`,
              {
                actionType: 'view_drafts',
                inAppType: 'warning',
                icon: 'inbox',
                color: '#f59e0b',
                channelId: 'transactions',
                sourceKey: `background:sms-drafts:${latestDraftAt}`,
              }
            );
            hasWork = true;
          }
        }
      }

      const drafts = await DraftTransactionService.getAll();
      const pendingDrafts = drafts.filter((draft) => draft.status === 'PENDING');
      const oldestPendingCreatedAt = pendingDrafts.reduce(
        (min, draft) => Math.min(min, draft.created_at),
        Number.POSITIVE_INFINITY
      );

      if (
        reminderSettings.pendingDraftAlertsEnabled
        && (
        pendingDrafts.length > 0
        && Number.isFinite(oldestPendingCreatedAt)
        && now - oldestPendingCreatedAt >= PENDING_DRAFT_STALE_MS
        && now - (state.lastPendingDraftReminderAt ?? 0) >= PENDING_DRAFT_REMINDER_COOLDOWN_MS
        )
      ) {
        const reminderSent = await notify(
          'Pending SMS review',
          `You still have ${pluralize(pendingDrafts.length, 'SMS draft')} waiting to be recorded or rejected.`,
          {
            actionType: 'view_drafts',
            inAppType: 'warning',
            icon: 'tasks',
            color: '#f59e0b',
            channelId: 'transactions',
            sourceKey: `background:pending-drafts:${Math.floor(oldestPendingCreatedAt / DAY_MS)}`,
          }
        );
        if (reminderSent) {
          state.lastPendingDraftReminderAt = now;
          hasWork = true;
        }
      }

      if (
        source === 'background'
        && reminderSettings.inactivityAlertsEnabled
        && now - state.lastAppActiveAt >= INACTIVITY_THRESHOLD_MS
        && now - (state.lastInactivityReminderAt ?? 0) >= INACTIVITY_REMINDER_COOLDOWN_MS
      ) {
        const daysAway = Math.max(1, Math.floor((now - state.lastAppActiveAt) / DAY_MS));
        const inactivitySent = await notify(
          'Time for a quick money check',
          `You have not opened Hisab Track in ${daysAway} days. Review your balances, drafts, and upcoming bills.`,
          {
            actionType: 'view_reports',
            inAppType: 'info',
            icon: 'line-chart',
            color: '#3b82f6',
            channelId: 'insights',
            sourceKey: `background:inactive:${Math.floor(state.lastAppActiveAt / DAY_MS)}`,
          }
        );
        if (inactivitySent) {
          state.lastInactivityReminderAt = now;
          hasWork = true;
        }
      }

      const reconciliationBase = state.lastReconciliationAt ?? state.firstSeenAt;
      if (
        reminderSettings.reconciliationAlertsEnabled
        && (
        now - reconciliationBase >= RECONCILIATION_THRESHOLD_MS
        && now - (state.lastReconciliationReminderAt ?? 0) >= RECONCILIATION_REMINDER_COOLDOWN_MS
        )
      ) {
        const daysSinceReview = Math.max(1, Math.floor((now - reconciliationBase) / DAY_MS));
        const pendingHint = pendingDrafts.length > 0
          ? ` You also have ${pluralize(pendingDrafts.length, 'draft')} waiting for review.`
          : '';

        const reconciliationSent = await notify(
          'Reconciliation reminder',
          `It has been ${daysSinceReview} days since your last SMS and balance review.${pendingHint}`,
          {
            actionType: 'view_drafts',
            inAppType: 'tip',
            icon: 'balance-scale',
            color: '#6366f1',
            channelId: 'insights',
            sourceKey: `background:reconciliation:${Math.floor(reconciliationBase / DAY_MS)}`,
          }
        );
        if (reconciliationSent) {
          state.lastReconciliationReminderAt = now;
          hasWork = true;
        }
      }

      if (now - (state.lastInsightsCheckAt ?? 0) >= INSIGHTS_CHECK_COOLDOWN_MS) {
        await AppNotificationService.checkAll();
        state.lastInsightsCheckAt = now;
        hasWork = true;
      }

      state[lastCheckKey] = now;
      await saveState(state);

      return hasWork;
    } catch (error) {
      state[lastCheckKey] = now;
      await saveState(state);
      console.error(`[BackgroundService] ${source} maintenance failed:`, error);
      return false;
    }
  },

  async runMaintenanceNow(): Promise<boolean> {
    return await this.runMaintenance('foreground', { force: true });
  },

  async getStatusSnapshot(): Promise<BackgroundStatusSnapshot> {
    const state = await loadState();

    if (Platform.OS === 'web') {
      return {
        state,
        taskRegistered: false,
        taskStatus: 'unsupported',
        notificationsEnabled: false,
      };
    }

    let taskRegistered = false;
    let taskStatus = 'unknown';
    let notificationsEnabled = false;

    try {
      taskRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK);
    } catch (error) {
      console.error('[BackgroundService] Failed to get task registration state:', error);
    }

    try {
      const status = await BackgroundFetch.getStatusAsync();
      if (status === BackgroundFetch.BackgroundFetchStatus.Available) taskStatus = 'available';
      else if (status === BackgroundFetch.BackgroundFetchStatus.Denied) taskStatus = 'denied';
      else if (status === BackgroundFetch.BackgroundFetchStatus.Restricted) taskStatus = 'restricted';
      else taskStatus = String(status);
    } catch (error) {
      console.error('[BackgroundService] Failed to get background fetch status:', error);
    }

    try {
      notificationsEnabled = await NotificationService.hasPermission();
    } catch (error) {
      console.error('[BackgroundService] Failed to get notification permission state:', error);
    }

    return {
      state,
      taskRegistered,
      taskStatus,
      notificationsEnabled,
    };
  },

  async registerTask(enabledOverride?: boolean) {
    if (Platform.OS === 'web') {
      console.log('[BackgroundService] Skipping registration on web platform');
      return;
    }

    try {
      const reminderSettings = (await loadStoredAppSettings()).backgroundReminders;
      const isEnabled = enabledOverride ?? reminderSettings.backgroundProcessingEnabled;
      if (!isEnabled) {
        await this.unregisterTask();
        return;
      }

      const status = await BackgroundFetch.getStatusAsync();
      if (status !== BackgroundFetch.BackgroundFetchStatus.Available) {
        console.log('[BackgroundService] Background fetch not available:', status);
        return;
      }

      const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK);
      if (!isRegistered) {
        await BackgroundFetch.registerTaskAsync(BACKGROUND_SYNC_TASK, {
          minimumInterval: 60 * 60,
          stopOnTerminate: false,
          startOnBoot: true,
        });
        console.log('[BackgroundService] Task registered successfully');
      }
    } catch (error) {
      console.error('[BackgroundService] Task registration failed:', error);
    }
  },

  async unregisterTask() {
    if (Platform.OS === 'web') return;

    try {
      const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK);
      if (isRegistered) {
        await BackgroundFetch.unregisterTaskAsync(BACKGROUND_SYNC_TASK);
        console.log('[BackgroundService] Task unregistered');
      }
    } catch (error) {
      console.error('[BackgroundService] Task unregistration failed:', error);
    }
  },
};

if (Platform.OS !== 'web') {
  TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
    try {
      console.log('[BackgroundService] Background task running...');
      const hasNewData = await BackgroundService.runMaintenance('background');
      return hasNewData
        ? BackgroundFetch.BackgroundFetchResult.NewData
        : BackgroundFetch.BackgroundFetchResult.NoData;
    } catch (error) {
      console.error('[BackgroundService] Background task failed:', error);
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }
  });
}
