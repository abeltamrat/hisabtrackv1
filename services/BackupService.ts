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
    loans: Loan[]
  ): BackupData {
    return {
      version: this.BACKUP_VERSION,
      timestamp: Date.now(),
      accounts,
      transactions,
      budgets,
      loans,
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
    const backup = this.createBackup(accounts, transactions, budgets, loans);
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
    backupDate: string;
    version: string;
  } {
    return {
      totalAccounts: backup.accounts.length,
      totalTransactions: backup.transactions.length,
      totalBudgets: backup.budgets.length,
      totalLoans: backup.loans.length,
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
    };
  }

  /**
   * Create a quick summary of backup
   */
  static createBackupSummary(backup: BackupData): string {
    const stats = this.getBackupStats(backup);
    return `
Backup Summary
--------------
Version: ${stats.version}
Date: ${stats.backupDate}

Data:
- Accounts: ${stats.totalAccounts}
- Transactions: ${stats.totalTransactions}
- Budgets: ${stats.totalBudgets}
- Loans: ${stats.totalLoans}

Total Records: ${stats.totalAccounts + stats.totalTransactions + stats.totalBudgets + stats.totalLoans}
    `.trim();
  }
}
