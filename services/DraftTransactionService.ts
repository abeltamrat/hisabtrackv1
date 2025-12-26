
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface DraftTransaction {
  id: string;
  account_id: string;
  type: 'INCOME' | 'EXPENSE';
  amount: number;
  category: string;
  description: string;
  date: number;
  sms_id: string;
  sender_receiver?: string;
  reference_number?: string;
  fees?: number;
  tax?: number;
  suggested_balance?: number;
  raw_sms: string;
  is_recorded: boolean;
  created_at: number;
  matched_transaction_id?: string; // If matched with existing transaction
}

export interface SMSReconciliationResult {
  totalSMS: number;
  parsedTransactions: number;
  matchedAccounts: number;
  newDrafts: number;
  alreadyRecorded: number;
  drafts: DraftTransaction[];
}

export class DraftTransactionService {
  private static STORAGE_KEY = 'draft_transactions';

  /**
   * Get all draft transactions
   */
  static async getAll(): Promise<DraftTransaction[]> {
    try {
      const stored = await AsyncStorage.getItem(this.STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('Error loading draft transactions:', error);
      return [];
    }
  }

  /**
   * Get draft transactions for a specific account
   */
  static async getByAccount(accountId: string): Promise<DraftTransaction[]> {
    const all = await this.getAll();
    return all.filter(draft => draft.account_id === accountId);
  }

  /**
   * Get unrecorded draft transactions for an account
   */
  static async getUnrecordedByAccount(accountId: string): Promise<DraftTransaction[]> {
    const all = await this.getAll();
    return all.filter(draft => draft.account_id === accountId && !draft.is_recorded);
  }

  /**
   * Add a new draft transaction
   */
  static async add(draft: Omit<DraftTransaction, 'id' | 'created_at'>): Promise<DraftTransaction> {
    const all = await this.getAll();
    const newDraft: DraftTransaction = {
      ...draft,
      id: this.generateId(),
      created_at: Date.now(),
    };
    all.push(newDraft);
    await this.saveAll(all);
    return newDraft;
  }

  /**
   * Mark draft as recorded
   */
  static async markAsRecorded(draftId: string, transactionId: string): Promise<void> {
    const all = await this.getAll();
    const draft = all.find(d => d.id === draftId);
    if (draft) {
      draft.is_recorded = true;
      draft.matched_transaction_id = transactionId;
      await this.saveAll(all);
    }
  }

  /**
   * Delete a draft transaction
   */
  static async delete(draftId: string): Promise<void> {
    const all = await this.getAll();
    const filtered = all.filter(d => d.id !== draftId);
    await this.saveAll(filtered);
  }

  /**
   * Check if SMS transaction already exists as draft
   */
  static async isDuplicate(smsId: string): Promise<boolean> {
    const all = await this.getAll();
    return all.some(draft => draft.sms_id === smsId);
  }

  /**
   * Save all drafts to storage
   */
  private static async saveAll(drafts: DraftTransaction[]): Promise<void> {
    try {
      await AsyncStorage.setItem(this.STORAGE_KEY, JSON.stringify(drafts));
    } catch (error) {
      console.error('Error saving draft transactions:', error);
    }
  }

  /**
   * Generate unique ID
   */
  private static generateId(): string {
    return `draft_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get count of unrecorded drafts by account
   */
  static async getUnrecordedCount(accountId: string): Promise<number> {
    const unrecorded = await this.getUnrecordedByAccount(accountId);
    return unrecorded.length;
  }

  /**
   * Clear all recorded drafts older than specified days
   */
  static async clearOldRecorded(daysOld: number = 30): Promise<number> {
    const all = await this.getAll();
    const cutoffTime = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
    const filtered = all.filter(draft => 
      !draft.is_recorded || draft.created_at > cutoffTime
    );
    const removedCount = all.length - filtered.length;
    await this.saveAll(filtered);
    return removedCount;
  }
}
