import LocalChangeEmitter from '@/services/LocalChangeEmitter';
import { Account, Budget, IDatabase, Loan, Transaction } from '@/types/database';
import { normalizeTransactionTags } from '@/utils/tags';
import { generateUUID } from '@/utils/uuid';
import { DBSchema, IDBPDatabase, openDB } from 'idb';

interface FinanceDB extends DBSchema {
  accounts: {
    key: string;
    value: Account;
  };
  transactions: {
    key: string;
    value: Transaction;
    indexes: { 'by-account': string; 'by-date': number };
  };
  budgets: {
    key: string;
    value: Budget;
  };
  loans: {
    key: string;
    value: Loan;
  };
}

export class WebDatabase implements IDatabase {
  private dbPromise: Promise<IDBPDatabase<FinanceDB>> | null = null;

  async init(): Promise<void> {
    this.dbPromise = openDB<FinanceDB>('finance-db', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('accounts')) {
          db.createObjectStore('accounts', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('transactions')) {
          const store = db.createObjectStore('transactions', { keyPath: 'id' });
          store.createIndex('by-account', 'account_id');
          store.createIndex('by-date', 'date');
        }
        if (!db.objectStoreNames.contains('budgets')) {
          db.createObjectStore('budgets', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('loans')) {
          db.createObjectStore('loans', { keyPath: 'id' });
        }
      },
    });
    await this.dbPromise;
  }

  private async getDB() {
    if (!this.dbPromise) {
      await this.init();
    }
    return this.dbPromise!;
  }

  private buildStoredTransaction(transaction: Omit<Transaction, 'id'>): Transaction {
    const common = {
      id: generateUUID(),
      account_id: transaction.account_id,
      amount: transaction.amount,
      category: transaction.category,
      date: transaction.date,
      description: transaction.description,
      sender_receiver: transaction.sender_receiver,
      reference_number: transaction.reference_number,
      sms_id: transaction.sms_id,
      fees: transaction.fees,
      tax: transaction.tax,
      tags: normalizeTransactionTags(transaction.tags),
      updated_at: Date.now(),
    };

    if (transaction.type === 'TRANSFER') {
      if (!transaction.to_account_id) {
        throw new Error('Transfer transaction requires destination account');
      }
      return { ...common, type: 'TRANSFER', to_account_id: transaction.to_account_id };
    }
    return { ...common, type: transaction.type, to_account_id: transaction.to_account_id };
  }

  private mergeStoredTransaction(existing: Transaction, updates: Partial<Omit<Transaction, 'id'>>): Transaction {
    const nextType = updates.type ?? existing.type;
    const common = {
      id: existing.id,
      account_id: updates.account_id ?? existing.account_id,
      amount: updates.amount ?? existing.amount,
      category: updates.category ?? existing.category,
      date: updates.date ?? existing.date,
      description: updates.description ?? existing.description,
      sender_receiver: updates.sender_receiver ?? existing.sender_receiver,
      reference_number: updates.reference_number ?? existing.reference_number,
      sms_id: updates.sms_id ?? existing.sms_id,
      fees: updates.fees ?? existing.fees,
      tax: updates.tax ?? existing.tax,
      tags: updates.tags !== undefined ? normalizeTransactionTags(updates.tags) : existing.tags,
      updated_at: Date.now(),
    };

    if (nextType === 'TRANSFER') {
      const toAccountId = updates.to_account_id ?? existing.to_account_id;
      if (!toAccountId) throw new Error('Transfer transaction requires destination account');
      return { ...common, type: 'TRANSFER', to_account_id: toAccountId };
    }
    return { ...common, type: nextType, to_account_id: updates.to_account_id };
  }

  /**
   * Returns the signed balance contribution of a transaction for a given account.
   * Positive = account balance increases, Negative = decreases.
   */
  private balanceDelta(transaction: Partial<Transaction>, accountId: string): number {
    if (!transaction.amount) return 0;
    const isSource = transaction.account_id === accountId;
    const isDest = transaction.to_account_id === accountId;
    if (transaction.type === 'INCOME' && isSource) return transaction.amount;
    if (transaction.type === 'EXPENSE' && isSource) return -transaction.amount;
    if (transaction.type === 'TRANSFER') {
      if (isSource) return -transaction.amount;
      if (isDest) return transaction.amount;
    }
    return 0;
  }

  /**
   * Incremental balance update — O(accounts affected) instead of O(all transactions).
   * oldTx: the version being replaced/deleted (undefined on create).
   * newTx: the version being added/replacing (undefined on delete).
   */
  private async applyBalanceDelta(
    db: IDBPDatabase<FinanceDB>,
    oldTx: Partial<Transaction> | undefined,
    newTx: Partial<Transaction> | undefined
  ): Promise<void> {
    const accountIds = new Set<string>();
    if (oldTx?.account_id) accountIds.add(oldTx.account_id);
    if (oldTx?.to_account_id) accountIds.add(oldTx.to_account_id);
    if (newTx?.account_id) accountIds.add(newTx.account_id);
    if (newTx?.to_account_id) accountIds.add(newTx.to_account_id);

    for (const accountId of accountIds) {
      const account = await db.get('accounts', accountId);
      if (!account) continue;
      const reverseDelta = oldTx ? -this.balanceDelta(oldTx, accountId) : 0;
      const forwardDelta = newTx ? this.balanceDelta(newTx, accountId) : 0;
      const totalDelta = reverseDelta + forwardDelta;
      if (totalDelta === 0) continue;
      account.balance = (account.balance ?? 0) + totalDelta;
      account.updated_at = Date.now();
      await db.put('accounts', account);
    }
  }

  /**
   * Full recalculation — kept for the public recalculateAccountBalance() repair action.
   * No longer called automatically on every write.
   */
  private async recalculateAccountBalanceInternal(db: IDBPDatabase<FinanceDB>, accountId: string): Promise<void> {
    const account = await db.get('accounts', accountId);
    if (!account) return;
    const transactions = await db.getAll('transactions');
    let balance = 0;
    for (const t of transactions) {
      if (t.account_id === accountId) {
        balance += t.type === 'INCOME' ? t.amount : -t.amount;
      }
      if (t.type === 'TRANSFER' && t.to_account_id === accountId) {
        balance += t.amount;
      }
    }
    account.balance = balance;
    account.updated_at = Date.now();
    await db.put('accounts', account);
  }

  // Accounts
  async createAccount(account: Omit<Account, 'id' | 'created_at'>): Promise<Account> {
    const db = await this.getDB();
    const newAccount: Account = {
      ...account,
      id: generateUUID(),
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    await db.put('accounts', newAccount);
    LocalChangeEmitter.emit();
    return newAccount;
  }

  async getAccounts(): Promise<Account[]> {
    const db = await this.getDB();
    return db.getAll('accounts');
  }

  async updateAccount(account: Account): Promise<void> {
    const db = await this.getDB();
    const updated = { ...account, updated_at: Date.now() };
    await db.put('accounts', updated);
    LocalChangeEmitter.emit();
  }

  async deleteAccount(id: string): Promise<void> {
    const db = await this.getDB();
    await db.delete('accounts', id);
    LocalChangeEmitter.emit();
  }

  // Transactions
  async createTransaction(transaction: Omit<Transaction, 'id'>): Promise<Transaction> {
    const db = await this.getDB();
    const newTransaction = this.buildStoredTransaction(transaction);
    await db.put('transactions', newTransaction);
    await this.applyBalanceDelta(db, undefined, newTransaction);
    LocalChangeEmitter.emit();
    return newTransaction;
  }

  /**
   * Fix #5: use the 'by-account' index when an account_id filter is set,
   * then apply date range filters in JS only on the smaller result set.
   */
  async getTransactions(filters?: { account_id?: string; startDate?: number; endDate?: number }): Promise<Transaction[]> {
    const db = await this.getDB();
    let transactions: Transaction[];

    if (filters?.account_id) {
      // Use the index for the primary account_id lookup
      const byAccount = await db.getAllFromIndex('transactions', 'by-account', filters.account_id);
      // TRANSFER destinations are not covered by the by-account index — add them
      const all = await db.getAll('transactions');
      const seenIds = new Set(byAccount.map(t => t.id));
      const transferDests = all.filter(
        t => t.type === 'TRANSFER' && t.to_account_id === filters.account_id && !seenIds.has(t.id)
      );
      transactions = [...byAccount, ...transferDests];
    } else {
      transactions = await db.getAll('transactions');
    }

    if (filters?.startDate) transactions = transactions.filter(t => t.date >= filters.startDate!);
    if (filters?.endDate)   transactions = transactions.filter(t => t.date <= filters.endDate!);

    return transactions.sort((a, b) => b.date - a.date);
  }

  async updateTransaction(id: string, updates: Partial<Omit<Transaction, 'id'>>): Promise<Transaction> {
    const db = await this.getDB();
    const existing = await db.get('transactions', id);
    if (!existing) throw new Error('Transaction not found');

    const updated = this.mergeStoredTransaction(existing, updates);
    await db.put('transactions', updated);
    await this.applyBalanceDelta(db, existing, updated);
    LocalChangeEmitter.emit();
    return updated;
  }

  async deleteTransaction(id: string, silent?: boolean): Promise<void> {
    const db = await this.getDB();
    const transaction = await db.get('transactions', id);
    if (transaction) {
      await db.delete('transactions', id);
      if (!silent) {
        await this.applyBalanceDelta(db, transaction, undefined);
      }
      LocalChangeEmitter.emit();
    }
  }

  /** Full recalculation — for manual "repair balance" actions only. */
  async recalculateAccountBalance(accountId: string): Promise<void> {
    const db = await this.getDB();
    await this.recalculateAccountBalanceInternal(db, accountId);
    LocalChangeEmitter.emit();
  }

  async removeDuplicateTransactions(accountId: string): Promise<number> {
    const db = await this.getDB();
    // Fetch transactions for this account (source) plus transfer destinations
    const byAccount = await db.getAllFromIndex('transactions', 'by-account', accountId);
    const all = await db.getAll('transactions');
    const seenIds = new Set(byAccount.map(t => t.id));
    const transferDests = all.filter(t => t.type === 'TRANSFER' && t.to_account_id === accountId && !seenIds.has(t.id));
    const transactions = [...byAccount, ...transferDests];

    const seen = new Set<string>();
    const duplicates = new Set<string>();

    for (const t of transactions) {
      const minuteBucket = Math.floor(t.date / 60_000);
      const sig = `${t.account_id}|${t.type}|${t.amount}|${t.category}|${t.description ?? ''}|${minuteBucket}`;
      if (seen.has(sig)) {
        duplicates.add(t.id);
      } else {
        seen.add(sig);
      }
    }

    if (duplicates.size > 0) {
      const duplicateTransactions = transactions.filter(t => duplicates.has(t.id));
      const tx = db.transaction('transactions', 'readwrite');
      await Promise.all([...duplicates].map(id => tx.store.delete(id)));
      await tx.done;
      // Recalculate balances for all affected accounts
      const affectedAccounts = new Set<string>();
      for (const t of duplicateTransactions) {
        affectedAccounts.add(t.account_id);
        if (t.to_account_id) affectedAccounts.add(t.to_account_id);
      }
      for (const aid of affectedAccounts) {
        await this.recalculateAccountBalanceInternal(db, aid);
      }
      LocalChangeEmitter.emit();
    }

    return duplicates.size;
  }

  // Budgets
  async createBudget(budget: Omit<Budget, 'id'>): Promise<Budget> {
    const db = await this.getDB();
    const newBudget: Budget = {
      ...budget,
      id: generateUUID(),
      updated_at: Date.now(),
    };
    await db.put('budgets', newBudget);
    LocalChangeEmitter.emit();
    return newBudget;
  }

  async getBudgets(): Promise<Budget[]> {
    const db = await this.getDB();
    return db.getAll('budgets');
  }

  async updateBudget(budget: Budget): Promise<void> {
    const db = await this.getDB();
    await db.put('budgets', budget);
    LocalChangeEmitter.emit();
  }

  async deleteBudget(id: string): Promise<void> {
    const db = await this.getDB();
    await db.delete('budgets', id);
  }

  // Loans
  async createLoan(loan: Omit<Loan, 'id'>): Promise<Loan> {
    const db = await this.getDB();
    const newLoan: Loan = {
      ...loan,
      id: generateUUID(),
      updated_at: Date.now(),
    };
    console.log('[WebDatabase] Creating loan:', newLoan);
    await db.put('loans', newLoan);
    LocalChangeEmitter.emit();
    console.log('[WebDatabase] Loan saved to IndexedDB');
    return newLoan;
  }

  async getLoans(): Promise<Loan[]> {
    const db = await this.getDB();
    return db.getAll('loans');
  }

  async updateLoan(loan: Loan): Promise<void> {
    const db = await this.getDB();
    await db.put('loans', loan);
    LocalChangeEmitter.emit();
  }

  async deleteLoan(id: string): Promise<void> {
    const db = await this.getDB();
    await db.delete('loans', id);
    LocalChangeEmitter.emit();
  }

  // Upsert helpers (IDB 'put' will insert or update by keyPath)
  async upsertAccount(account: Account): Promise<void> {
    const db = await this.getDB();
    await db.put('accounts', account);
  }

  async upsertTransaction(transaction: Transaction): Promise<void> {
    const db = await this.getDB();
    await db.put('transactions', transaction);
  }

  async upsertBudget(budget: Budget): Promise<void> {
    const db = await this.getDB();
    await db.put('budgets', budget);
  }

  async upsertLoan(loan: Loan): Promise<void> {
    const db = await this.getDB();
    await db.put('loans', loan);
  }

  async clearAllData(): Promise<void> {
    const db = await this.getDB();
    await db.clear('accounts');
    await db.clear('transactions');
    await db.clear('budgets');
    await db.clear('loans');
  }
}
