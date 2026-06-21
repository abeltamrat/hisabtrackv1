import AsyncStorage from '@react-native-async-storage/async-storage';
import { EmailAuthProvider, getAuth, reauthenticateWithCredential } from 'firebase/auth';
import { Platform } from 'react-native';

import { store } from '@/store';
import { resetAccounts } from '@/store/slices/accountsSlice';
import { resetBudgets } from '@/store/slices/budgetsSlice';
import { resetLoans } from '@/store/slices/loansSlice';
import { resetTransactions } from '@/store/slices/transactionsSlice';
import { StorageService } from '@/utils/storage';

import { AppNotificationService } from './AppNotificationService';
import { DraftTransactionService } from './DraftTransactionService';
import LocalChangeEmitter from './LocalChangeEmitter';
import { NotificationService } from './NotificationService';
import { SecureStorageService } from './SecureStorageService';
import SyncService from './SyncService';
import { getDatabase } from './database';

const EXTRA_ASYNC_KEYS = new Set([
  'draft_transactions',
  'rememberedEmail',
  'has_checked_initial_permissions',
  'notifications',
  'app_notifications',
  'editedBundledLogos',
  'global_loan_reminders_enabled',
  'global_reminders_enabled',
]);

const EXTRA_WEB_KEYS = new Set([
  'app_settings',
  'recurring_transactions',
  'global_loan_reminders_enabled',
  'global_reminders_enabled',
  'rememberedEmail',
  'has_checked_initial_permissions',
  'draft_transactions',
  'notifications',
  'app_notifications',
  'editedBundledLogos',
]);

const APP_KEY_PREFIXES = ['@hisabtrack_', 'sms_last_sync_'];

const makeResetError = (code: string, message: string) => {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
};

export class AccountResetService {
  static getResetErrorMessage(error: unknown): string {
    const code = (error as { code?: string })?.code;
    if (code === 'reset/empty-password') return 'Password is required.';
    if (code === 'reset/user-not-found') return 'No signed-in account was found.';
    if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') return 'Incorrect password. Please try again.';
    if (code === 'auth/too-many-requests') return 'Too many attempts. Try again later.';
    if (code === 'auth/network-request-failed') return 'Network error while verifying credentials. Check your internet and try again.';
    return (error as { message?: string })?.message || 'Failed to reset account. Please try again.';
  }

  static async resetWithPassword(password: string): Promise<void> {
    const normalizedPassword = password.trim();
    if (!normalizedPassword) {
      throw makeResetError('reset/empty-password', 'Password is required.');
    }

    const auth = getAuth();
    const currentUser = auth.currentUser;
    if (!currentUser?.email) {
      throw makeResetError('reset/user-not-found', 'No signed-in account was found.');
    }

    const credential = EmailAuthProvider.credential(currentUser.email, normalizedPassword);
    await reauthenticateWithCredential(currentUser, credential);

    if (currentUser.uid) {
      await SyncService.deleteRemoteData(currentUser.uid);
    }

    SyncService.stopAutoSync();

    const db = await getDatabase();
    await db.clearAllData();

    try {
      await NotificationService.cancelAllNotifications();
    } catch (error) {
      console.warn('Reset: failed to cancel scheduled notifications', error);
    }

    try {
      await AppNotificationService.clearAll();
    } catch (error) {
      console.warn('Reset: failed to clear in-app notifications', error);
    }

    try {
      await DraftTransactionService.clearAll();
    } catch (error) {
      console.warn('Reset: failed to clear draft transactions', error);
    }

    await SecureStorageService.clearAll();
    await StorageService.clearAll();

    await this.clearAsyncStorageKeys();
    this.clearWebLocalStorageKeys();

    store.dispatch(resetTransactions());
    store.dispatch(resetAccounts());
    store.dispatch(resetBudgets());
    store.dispatch(resetLoans());

    try {
      LocalChangeEmitter.emit();
    } catch {
      // ignore emitter errors during teardown
    }
  }

  private static async clearAsyncStorageKeys() {
    try {
      const allKeys = await AsyncStorage.getAllKeys();
      const keysToRemove = allKeys.filter((key) => {
        if (EXTRA_ASYNC_KEYS.has(key)) return true;
        return APP_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
      });

      if (keysToRemove.length > 0) {
        await AsyncStorage.multiRemove(keysToRemove);
      }
    } catch (error) {
      console.warn('Reset: failed to clear AsyncStorage keys', error);
    }
  }

  private static clearWebLocalStorageKeys() {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      return;
    }

    try {
      const keys = Object.keys(window.localStorage);
      for (const key of keys) {
        const shouldRemove = EXTRA_WEB_KEYS.has(key) || APP_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
        if (shouldRemove) {
          window.localStorage.removeItem(key);
        }
      }
    } catch (error) {
      console.warn('Reset: failed to clear web localStorage keys', error);
    }
  }
}

export default AccountResetService;
