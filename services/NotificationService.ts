import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

// Configure notification behavior
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

export class NotificationService {
  /**
   * Request notification permissions
   */
  static async requestPermissions(): Promise<boolean> {
    if (Platform.OS === 'web') return false; // Notifications not supported on web

    // In Expo Go, we can't request push permissions without triggering an error in SDK 53+
    // We'll assume local notifications are allowed or just return true to avoid the error
    if (isExpoGo) {
      console.log('Skipping permission request in Expo Go to avoid remote notification errors');
      return true;
    }

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

      return true;
    } catch (error: any) {
      // Ignore specific Expo Go error regarding remote notifications
      if (error?.message?.includes('remote notifications') && error?.message?.includes('Expo Go')) {
        console.log('Push notifications are not supported in Expo Go');
        return false;
      }
      console.error('Error requesting notification permissions:', error);
      return false;
    }
  }

  /**
   * Schedule a recurring transaction reminder
   */
  static async scheduleRecurringReminder(
    id: string,
    title: string,
    amount: number,
    type: 'INCOME' | 'EXPENSE',
    triggerDate: Date,
    frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
  ): Promise<string | null> {
    if (Platform.OS === 'web') return null;
    try {
      const hasPermission = await this.requestPermissions();
      if (!hasPermission) {
        console.log('No notification permission');
        return null;
      }

      const notificationId = await Notifications.scheduleNotificationAsync({
        content: {
          title: `💰 ${type === 'INCOME' ? 'Income' : 'Expense'} Reminder`,
          body: `${title}: ${type === 'INCOME' ? '+' : '-'}$${amount.toFixed(2)}`,
          sound: 'default', // You can add custom sound here
          data: {
            recurringId: id,
            type,
            amount,
          },
        },
        trigger: {
          date: triggerDate,
          repeats: true,
        } as any,
      });

      console.log('Notification scheduled:', notificationId);
      return notificationId;
    } catch (error) {
      console.error('Error scheduling notification:', error);
      return null;
    }
  }

  /**
   * Schedule a one-time reminder
   */
  static async scheduleOneTimeReminder(
    title: string,
    body: string,
    triggerDate: Date,
    data?: any
  ): Promise<string | null> {
    if (Platform.OS === 'web') return null;
    try {
      const hasPermission = await this.requestPermissions();
      if (!hasPermission) {
        return null;
      }

      const notificationId = await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          sound: 'default',
          data,
        },
        trigger: {
          date: triggerDate,
        } as any,
      });

      console.log('One-time notification scheduled:', notificationId, 'for', triggerDate.toISOString());
      return notificationId;
    } catch (error) {
      console.error('Error scheduling one-time notification:', error);
      return null;
    }
  }

  /**
   * Cancel a scheduled notification
   */
  static async cancelNotification(notificationId: string): Promise<void> {
    if (Platform.OS === 'web') return;
    try {
      await Notifications.cancelScheduledNotificationAsync(notificationId);
      console.log('Notification cancelled:', notificationId);
    } catch (error) {
      console.error('Error cancelling notification:', error);
    }
  }

  /**
   * Cancel all scheduled notifications
   */
  static async cancelAllNotifications(): Promise<void> {
    if (Platform.OS === 'web') return;
    try {
      await Notifications.cancelAllScheduledNotificationsAsync();
      console.log('All notifications cancelled');
    } catch (error) {
      console.error('Error cancelling all notifications:', error);
    }
  }

  /**
   * Get all scheduled notifications
   */
  static async getAllScheduledNotifications(): Promise<Notifications.NotificationRequest[]> {
    try {
      return await Notifications.getAllScheduledNotificationsAsync();
    } catch (error) {
      console.error('Error getting scheduled notifications:', error);
      return [];
    }
  }

  /**
   * Show immediate notification (for testing or instant alerts)
   */
  static async showImmediateNotification(
    title: string,
    body: string,
    data?: any
  ): Promise<void> {
    try {
      const hasPermission = await this.requestPermissions();
      if (!hasPermission) {
        return;
      }

      await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          sound: 'default',
          data,
        },
        trigger: null, // Show immediately
      });
    } catch (error) {
      console.error('Error showing immediate notification:', error);
    }
  }

  /**
   * Add notification listener
   */
  static addNotificationReceivedListener(
    callback: (notification: Notifications.Notification) => void
  ): Notifications.Subscription {
    return Notifications.addNotificationReceivedListener(callback);
  }

  /**
   * Add notification response listener (when user taps notification)
   */
  static addNotificationResponseListener(
    callback: (response: Notifications.NotificationResponse) => void
  ): Notifications.Subscription {
    return Notifications.addNotificationResponseReceivedListener(callback);
  }
}
