import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { AppNotification, AppNotificationService } from '@/services/AppNotificationService';

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

type NotificationChannelId = 'default' | 'finance_alerts' | 'reminders' | 'insights' | 'transactions';

export interface NotificationMetadata {
  actionType?: AppNotification['actionType'];
  inAppType?: AppNotification['type'];
  icon?: string;
  color?: string;
  isAI?: boolean;
  storeInApp?: boolean;
  sourceKey?: string;
  channelId?: NotificationChannelId;
  notificationType?: 'RECURRING' | 'ONE_TIME' | 'IMMEDIATE';
  recurringId?: string;
  loanId?: string;
  type?: string;
  amount?: number;
  title?: string;
  body?: string;
  [key: string]: unknown;
}

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

export class NotificationService {
  private static buildSourceKey(prefix: string) {
    return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
  }

  private static resolveMetadata(data?: NotificationMetadata): NotificationMetadata {
    return {
      ...data,
      sourceKey: typeof data?.sourceKey === 'string' ? data.sourceKey : this.buildSourceKey('notification'),
    };
  }

  private static getDefaultInAppType(data?: NotificationMetadata): AppNotification['type'] {
    if (data?.inAppType) return data.inAppType;
    if (data?.actionType === 'view_budget' || data?.actionType === 'view_loans') return 'alert';
    if (data?.actionType === 'view_drafts') return 'warning';
    if (data?.isAI) return 'tip';
    return 'info';
  }

  private static getDefaultIcon(data?: NotificationMetadata) {
    if (data?.icon) return data.icon;
    if (data?.actionType === 'view_budget') return 'pie-chart';
    if (data?.actionType === 'view_loans') return 'bank';
    if (data?.actionType === 'view_recurring') return 'calendar';
    if (data?.actionType === 'view_reports') return 'line-chart';
    if (data?.actionType === 'view_drafts') return 'inbox';
    return 'bell';
  }

  private static getDefaultColor(data?: NotificationMetadata) {
    if (data?.color) return data.color;
    if (data?.actionType === 'view_budget') return '#f59e0b';
    if (data?.actionType === 'view_loans') return '#ef4444';
    if (data?.actionType === 'view_recurring') return '#6366f1';
    if (data?.actionType === 'view_reports') return '#3b82f6';
    if (data?.actionType === 'view_drafts') return '#f59e0b';
    return '#6366f1';
  }

  private static async mirrorInAppNotification(title: string, body: string, data?: NotificationMetadata) {
    if (data?.storeInApp === false) return;

    await AppNotificationService.addNotification({
      title,
      message: body,
      sourceKey: data?.sourceKey,
      type: this.getDefaultInAppType(data),
      icon: this.getDefaultIcon(data),
      color: this.getDefaultColor(data),
      isAI: !!data?.isAI,
      actionType: data?.actionType,
    });
  }

  private static async ensureAndroidChannel(): Promise<void> {
    if (Platform.OS !== 'android') return;

    try {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'General',
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 200, 150, 200],
        lightColor: '#6366f1',
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });

      await Notifications.setNotificationChannelAsync('finance_alerts', {
        name: 'Finance Alerts',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 150, 250],
        lightColor: '#ef4444',
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        bypassDnd: true,
      });

      await Notifications.setNotificationChannelAsync('reminders', {
        name: 'Reminders',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#10b981',
        sound: 'coin.wav',
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });

      await Notifications.setNotificationChannelAsync('insights', {
        name: 'Insights',
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 150, 100, 150],
        lightColor: '#3b82f6',
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });

      // Keep legacy channel name for existing callers.
      await Notifications.setNotificationChannelAsync('transactions', {
        name: 'Transactions & Reminders',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#10b981',
        sound: 'coin.wav',
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });

      await Notifications.setNotificationCategoryAsync('RECURRING_TRANSACTION', [
        {
          identifier: 'COMMIT',
          buttonTitle: 'Commit & Save',
          options: { opensAppToForeground: true },
        },
        {
          identifier: 'SNOOZE',
          buttonTitle: 'Snooze (1h)',
          options: { opensAppToForeground: true },
        },
        {
          identifier: 'DISMISS',
          buttonTitle: 'Dismiss',
          options: { opensAppToForeground: false },
        },
      ]);

      await Notifications.setNotificationCategoryAsync('LOAN_REMINDER', [
        {
          identifier: 'SNOOZE',
          buttonTitle: 'Snooze (1h)',
          options: { opensAppToForeground: true },
        },
        {
          identifier: 'DISMISS',
          buttonTitle: 'Dismiss',
          options: { opensAppToForeground: false },
        },
      ]);
    } catch (error) {
      console.error('Error setting Android notification channel/categories:', error);
    }
  }

  static async requestPermissions(): Promise<boolean> {
    if (Platform.OS === 'web') return false;

    try {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        console.log('Notification permissions not granted');
        return false;
      }

      await this.ensureAndroidChannel();
      return true;
    } catch (error: any) {
      if (isExpoGo && error?.message?.includes('remote notifications')) {
        console.log('Push notifications error in Expo Go, assuming local might work');
        return true;
      }
      console.error('Error requesting notification permissions:', error);
      return false;
    }
  }

  static async hasPermission(): Promise<boolean> {
    if (Platform.OS === 'web') return false;

    try {
      const { status } = await Notifications.getPermissionsAsync();
      return status === 'granted';
    } catch (error) {
      console.error('Error checking notification permissions:', error);
      return false;
    }
  }

  static async scheduleRecurringReminder(
    id: string,
    title: string,
    amount: number,
    type: 'INCOME' | 'EXPENSE' | 'TRANSFER',
    triggerDate: Date,
    frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
  ): Promise<string | null> {
    if (Platform.OS === 'web') return null;

    try {
      const hasPermission = await this.requestPermissions();
      if (!hasPermission) return null;

      const seconds = Math.floor((triggerDate.getTime() - Date.now()) / 1000);
      if (seconds <= 0) return null;

      const metadata = this.resolveMetadata({
        recurringId: id,
        type,
        amount,
        title,
        notificationType: 'RECURRING',
        actionType: 'view_recurring',
        inAppType: 'info',
        icon: 'calendar',
        color: '#6366f1',
        channelId: 'reminders',
        frequency,
      });

      const content: Notifications.NotificationContentInput = {
        title: `${type === 'INCOME' ? 'Income' : type === 'EXPENSE' ? 'Expense' : 'Transfer'} Reminder`,
        body: `${title}: ${type === 'INCOME' ? '+' : type === 'EXPENSE' ? '-' : '->'}$${amount.toFixed(2)}`,
        sound: true,
        categoryIdentifier: 'RECURRING_TRANSACTION',
        data: metadata,
      };

      if (Platform.OS === 'android') {
        (content as any).channelId = metadata.channelId;
      }

      return await Notifications.scheduleNotificationAsync({
        content,
        trigger: { type: 'timeInterval', seconds, repeats: false } as any,
      });
    } catch (error) {
      console.error('Error scheduling recurring notification:', error);
      return null;
    }
  }

  static async scheduleOneTimeReminder(
    title: string,
    body: string,
    triggerDate: Date,
    data?: NotificationMetadata
  ): Promise<string | null> {
    if (Platform.OS === 'web') return null;

    try {
      const hasPermission = await this.requestPermissions();
      if (!hasPermission) return null;

      const seconds = Math.floor((triggerDate.getTime() - Date.now()) / 1000);
      if (seconds <= 0) return null;

      const metadata = this.resolveMetadata({
        ...data,
        title,
        body,
        notificationType: 'ONE_TIME',
        actionType: data?.actionType ?? (data?.loanId ? 'view_loans' : undefined),
        inAppType: data?.inAppType ?? (data?.type === 'LOAN_REMINDER' ? 'alert' : 'info'),
        icon: data?.icon ?? (data?.type === 'LOAN_REMINDER' ? 'bank' : 'calendar'),
        color: data?.color ?? (data?.type === 'LOAN_REMINDER' ? '#ef4444' : '#6366f1'),
        channelId: data?.channelId ?? (data?.type === 'LOAN_REMINDER' ? 'reminders' : 'finance_alerts'),
      });

      const content: Notifications.NotificationContentInput = {
        title,
        body,
        sound: true,
        categoryIdentifier: data?.type === 'LOAN_REMINDER' ? 'LOAN_REMINDER' : undefined,
        data: metadata,
      };

      if (Platform.OS === 'android') {
        (content as any).channelId = metadata.channelId;
      }

      return await Notifications.scheduleNotificationAsync({
        content,
        trigger: { type: 'timeInterval', seconds, repeats: false } as any,
      });
    } catch (error) {
      console.error('Error scheduling one-time notification:', error);
      return null;
    }
  }

  static async snoozeNotification(response: Notifications.NotificationResponse) {
    const data = (response.notification.request.content.data || {}) as NotificationMetadata;
    const title = response.notification.request.content.title || 'Snoozed Reminder';
    const body = response.notification.request.content.body || 'This reminder was snoozed.';
    const snoozeTime = new Date(Date.now() + 60 * 60 * 1000);

    if (data.notificationType === 'RECURRING' && typeof data.recurringId === 'string') {
      return await this.scheduleRecurringReminder(
        data.recurringId,
        String(data.title || title),
        Number(data.amount || 0),
        (data.type as 'INCOME' | 'EXPENSE' | 'TRANSFER') || 'EXPENSE',
        snoozeTime,
        'DAILY'
      );
    }

    return await this.scheduleOneTimeReminder(title, body, snoozeTime, {
      ...data,
      sourceKey: this.buildSourceKey('snooze'),
    });
  }

  static async cancelNotification(notificationId: string): Promise<void> {
    if (Platform.OS === 'web' || !notificationId) return;
    try {
      await Notifications.cancelScheduledNotificationAsync(notificationId);
    } catch (error) {
      console.error('Error cancelling notification:', error);
    }
  }

  static async cancelAllNotifications(): Promise<void> {
    if (Platform.OS === 'web') return;
    try {
      await Notifications.cancelAllScheduledNotificationsAsync();
    } catch (error) {
      console.error('Error cancelling all notifications:', error);
    }
  }

  static async getAllScheduledNotifications(): Promise<Notifications.NotificationRequest[]> {
    try {
      return await Notifications.getAllScheduledNotificationsAsync();
    } catch (error) {
      console.error('Error getting scheduled notifications:', error);
      return [];
    }
  }

  static async showImmediateNotification(
    title: string,
    body: string,
    data?: NotificationMetadata
  ): Promise<void> {
    try {
      const hasPermission = await this.requestPermissions();
      if (!hasPermission) return;

      const metadata = this.resolveMetadata({
        ...data,
        title,
        body,
        notificationType: 'IMMEDIATE',
        channelId: data?.channelId ?? 'finance_alerts',
      });

      const content: Notifications.NotificationContentInput = {
        title,
        body,
        sound: true,
        data: metadata,
      };

      if (Platform.OS === 'android') {
        (content as any).channelId = metadata.channelId;
      }

      await this.mirrorInAppNotification(title, body, metadata);

      await Notifications.scheduleNotificationAsync({
        content,
        trigger: null,
      });
    } catch (error) {
      console.error('Error showing immediate notification:', error);
    }
  }

  static async syncReceivedNotification(notification: Notifications.Notification): Promise<void> {
    const title = notification.request.content.title || 'Notification';
    const body = notification.request.content.body || '';
    const data = (notification.request.content.data || {}) as NotificationMetadata;
    await this.mirrorInAppNotification(title, body, data);
  }

  static async syncPresentedNotifications(): Promise<void> {
    if (Platform.OS === 'web') return;

    try {
      const presented = await Notifications.getPresentedNotificationsAsync();
      await Promise.all(presented.map((notification) => this.syncReceivedNotification(notification)));
    } catch (error) {
      console.error('Error syncing presented notifications:', error);
    }
  }

  static async syncNotificationResponse(response: Notifications.NotificationResponse): Promise<void> {
    await this.syncReceivedNotification(response.notification);
  }

  static addNotificationReceivedListener(
    callback: (notification: Notifications.Notification) => void
  ): Notifications.Subscription {
    return Notifications.addNotificationReceivedListener(callback);
  }

  static addNotificationResponseListener(
    callback: (response: Notifications.NotificationResponse) => void
  ): Notifications.Subscription {
    return Notifications.addNotificationResponseReceivedListener(callback);
  }
}

export default NotificationService;
