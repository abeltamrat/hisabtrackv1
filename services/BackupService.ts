import { Account, Budget, Loan, Transaction } from '@/types/database';
import { saveJSON } from '@/utils/fileHelper';
import * as FileSystem from 'expo-file-system';

export interface BackupData {
  version: string;
  timestamp: number;
  accounts: Account[];
  transactions: Transaction[];
  budgets: Budget[];
  loans: Loan[];
  categories?: any[];
  recurringTransactions?: any[];
  settings?: any;
  smsLearningRules?: any;
}

export class BackupService {
  private static BACKUP_VERSION = '1.0.0';

  /**
   * Create a complete backup of all data
   */
  static createBackup(
    accounts: Account[],
    transactions: Transaction[],
    budgets: Budget[],
    loans: Loan[],
    categories?: any[],
    recurringTransactions?: any[],
    settings?: any,
    smsLearningRules?: any
  ): BackupData {
    return {
      version: this.BACKUP_VERSION,
      timestamp: Date.now(),
      accounts,
      transactions,
      budgets,
      loans,
      categories,
      recurringTransactions,
      settings,
      smsLearningRules,
    };
  }

  /**
   * Export backup to JSON file
   */
  static async exportBackup(
    accounts: Account[],
    transactions: Transaction[],
    budgets: Budget[],
    loans: Loan[],
    filename: string = `hisabtrack_backup_${new Date().toISOString().split('T')[0]}.json`
  ): Promise<void> {
    // 1. Fetch categories
    let categories: any[] = [];
    try {
      const { StorageService } = await import('@/utils/storage');
      categories = await StorageService.loadCategories();
    } catch (e) {
      console.warn('[BackupService] Failed to fetch categories for backup:', e);
    }

    // 2. Fetch recurring transactions
    let recurringTransactions: any[] = [];
    try {
      const { Platform } = await import('react-native');
      const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
      if (Platform.OS === 'web') {
        const stored = localStorage.getItem('recurring_transactions');
        if (stored) recurringTransactions = JSON.parse(stored);
      } else {
        const stored = await AsyncStorage.getItem('@hisabtrack_recurring_transactions');
        if (stored) recurringTransactions = JSON.parse(stored);
      }
    } catch (e) {
      console.warn('[BackupService] Failed to fetch recurring transactions for backup:', e);
    }

    // 3. Fetch settings
    let settings: any = null;
    try {
      const { loadStoredAppSettings } = await import('@/contexts/AppSettingsContext');
      settings = await loadStoredAppSettings();
    } catch (e) {
      console.warn('[BackupService] Failed to fetch settings for backup:', e);
    }

    // 4. Fetch SMS learning rules
    let smsLearningRules: any = null;
    try {
      const { SMSLearningService } = await import('@/services/SMSLearningService');
      smsLearningRules = await SMSLearningService.getAllRules();
    } catch (e) {
      console.warn('[BackupService] Failed to fetch SMS learning rules for backup:', e);
    }

    const backup = this.createBackup(
      accounts,
      transactions,
      budgets,
      loans,
      categories,
      recurringTransactions,
      settings,
      smsLearningRules
    );
    const json = JSON.stringify(backup, null, 2);
    await saveJSON(filename, json);
  }

  /**
   * Validate backup data structure
   */
  static validateBackup(data: any): data is BackupData {
    if (!data || typeof data !== 'object') {
      return false;
    }

    // Check required fields
    if (!data.version || !data.timestamp) {
      return false;
    }

    // Check arrays
    if (!Array.isArray(data.accounts) || 
        !Array.isArray(data.transactions) || 
        !Array.isArray(data.budgets) || 
        !Array.isArray(data.loans)) {
      return false;
    }

    return true;
  }

  /**
   * Parse backup from JSON string
   */
  static parseBackup(jsonString: string): BackupData | null {
    try {
      const data = JSON.parse(jsonString);
      
      if (!this.validateBackup(data)) {
        throw new Error('Invalid backup format');
      }

      return data;
    } catch (error) {
      console.error('Failed to parse backup:', error);
      return null;
    }
  }

  /**
   * Read backup from file (Web)
   */
  static async readBackupFile(file: File): Promise<BackupData | null> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      
      reader.onload = (e) => {
        const content = e.target?.result as string;
        const backup = this.parseBackup(content);
        resolve(backup);
      };
      
      reader.onerror = () => {
        console.error('Failed to read file');
        resolve(null);
      };
      
      reader.readAsText(file);
    });
  }

  /**
   * Read backup from URI (Native)
   */
  static async readBackupFileFromUri(uri: string): Promise<BackupData | null> {
    try {
      const content = await FileSystem.readAsStringAsync(uri);
      return this.parseBackup(content);
    } catch (error) {
      console.error('Failed to read backup file from URI:', error);
      return null;
    }
  }

  /**
   * Get backup statistics
   */
  static getBackupStats(backup: BackupData): {
    totalAccounts: number;
    totalTransactions: number;
    totalBudgets: number;
    totalLoans: number;
    totalCategories?: number;
    totalRecurringTransactions?: number;
    backupDate: string;
    version: string;
  } {
    return {
      totalAccounts: backup.accounts.length,
      totalTransactions: backup.transactions.length,
      totalBudgets: backup.budgets.length,
      totalLoans: backup.loans.length,
      totalCategories: backup.categories?.length,
      totalRecurringTransactions: backup.recurringTransactions?.length,
      backupDate: new Date(backup.timestamp).toLocaleString(),
      version: backup.version,
    };
  }

  /**
   * Merge backup data with existing data
   * Returns arrays with duplicates removed (by ID)
   */
  static mergeBackupData(
    existingData: BackupData,
    newBackup: BackupData
  ): BackupData {
    const mergeById = <T extends { id: string }>(existing: T[], incoming: T[]): T[] => {
      const map = new Map<string, T>();
      
      // Add existing items
      existing.forEach(item => map.set(item.id, item));
      
      // Add/overwrite with incoming items
      incoming.forEach(item => map.set(item.id, item));
      
      return Array.from(map.values());
    };

    return {
      version: this.BACKUP_VERSION,
      timestamp: Date.now(),
      accounts: mergeById(existingData.accounts, newBackup.accounts),
      transactions: mergeById(existingData.transactions, newBackup.transactions),
      budgets: mergeById(existingData.budgets, newBackup.budgets),
      loans: mergeById(existingData.loans, newBackup.loans),
      categories: newBackup.categories || existingData.categories,
      recurringTransactions: newBackup.recurringTransactions || existingData.recurringTransactions,
      settings: newBackup.settings || existingData.settings,
      smsLearningRules: newBackup.smsLearningRules || existingData.smsLearningRules,
    };
  }

  /**
   * Create a quick summary of backup
   */
  static createBackupSummary(backup: BackupData): string {
    const stats = this.getBackupStats(backup);
    let summary = `
Backup Summary
--------------
Version: ${stats.version}
Date: ${stats.backupDate}

Data:
- Accounts: ${stats.totalAccounts}
- Transactions: ${stats.totalTransactions}
- Budgets: ${stats.totalBudgets}
- Loans: ${stats.totalLoans}`;

    if (stats.totalCategories !== undefined) {
      summary += `\n- Categories: ${stats.totalCategories}`;
    }
    if (stats.totalRecurringTransactions !== undefined) {
      summary += `\n- Recurring Rules: ${stats.totalRecurringTransactions}`;
    }
    if (backup.settings) {
      summary += `\n- App Settings: Yes`;
    }
    if (backup.smsLearningRules) {
      summary += `\n- SMS Learning Rules: ${Object.keys(backup.smsLearningRules).length}`;
    }

    const totalRecords = stats.totalAccounts + stats.totalTransactions + stats.totalBudgets + stats.totalLoans +
      (stats.totalCategories || 0) + (stats.totalRecurringTransactions || 0);

    summary += `\n\nTotal Records: ${totalRecords}`;
    return summary.trim();
  }
}
