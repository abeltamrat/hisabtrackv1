import { validateTransaction, money } from '@/utils/finance';
import { sessionLocalStorage } from '@/services/SessionStorage';
import { Account, Budget, Loan, Transaction } from '@/types/database';
import { saveJSON } from '@/utils/fileHelper';
import * as FileSystem from 'expo-file-system/legacy';
import type { CommunityGroup } from '@/types/community';
import { validateCommunityGroupRecord } from '@/utils/communityFinance';

export interface BackupData {
  version: string;
  timestamp: number;
  accounts: Account[];
  transactions: Transaction[];
  budgets: Budget[];
  loans: Loan[];
  categories?: any[];
  goals?: any[];
  recurringTransactions?: any[];
  settings?: any;
  smsLearningRules?: any;
  recipientProfiles?: any[];
  communityGroups?: CommunityGroup[];
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
    smsLearningRules?: any,
    recipientProfiles?: any[],
    communityGroups?: CommunityGroup[]
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
      settings: this.safeSettings(settings),
      smsLearningRules,
      recipientProfiles,
      communityGroups,
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
      const AsyncStorage = (await import('@/services/SessionStorage')).default;
      if (Platform.OS === 'web') {
        const stored = sessionLocalStorage.getItem('recurring_transactions');
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

    let recipientProfiles: any[] = [];
    try {
      recipientProfiles = await (await import('@/services/RecipientIdentityService')).default.getAll();
    } catch (e) {
      console.warn('[BackupService] Failed to fetch recipient profiles for backup:', e);
    }

    let communityGroups: CommunityGroup[] = [];
    try { communityGroups = await (await import('@/services/CommunityGroupService')).CommunityGroupService.getAll(); }
    catch (e) { console.warn('[BackupService] Failed to fetch Equb/Iddir groups:', e); }

    const backup = this.createBackup(
      accounts,
      transactions,
      budgets,
      loans,
      categories,
      recurringTransactions,
      settings,
      smsLearningRules,
      recipientProfiles,
      communityGroups
    );
    const rawGoals = await (await import('./SessionStorage')).default.getItem('financial_goals');
    backup.goals = rawGoals ? JSON.parse(rawGoals) : [];
    const json = JSON.stringify(backup, null, 2);
    await saveJSON(filename, json);
  }

  /**
   * Validate backup data structure
   */
  static safeSettings(settings: any) {
    if (!settings || typeof settings !== 'object') return undefined;
    const allowed = ['currency', 'language', 'fontSize', 'preferLocalLogos', 'balancesHidden', 'calendarSystem', 'backgroundReminders', 'assistantOverlay'];
    const preferences = Object.fromEntries(allowed.filter(key => Object.prototype.hasOwnProperty.call(settings, key)).map(key => [key, settings[key]]));
    return { ...preferences, cloudSyncEnabled: false, aiSharingEnabled: false, puterJsEnabled: false };
  }
  static validateBackup(data: any): data is BackupData {
    try {
      if (!data || data.version !== '1.0.0' || !Number.isFinite(data.timestamp) || data.timestamp <= 0) return false;
      for (const key of ['accounts', 'transactions', 'budgets', 'loans']) {
        if (!Array.isArray(data[key]) || data[key].length > 100000) return false;
        const ids = new Set<string>();
        for (const row of data[key]) {
          if (!row || typeof row.id !== 'string' || !row.id || row.id.includes('/') || ids.has(row.id)) return false;
          ids.add(row.id);
        }
      }
      for (const a of data.accounts) {
        if (typeof a.name !== 'string' || !a.name.trim() || !/^[A-Z]{3}$/.test(a.currency) || !['BANK', 'MOBILE_MONEY', 'CASH', 'CARD', 'SAVINGS'].includes(a.type)) return false;
        if (a.aliases !== undefined && (!Array.isArray(a.aliases) || a.aliases.length > 50 || a.aliases.some((alias: unknown) => typeof alias !== 'string' || !alias.trim() || alias.length > 120))) return false;
        money(a.balance); if (money(a.locked_amount || 0) < 0 || money(a.reserve_amount || 0) < 0) return false;
      }
      if (new Set(data.accounts.map((a: Account) => a.currency)).size > 1) return false;
      for (const t of data.transactions) { validateTransaction(t, data.accounts); if (typeof t.category !== 'string' || typeof t.description !== 'string') return false; }
      for (const b of data.budgets) if (!['MONTHLY', 'WEEKLY'].includes(b.period) || (b.calendar_system !== undefined && !['GREGORIAN', 'ETHIOPIAN'].includes(b.calendar_system)) || typeof b.category !== 'string' || money(b.limit_amount) < 0 || !Number.isFinite(b.start_date) || !Number.isFinite(b.end_date) || b.end_date < b.start_date) return false;
      for (const l of data.loans) if (!['BORROWED', 'LENT'].includes(l.type) || !['ACTIVE', 'PAID', 'DEFAULTED'].includes(l.status) || money(l.principal_amount) <= 0 || money(l.remaining_balance) < 0 || !Number.isFinite(l.interest_rate) || l.interest_rate < 0 || !Number.isFinite(l.start_date) || !Number.isFinite(l.due_date) || l.due_date < l.start_date) return false;
      for (const key of ['categories', 'recurringTransactions', 'goals', 'communityGroups']) {
        if (data[key] !== undefined && (!Array.isArray(data[key]) || data[key].length > 100000)) return false;
        const ids = new Set();
        for (const item of data[key] || []) {
          if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id)) return false;
          ids.add(item.id);
        }
      }
      if (data.recipientProfiles !== undefined && (!Array.isArray(data.recipientProfiles) || data.recipientProfiles.length > 10000)) return false;
      for (const profile of data.recipientProfiles || []) {
        if (!profile || typeof profile.id !== 'string' || typeof profile.displayName !== 'string' || !profile.displayName.trim()) return false;
        if (!Array.isArray(profile.aliases) || profile.aliases.length < 1 || profile.aliases.length > 100 || profile.aliases.some((alias: unknown) => typeof alias !== 'string' || !alias.trim() || alias.length > 160)) return false;
        if (!Array.isArray(profile.verifiedHints) || profile.verifiedHints.length > 100 || profile.verifiedHints.some((hint: unknown) => typeof hint !== 'string' || !/^(phone|account):[\d*]{4,20}$/.test(hint))) return false;
      }
      for (const category of data.categories || []) {
        if (typeof category.name !== 'string' || !category.name.trim()) return false;
        const seen = new Set(); let current = category;
        while (current) {
          if (seen.has(current.id)) return false;
          seen.add(current.id); current = data.categories.find((c: any) => c.id === current.parentId);
        }
      }
      for (const goal of data.goals || []) if (typeof goal.title !== 'string' || !goal.title.trim() || money(goal.targetAmount) <= 0 || money(goal.currentAmount) < 0 || !Number.isFinite(Date.parse(goal.deadline))) return false;
      for (const r of data.recurringTransactions || []) if (!['INCOME', 'EXPENSE', 'TRANSFER'].includes(r.type) || (r.calendar_system !== undefined && !['GREGORIAN', 'ETHIOPIAN'].includes(r.calendar_system)) || !Number.isFinite(r.startDate) || !Number.isInteger(r.completedRepetitions) || r.completedRepetitions < 0 || (r.endDate !== undefined && (!Number.isFinite(r.endDate) || r.endDate < r.startDate)) || (money(r.fees ?? 0) < 0 || money(r.tax ?? 0) < 0 || money((r.fees ?? 0) + (r.tax ?? 0)) > money(r.amount) || (r.type !== 'TRANSFER' && (money(r.fees ?? 0) || money(r.tax ?? 0)))) || (r.type === 'TRANSFER' && (r.accountId === r.toAccountId || !data.accounts.some((a: Account) => a.id === r.toAccountId))) || (r.splits && (r.type === 'TRANSFER' || r.splits.length < 2 || r.splits.some((split: any) => !split.category?.trim() || money(split.amount) <= 0 || (split.description !== undefined && typeof split.description !== 'string') || (split.tags !== undefined && (!Array.isArray(split.tags) || split.tags.length > 12 || split.tags.some((tag: unknown) => typeof tag !== 'string' || !tag.trim() || tag.length > 40)))) || money(r.splits.reduce((sum: number, split: any) => sum + split.amount, 0)) !== money(r.amount))) || !r.id || !['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(r.frequency) || money(r.amount) <= 0 || !Number.isFinite(r.nextDate) || !data.accounts.some((a: Account) => a.id === r.accountId)) return false;
      for (const group of data.communityGroups || []) {
        if (!validateCommunityGroupRecord(group) || !data.accounts.some((account: Account) => account.id === group.accountId)) return false;
      }
      return true;
    } catch { return false; }
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

      data.settings = this.safeSettings(data.settings);
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
      recipientProfiles: newBackup.recipientProfiles || existingData.recipientProfiles,
      communityGroups: mergeById(existingData.communityGroups || [], newBackup.communityGroups || []),
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
