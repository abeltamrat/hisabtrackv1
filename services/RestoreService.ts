import { Platform } from 'react-native';
import Storage, { sessionLocalStorage, getSessionScope } from './SessionStorage';
import { BackupService, BackupData } from './BackupService';
import { getDatabase } from './database';
import { StorageService } from '@/utils/storage';
import { SMSLearningService } from './SMSLearningService';
import { SecureStorageService } from './SecureStorageService';
import { loadStoredAppSettings } from '@/contexts/AppSettingsContext';

const merge = (existing: any[], incoming: any[]) => [...new Map([...existing, ...incoming].map(item => [item.id, item])).values()];
export class RestoreService {
  static async restore(backup: BackupData) {
    if (!BackupService.validateBackup(backup)) throw new Error('Invalid backup records');
    const db = await getDatabase();
    const safe = { ...backup, settings: BackupService.safeSettings(backup.settings) };
    await db.restore(safe, { pending_restore: safe });
    await this.resume();
  }
  static async resume() {
    const db = await getDatabase(), scope = getSessionScope();
    const backup: BackupData | undefined = await db.readMeta('pending_restore');
    if (!backup) return;
    const check = () => { if (getSessionScope() !== scope) throw new Error('Session changed during restore'); };
    if (backup.categories) {
      const categories = await StorageService.loadCategories(); check();
      await StorageService.saveCategories(merge(categories, backup.categories));
    }
    if (backup.recurringTransactions) {
      const raw = Platform.OS === 'web' ? sessionLocalStorage.getItem('recurring_transactions') : await Storage.getItem('@hisabtrack_recurring_transactions'); check();
      const value = JSON.stringify(merge(raw ? JSON.parse(raw) : [], backup.recurringTransactions));
      if (Platform.OS === 'web') sessionLocalStorage.setItem('recurring_transactions', value);
      else await Storage.setItem('@hisabtrack_recurring_transactions', value);
    }
    if (backup.goals) {
      const raw = await Storage.getItem('financial_goals'); check();
      await Storage.setItem('financial_goals', JSON.stringify(merge(raw ? JSON.parse(raw) : [], backup.goals)));
    }
    if (backup.smsLearningRules) {
      const rules = await SMSLearningService.getAllRules(); check();
      await SMSLearningService.saveAllRules({ ...rules, ...backup.smsLearningRules });
    }
    if (backup.settings) {
      const current = await loadStoredAppSettings(); check();
      const settings = { ...current, ...BackupService.safeSettings(backup.settings) };
      if (Platform.OS === 'web') sessionLocalStorage.setItem('app_settings', JSON.stringify(settings));
      else {
        const user = await SecureStorageService.getUserData(); check();
        await SecureStorageService.saveUserData({ ...user, appSettings: settings });
      }
    }
    check(); await db.writeMeta('pending_restore', null);
  }
}
