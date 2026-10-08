import AsyncStorage, { getSessionScope } from '@/services/SessionStorage';
import { createSerialQueue } from '@/utils/asyncLock';

export type DraftStatus = 'PENDING' | 'RECORDED' | 'REJECTED';

export interface DraftTransaction {
  id: string;
  account_id: string;
  type: 'INCOME' | 'EXPENSE';
  amount: number;
  gross_amount?: number;
  category: string;
  description: string;
  date: number; // Transaction date from SMS
  sms_id: string;
  sender_receiver?: string;
  sms_sender?: string;
  reference_number?: string;
  fees?: number;
  tax?: number;
  service_charge?: number;
  vat?: number;
  disaster_recovery_fee?: number;
  suggested_balance?: number;
  raw_sms: string;
  receipt_url?: string;
  status: DraftStatus;
  is_recorded: boolean;
  created_at: number;
  matched_transaction_id?: string;
  categoryHint?: string;
  is_transfer?: boolean;
  transfer_to_account_id?: string;
  transfer_from_account_id?: string;
  transfer_peer_account_number?: string;
  suggested_splits?: Array<{ id: string; category: string; amount: number; description?: string; tags?: string[] }>;
  is_loan_disbursement?: boolean;
  /** Id of the opposite-leg draft when this is one side of a paired self-transfer. */
  paired_draft_id?: string;
  confirmation?: {
    recorded_at: number;
    type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
    category: string;
    description: string;
    recipient?: string;
    source_account_id: string;
    destination_account_id?: string;
    counterpart_draft_id?: string;
  };
}

export interface SMSReconciliationResult {
  totalSMS: number;
  parsedTransactions: number;
  matchedAccounts: number;
  newDrafts: number;
  alreadyRecorded: number;
  drafts: DraftTransaction[];
  failed?: boolean;
}

export class DraftTransactionService {
  private static STORAGE_KEY = 'draft_transactions';
  private static cache: DraftTransaction[] | null = null;

  // All mutations are read-modify-write cycles on one AsyncStorage key;
  // serialize them so concurrent writers can't drop each other's changes.
  private static mutationQueue = createSerialQueue();
  private static mutationScope: string | null = null;
  private static cacheScope: string | null = null;
  private static mutate<T>(fn: () => Promise<T>): Promise<T> {
    const scope = getSessionScope();
    return this.mutationQueue(async () => {
      if (getSessionScope() !== scope) throw new Error('Session changed');
      this.mutationScope = scope;
      try { return await fn(); } finally { this.mutationScope = null; }
    });
  }
  static settle() { return this.mutationQueue(async () => undefined); }

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
    const scope = getSessionScope();
    try {
      if (this.cache !== null && this.cacheScope === scope) {
        return [...this.cache];
      }
      const stored = await AsyncStorage.getItem(this.STORAGE_KEY);
      const parsed: DraftTransaction[] = stored ? JSON.parse(stored) : [];
      if (getSessionScope() !== scope) throw new Error('Session changed');
      this.cacheScope = scope;
      this.cache = parsed;
      return [...parsed];
    } catch (error) {
      console.error('Error loading draft transactions:', error);
      throw error;
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
  static add(draft: Omit<DraftTransaction, 'id' | 'created_at'>): Promise<DraftTransaction> {
    return this.mutate(async () => {
      const all = await this.getAll();
      const newDraft: DraftTransaction = {
        ...draft,
        id: this.generateId(),
        created_at: Date.now(),
      };
      all.push(newDraft);
      await this.saveAll(all);
      return newDraft;
    });
  }

  /**
   * Add multiple draft transactions in a single batch operation
   */
  static async addMany(drafts: Omit<DraftTransaction, 'id' | 'created_at'>[]): Promise<DraftTransaction[]> {
    if (drafts.length === 0) return [];

    return this.mutate(async () => {
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
    });
  }

  /**
   * Mark draft as recorded
   */
  static markAsRecorded(draftId: string, transactionId: string, confirmation?: DraftTransaction['confirmation']): Promise<void> {
    return this.mutate(async () => {
      const all = await this.getAll();
      const draft = all.find(d => d.id === draftId);
      if (draft) {
        draft.status = 'RECORDED';
        draft.is_recorded = true;
        draft.matched_transaction_id = transactionId;
        if (confirmation) draft.confirmation = confirmation;
        await this.saveAll(all);
      }
    });
  }

  /** Reopen drafts only when they still point at the transaction being undone. */
  static reopenRecorded(draftIds: string[], transactionId: string): Promise<void> {
    return this.mutate(async () => {
      const all = await this.getAll();
      let changed = false;
      for (const draft of all) {
        if (draftIds.includes(draft.id) && draft.matched_transaction_id === transactionId) {
          draft.status = 'PENDING';
          draft.is_recorded = false;
          delete draft.matched_transaction_id;
          delete draft.confirmation;
          changed = true;
        }
      }
      if (changed) await this.saveAll(all);
    });
  }

  /**
   * Apply several partial updates in one atomic read-modify-write cycle.
   */
  static updateMany(patches: Array<{ id: string; patch: Partial<DraftTransaction> }>): Promise<void> {
    if (patches.length === 0) return Promise.resolve();
    return this.mutate(async () => {
      const all = await this.getAll();
      let changed = false;
      for (const { id, patch } of patches) {
        const index = all.findIndex(d => d.id === id);
        if (index >= 0) {
          all[index] = { ...all[index], ...patch };
          changed = true;
        }
      }
      if (changed) await this.saveAll(all);
    });
  }

  /**
   * Update draft status (e.g. REJECTED)
   */
  static updateStatus(draftId: string, status: DraftStatus): Promise<void> {
    return this.mutate(async () => {
      const all = await this.getAll();
      const draft = all.find(d => d.id === draftId);
      if (draft) {
        draft.status = status;
        if (status === 'RECORDED') draft.is_recorded = true;
        await this.saveAll(all);
      }
    });
  }

  /**
   * Delete a draft transaction
   */
  static delete(draftId: string): Promise<void> {
    return this.mutate(async () => {
      const all = await this.getAll();
      const filtered = all.filter(d => d.id !== draftId);
      await this.saveAll(filtered);
    });
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
    const scope = getSessionScope();
    if (this.mutationScope && this.mutationScope !== scope) throw new Error('Session changed');
    await AsyncStorage.setItem(this.STORAGE_KEY, JSON.stringify(drafts));
    if (getSessionScope() === scope) { this.cacheScope = scope; this.cache = drafts; }
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
  static clearOldRecorded(daysOld: number = 30): Promise<number> {
    return this.mutate(async () => {
      const all = await this.getAll();
      const cutoffTime = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
      const filtered = all.filter(draft =>
        !draft.is_recorded || draft.created_at > cutoffTime
      );
      const removedCount = all.length - filtered.length;
      await this.saveAll(filtered);
      return removedCount;
    });
  }

  /**
   * Clear all draft transactions
   */
  static clearAll(): Promise<void> {
    return this.mutate(async () => {
      this.cache = null;
      await AsyncStorage.removeItem(this.STORAGE_KEY);
    });
  }
}
