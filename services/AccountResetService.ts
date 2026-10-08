import { sessionLocalStorage } from '@/services/SessionStorage';
import AsyncStorage from '@/services/SessionStorage';
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

const makeResetError = (code: string, message: string) => {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
};

export class AccountResetService {
  static async deleteAccount(): Promise<void> {
    const { getFunctions, httpsCallable } = await import('firebase/functions');
    SyncService.stopAutoSync(); await SyncService.settle();
    await (await import('./BackgroundService')).BackgroundService.suspend();
    await (await import('./SMSSyncService')).SMSSyncService.suspend();
    await (await import('./LinkedPaymentService')).default.suspend();
    try { await (await import('./FundPostingService')).default.suspend(); (await import('./FundSyncService')).default.stop(); } catch { /* funds must not block this */ }
    await DraftTransactionService.settle();
    try { await httpsCallable(getFunctions(), 'deleteMyAccount', { timeout: 540000 })({}); }
    catch (error) { await this.resumeServices(); throw error; }
    const db = await getDatabase();
    await db.clearAllData(); await db.writeMeta('outbox', {}); await db.writeMeta('linked_payment_jobs', []);
    await db.writeMeta('pending_restore', null); await db.writeMeta('sync_conflicts', []);
    await NotificationService.cancelAllNotifications();
    await (await import('./AppLockService')).AppLockService.clearPin();
    await SecureStorageService.clearAll(); await AsyncStorage.clear();
    if (Platform.OS === 'web') sessionLocalStorage.clear();
    await (await import('./AuthService')).AuthService.signOut();
  }

  static getResetErrorMessage(error: unknown): string {
    const code = (error as { code?: string })?.code;
    if (code === 'reset/empty-password') return 'Password is required.';
    if (code === 'reset/user-not-found') return 'No signed-in account was found.';
    if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') return 'Incorrect password. Please try again.';
    if (code === 'auth/too-many-requests') return 'Too many attempts. Try again later.';
    if (code === 'auth/network-request-failed') return 'Network error while verifying credentials. Check your internet and try again.';
    if (code === 'unavailable' || code === 'deadline-exceeded') return 'Network error while deleting cloud data. Check your internet connection and try again.';
    return (error as { message?: string })?.message || 'Failed to reset account. Please try again.';
  }

  /**
   * Returns true when the current Firebase user signed in with email/password.
   * Phone-auth users have no 'password' provider in providerData.
   */
  static isEmailPasswordUser(): boolean {
    const auth = getAuth();
    const currentUser = auth.currentUser;
    if (!currentUser) return false;
    return currentUser.providerData.some(p => p.providerId === 'password');
  }

  static async resetWithPassword(password?: string): Promise<void> {
    const auth = getAuth();
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw makeResetError('reset/user-not-found', 'No signed-in account was found.');
    }

    const hasEmailProvider = currentUser.providerData.some(p => p.providerId === 'password');

    if (hasEmailProvider) {
      const normalizedPassword = password ?? '';
      if (!normalizedPassword) {
        throw makeResetError('reset/empty-password', 'Password is required.');
      }
      if (!currentUser.email) {
        throw makeResetError('reset/user-not-found', 'No email found for this account.');
      }
      const credential = EmailAuthProvider.credential(currentUser.email, normalizedPassword);
      await reauthenticateWithCredential(currentUser, credential);
    }
    // Phone-auth users: already authenticated on device — no additional verification needed.

    SyncService.stopAutoSync();
    await SyncService.settle();
    await (await import('./BackgroundService')).BackgroundService.suspend();
    await (await import('./SMSSyncService')).SMSSyncService.suspend();
    await (await import('./LinkedPaymentService')).default.suspend();
    try { await (await import('./FundPostingService')).default.suspend(); (await import('./FundSyncService')).default.stop(); } catch { /* funds must not block this */ }
    await DraftTransactionService.settle();
    if (currentUser.uid) {
      // Propagate Firestore deletion errors — silent failure means data returns on next sign-in.
      try { await SyncService.deleteRemoteData(currentUser.uid); }
      catch (error) { await this.resumeServices(); throw error; }
    }

    SyncService.stopAutoSync();

    const db = await getDatabase();
    await db.clearAllData();
    await db.writeMeta('outbox', {});
    await db.writeMeta('linked_payment_jobs', []);
    await db.writeMeta('pending_restore', null); await db.writeMeta('sync_conflicts', []);

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

    await (await import('./AppLockService')).AppLockService.clearPin();
    await SecureStorageService.clearAll();
    await AsyncStorage.clear();
    if (Platform.OS === 'web') sessionLocalStorage.clear();
    await StorageService.clearAll();


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

  private static async resumeServices() {
    if (!getAuth().currentUser) return;
    (await import('./BackgroundService')).BackgroundService.resume();
    (await import('./SMSSyncService')).SMSSyncService.resume();
    (await import('./LinkedPaymentService')).default.resume();
    try { (await import('./FundPostingService')).default.resume(); } catch { /* funds must not block this */ }
    if ((await (await import('@/contexts/AppSettingsContext')).loadStoredAppSettings()).cloudSyncEnabled) SyncService.startAutoSync(getAuth().currentUser!.uid);
  }
}

export default AccountResetService;
