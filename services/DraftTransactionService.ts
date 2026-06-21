import AsyncStorage from '@react-native-async-storage/async-storage';

export type DraftStatus = 'PENDING' | 'RECORDED' | 'REJECTED';

export interface DraftTransaction {
  id: string;
  account_id: string;
  type: 'INCOME' | 'EXPENSE';
  amount: number;
  category: string;
  description: string;
  date: number; // Transaction date from SMS
  sms_id: string;
  sender_receiver?: string;
  sms_sender?: string;
  reference_number?: string;
  fees?: number;
  tax?: number;
  suggested_balance?: number;
  raw_sms: string;
  status: DraftStatus;
  is_recorded: boolean; // Keep for backward compatibility or refactor
  created_at: number; // Sync date
  matched_transaction_id?: string;
  categoryHint?: string;
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
  private static cache: DraftTransaction[] | null = null;

  /**
   * Clear the in-memory cache
   */
  static invalidateCache(): void {
    this.cache = null;
  }

  /**
   * Get all draft transactions (utilizes in-memory cache)
   */
  static async getAll(): Promise<DraftTransaction[]> {
    try {
      if (this.cache !== null) {
        return [...this.cache];
      }
      const stored = await AsyncStorage.getItem(this.STORAGE_KEY);
      const parsed: DraftTransaction[] = stored ? JSON.parse(stored) : [];
      this.cache = parsed;
      return [...parsed];
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
   * Get draft transactions by status
   */
  static async getByStatus(accountId: string, status: DraftStatus): Promise<DraftTransaction[]> {
    const all = await this.getAll();
    return all.filter(draft => draft.account_id === accountId && draft.status === status);
  }

  /**
   * Get unrecorded draft transactions for an account
   */
  static async getUnrecordedByAccount(accountId: string): Promise<DraftTransaction[]> {
    const all = await this.getAll();
    return all.filter(draft => draft.account_id === accountId && draft.status === 'PENDING');
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
   * Add multiple draft transactions in a single batch operation
   */
  static async addMany(drafts: Omit<DraftTransaction, 'id' | 'created_at'>[]): Promise<DraftTransaction[]> {
    if (drafts.length === 0) return [];
    
    const all = await this.getAll();
    const timestamp = Date.now();
    const newDrafts: DraftTransaction[] = drafts.map((draft, index) => ({
      ...draft,
      id: `${this.generateId()}_${index}`,
      created_at: timestamp,
    }));
    
    all.push(...newDrafts);
    await this.saveAll(all);
    return newDrafts;
  }

  /**
   * Mark draft as recorded
   */
  static async markAsRecorded(draftId: string, transactionId: string): Promise<void> {
    const all = await this.getAll();
    const draft = all.find(d => d.id === draftId);
    if (draft) {
      draft.status = 'RECORDED';
      draft.is_recorded = true;
      draft.matched_transaction_id = transactionId;
      await this.saveAll(all);
    }
  }

  /**
   * Update draft status (e.g. REJECTED)
   */
  static async updateStatus(draftId: string, status: DraftStatus): Promise<void> {
    const all = await this.getAll();
    const draft = all.find(d => d.id === draftId);
    if (draft) {
      draft.status = status;
      if (status === 'RECORDED') draft.is_recorded = true;
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
   * Save all drafts to storage and update cache
   */
  private static async saveAll(drafts: DraftTransaction[]): Promise<void> {
    try {
      this.cache = drafts;
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
   * Get count of unrecorded drafts for all accounts in a single pass
   */
  static async getUnrecordedCounts(): Promise<Record<string, number>> {
    const all = await this.getAll();
    const counts: Record<string, number> = {};
    all.forEach(draft => {
      if (draft.status === 'PENDING') {
        counts[draft.account_id] = (counts[draft.account_id] || 0) + 1;
      }
    });
    return counts;
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

  /**
   * Clear all draft transactions
   */
  static async clearAll(): Promise<void> {
    this.cache = null;
    await AsyncStorage.removeItem(this.STORAGE_KEY);
  }
}
