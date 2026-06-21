import LocalChangeEmitter from '@/services/LocalChangeEmitter';
import NativeErrorReporter from '@/services/NativeErrorReporter';
import { Account, Budget, IDatabase, Loan, Transaction } from '@/types/database';
import { normalizeTransactionTags } from '@/utils/tags';
import { generateUUID } from '@/utils/uuid';
import * as SQLite from 'expo-sqlite';

/**
 * Android Database implementation using expo-sqlite.
 *
 * Key design decisions vs. original:
 * 1. INCREMENTAL balance updates  — no full O(N) scan on every write.
 *    balance is adjusted by a delta computed from the old vs. new transaction.
 * 2. SQL-level filtering          — getTransactions() pushes date/account filters
 *    into a WHERE clause so only matching rows are loaded from disk.
 * 3. removeDuplicateTransactions  — properly implemented (was a stub returning 0).
 */
export class AndroidDatabase implements IDatabase {
  private db: SQLite.SQLiteDatabase | null = null;
  private initialized = false;
  // Mutex: if init is already in progress, all concurrent callers wait for the same promise
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.initialized && this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._doInit().finally(() => {
      this.initPromise = null;
    });
    return this.initPromise;
  }

  private async _doInit(): Promise<void> {
    this.initialized = false;
    this.db = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      let dbHandle: SQLite.SQLiteDatabase | null = null;
      try {
        dbHandle = await SQLite.openDatabaseAsync('hisabtrack.db');

        // Create tables individually — execAsync with multiple semicolon-separated
        // statements causes NullPointerException on Android New Architecture (Fabric/JSI).
        await dbHandle.runAsync('CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
        // transactions v2 schema with dedicated filter columns (DEFAULT values allow migration to populate them)
        await dbHandle.runAsync('CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, account_id TEXT NOT NULL DEFAULT "", to_account_id TEXT, type TEXT NOT NULL DEFAULT "EXPENSE", amount REAL NOT NULL DEFAULT 0, date INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL DEFAULT "{}")');
        await dbHandle.runAsync('CREATE TABLE IF NOT EXISTS budgets (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
        await dbHandle.runAsync('CREATE TABLE IF NOT EXISTS loans (id TEXT PRIMARY KEY, data TEXT NOT NULL)');

        // Schema migration: older installs have transactions(id, data) only — no filter columns.
        // Detect by checking PRAGMA table_info; if account_id is missing, recreate and backfill.
        const txCols = await dbHandle.getAllAsync<{ name: string }>('PRAGMA table_info(transactions)');
        if (!txCols.some(c => c.name === 'account_id')) {
          console.log('AndroidDatabase: migrating transactions table to columnar schema');
          await dbHandle.runAsync('ALTER TABLE transactions RENAME TO _transactions_v1');
          await dbHandle.runAsync('CREATE TABLE transactions (id TEXT PRIMARY KEY, account_id TEXT NOT NULL DEFAULT "", to_account_id TEXT, type TEXT NOT NULL DEFAULT "EXPENSE", amount REAL NOT NULL DEFAULT 0, date INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL DEFAULT "{}")');
          // Backfill column values by extracting from the existing JSON data blob
          await dbHandle.runAsync(
            `INSERT INTO transactions (id, account_id, to_account_id, type, amount, date, data)
             SELECT id,
               COALESCE(json_extract(data, '$.account_id'), ''),
               json_extract(data, '$.to_account_id'),
               COALESCE(json_extract(data, '$.type'), 'EXPENSE'),
               COALESCE(CAST(json_extract(data, '$.amount') AS REAL), 0),
               COALESCE(CAST(json_extract(data, '$.date') AS INTEGER), 0),
               data
             FROM _transactions_v1`
          );
          await dbHandle.runAsync('DROP TABLE _transactions_v1');
          console.log('AndroidDatabase: transactions migration complete');
        }

        // Indexes must be created after any migration so account_id column exists
        await dbHandle.runAsync('CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id)');
        await dbHandle.runAsync('CREATE INDEX IF NOT EXISTS idx_transactions_to_account ON transactions(to_account_id)');
        await dbHandle.runAsync('CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date)');

        this.db = dbHandle;
        this.initialized = true;
        console.log('AndroidDatabase: SQLite initialized successfully');
        return;
      } catch (e: any) {
        console.error(`AndroidDatabase init attempt ${attempt} failed:`, e);
        if (dbHandle) {
          try { await dbHandle.closeAsync(); } catch (_) {}
        }
        this.db = null;
        if (attempt === 3) {
          if (e) e.isStaleHandleError = true;
          NativeErrorReporter.record(e);
          throw e;
        }
        await new Promise(r => setTimeout(r, 500 * attempt));
      }
    }
  }

  private isStaleHandleError(error: unknown): boolean {
    const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
    // SQL semantic errors (schema mismatch, syntax) are never stale-handle errors.
    // Guard first so prepareAsync/nativedatabase in the message don't cause false positives.
    if (msg.includes('no such column') || msg.includes('no such table') ||
        msg.includes('syntax error') || msg.includes('unique constraint') ||
        msg.includes('error code')) return false;
    return msg.includes('nullpointerexception') || msg.includes('prepareasync') ||
           msg.includes('execasync') || msg.includes('nativedatabase');
  }

  private async reinit(): Promise<void> {
    console.warn('AndroidDatabase: native handle stale, re-initializing...');
    if (this.db) {
      try {
        await this.db.closeAsync();
      } catch (e) {
        console.warn('AndroidDatabase: failed to close database in reinit', e);
      }
    }
    this.initialized = false;
    this.db = null;
    this.initPromise = null;
    await this.init();
  }

  private async runWithRetry<T>(action: (db: SQLite.SQLiteDatabase) => Promise<T>): Promise<T> {
    if (!this.db) await this.init();
    if (!this.db) {
      const err = new Error('Database not initialized');
      (err as any).isStaleHandleError = true;
      NativeErrorReporter.record(err);
      throw err;
    }

    try {
      return await action(this.db);
    } catch (error: any) {
      if (this.isStaleHandleError(error)) {
        if (error) error.isStaleHandleError = true;
        try {
          await this.reinit();
          if (!this.db) {
            const err = new Error('Database re-initialization failed');
            (err as any).isStaleHandleError = true;
            NativeErrorReporter.record(err);
            throw err;
          }
          return await action(this.db);
        } catch (e: any) {
          if (e) e.isStaleHandleError = true;
          NativeErrorReporter.record(e);
          throw e;
        }
      }
      // Non-stale errors (logic errors, JSON errors, etc.) — just rethrow,
      // do not count toward the circuit breaker.
      throw error;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Generic helpers
  // ─────────────────────────────────────────────────────────────

  private async getCollection<T>(table: string): Promise<T[]> {
    return this.runWithRetry(async (db) => {
      const result = await db.getAllAsync<{ data: string }>(`SELECT data FROM ${table}`);
      return result.map(row => JSON.parse(row.data) as T);
    });
  }

  private async setItem<T extends { id: string }>(table: string, item: T): Promise<void> {
    await this.runWithRetry(async (db) => {
      await db.runAsync(
        `INSERT OR REPLACE INTO ${table} (id, data) VALUES (?, ?)`,
        item.id, JSON.stringify(item)
      );
    });
  }

  private async deleteItem(table: string, id: string): Promise<void> {
    await this.runWithRetry(async (db) => {
      await db.runAsync(`DELETE FROM ${table} WHERE id = ?`, id);
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Transaction storage — dedicated columns for fast filtering
  // ─────────────────────────────────────────────────────────────

  private async setTransaction(transaction: Transaction): Promise<void> {
    const sql = `
      INSERT OR REPLACE INTO transactions (id, account_id, to_account_id, type, amount, date, data)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      transaction.id,
      transaction.account_id,
      transaction.type === 'TRANSFER' ? transaction.to_account_id : null,
      transaction.type,
      transaction.amount,
      transaction.date,
      JSON.stringify(transaction),
    ];
    await this.runWithRetry(async (db) => {
      await db.runAsync(sql, ...params);
    });
  }

  // ─────────────────────────────────────────────────────────────
  // INCREMENTAL balance update (Fix #1: replaces full O(N) scan)
  // ─────────────────────────────────────────────────────────────

  /**
   * Returns the signed delta that a single transaction contributes to
   * the balance of `accountId`.
   * Positive = balance increases, Negative = balance decreases.
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
   * Applies an incremental balance delta to each affected account.
   * old/new transaction may be undefined (create = only new, delete = only old).
   */
  private async applyBalanceDelta(
    oldTx: Partial<Transaction> | undefined,
    newTx: Partial<Transaction> | undefined
  ): Promise<void> {
    const accountIds = new Set<string>();
    if (oldTx?.account_id) accountIds.add(oldTx.account_id);
    if (oldTx?.to_account_id) accountIds.add(oldTx.to_account_id);
    if (newTx?.account_id) accountIds.add(newTx.account_id);
    if (newTx?.to_account_id) accountIds.add(newTx.to_account_id);

    if (accountIds.size === 0) return;
    const allAccounts = await this.getAccounts();
    const accountMap = new Map(allAccounts.map(a => [a.id, a]));

    for (const accountId of accountIds) {
      const reverseDelta = oldTx ? -this.balanceDelta(oldTx, accountId) : 0;
      const forwardDelta = newTx ? this.balanceDelta(newTx, accountId) : 0;
      const totalDelta = reverseDelta + forwardDelta;
      if (totalDelta === 0) continue;

      const account = accountMap.get(accountId);
      if (account) {
        account.balance = (account.balance ?? 0) + totalDelta;
        account.updated_at = Date.now();
        await this.setItem('accounts', account);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Transaction builder helpers (unchanged from original)
  // ─────────────────────────────────────────────────────────────

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

  /* ─────────────────────────────────────────────────────────────
     Account Methods
  ───────────────────────────────────────────────────────────── */
  async createAccount(account: Omit<Account, 'id' | 'created_at'>): Promise<Account> {
    const newAccount: Account = {
      ...account,
      id: generateUUID(),
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    await this.setItem('accounts', newAccount);
    LocalChangeEmitter.emit();
    return newAccount;
  }

  async getAccounts(): Promise<Account[]> {
    return this.getCollection<Account>('accounts');
  }

  async updateAccount(account: Account): Promise<void> {
    const updated = { ...account, updated_at: Date.now() };
    await this.setItem('accounts', updated);
    LocalChangeEmitter.emit();
  }

  async deleteAccount(id: string): Promise<void> {
    await this.deleteItem('accounts', id);
    LocalChangeEmitter.emit();
  }

  async upsertAccount(account: Account): Promise<void> {
    await this.setItem('accounts', account);
  }

  /* ─────────────────────────────────────────────────────────────
     Transaction Methods
  ───────────────────────────────────────────────────────────── */

  async createTransaction(transaction: Omit<Transaction, 'id'>): Promise<Transaction> {
    const newTransaction = this.buildStoredTransaction(transaction);
    await this.setTransaction(newTransaction);
    await this.applyBalanceDelta(undefined, newTransaction);
    LocalChangeEmitter.emit();
    return newTransaction;
  }

  /**
   * Fix #5: SQL-level filtering — only rows matching the filter are fetched.
   * Previously the entire table was loaded into JS and filtered there.
   */
  async getTransactions(filters?: { account_id?: string; startDate?: number; endDate?: number }): Promise<Transaction[]> {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (filters?.account_id) {
      conditions.push('(account_id = ? OR to_account_id = ?)');
      params.push(filters.account_id, filters.account_id);
    }
    if (filters?.startDate) {
      conditions.push('date >= ?');
      params.push(filters.startDate);
    }
    if (filters?.endDate) {
      conditions.push('date <= ?');
      params.push(filters.endDate);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT data FROM transactions ${where} ORDER BY date DESC`;

    return this.runWithRetry(async (db) => {
      const rows = await db.getAllAsync<{ data: string }>(sql, ...params);
      return rows.map(r => JSON.parse(r.data) as Transaction);
    });
  }

  async updateTransaction(id: string, updates: Partial<Omit<Transaction, 'id'>>): Promise<Transaction> {
    return this.runWithRetry(async (db) => {
      const row = await db.getFirstAsync<{ data: string }>(`SELECT data FROM transactions WHERE id = ?`, id);
      if (!row) throw new Error('Transaction not found');

      const existingTx = JSON.parse(row.data) as Transaction;
      const updated = this.mergeStoredTransaction(existingTx, updates);
      await this.setTransaction(updated);
      await this.applyBalanceDelta(existingTx, updated);
      LocalChangeEmitter.emit();
      return updated;
    });
  }

  async deleteTransaction(id: string, silent?: boolean): Promise<void> {
    await this.runWithRetry(async (db) => {
      const row = await db.getFirstAsync<{ data: string }>(`SELECT data FROM transactions WHERE id = ?`, id);
      const transaction = row ? JSON.parse(row.data) as Transaction : null;

      await this.deleteItem('transactions', id);

      if (transaction && !silent) {
        await this.applyBalanceDelta(transaction, undefined);
      }
      LocalChangeEmitter.emit();
    });
  }

  async upsertTransaction(transaction: Transaction): Promise<void> {
    await this.setTransaction(transaction);
  }

  /**
   * Full recalculation — kept for manual "repair balance" actions.
   * No longer called automatically on every write.
   */
  async recalculateAccountBalance(accountId: string): Promise<void> {
    await this.recalculateAccountBalanceInternal(accountId);
    LocalChangeEmitter.emit();
  }

  private async recalculateAccountBalanceInternal(accountId: string): Promise<void> {
    const accountTransactions = await this.getTransactions({ account_id: accountId });
    let balance = 0;
    for (const transaction of accountTransactions) {
      if (transaction.account_id === accountId) {
        if (transaction.type === 'INCOME') balance += transaction.amount;
        else balance -= transaction.amount;
      }
      if (transaction.type === 'TRANSFER' && transaction.to_account_id === accountId) {
        balance += transaction.amount;
      }
    }

    const accounts = await this.getAccounts();
    const account = accounts.find(a => a.id === accountId);
    if (account) {
      account.balance = balance;
      account.updated_at = Date.now();
      await this.setItem('accounts', account);
    }
  }

  /**
   * Fix #2: Properly implemented (was a stub returning 0).
   * Uses a composite signature (amount + type + description + minute-bucket)
   * to identify duplicate transactions within the same account.
   */
  async removeDuplicateTransactions(accountId: string): Promise<number> {
    return this.runWithRetry(async (db) => {
      const rows = await db.getAllAsync<{ data: string }>(
        `SELECT data FROM transactions WHERE account_id = ? OR to_account_id = ?`,
        accountId, accountId
      );
      const transactions = rows.map(r => JSON.parse(r.data) as Transaction);

      const seen = new Set<string>();
      const toDelete: string[] = [];

      for (const t of transactions) {
        const minuteBucket = Math.floor(t.date / 60_000);
        const sig = `${t.account_id}|${t.type}|${t.amount}|${t.category}|${t.description ?? ''}|${minuteBucket}`;
        if (seen.has(sig)) {
          toDelete.push(t.id);
        } else {
          seen.add(sig);
        }
      }

      if (toDelete.length === 0) return 0;

      // Delete duplicates and update affected balances
      const duplicateTxs = transactions.filter(t => toDelete.includes(t.id));
      for (const id of toDelete) {
        await this.deleteItem('transactions', id);
      }
      // Recalculate balances for all affected accounts
      const affectedAccounts = new Set<string>();
      for (const t of duplicateTxs) {
        affectedAccounts.add(t.account_id);
        if (t.to_account_id) affectedAccounts.add(t.to_account_id);
      }
      for (const aid of affectedAccounts) {
        await this.recalculateAccountBalanceInternal(aid);
      }

      LocalChangeEmitter.emit();
      return toDelete.length;
    });
  }

  /* ─────────────────────────────────────────────────────────────
     Budget Methods
  ───────────────────────────────────────────────────────────── */
  async createBudget(budget: Omit<Budget, 'id'>): Promise<Budget> {
    const newBudget = { ...budget, id: generateUUID(), updated_at: Date.now() };
    await this.setItem('budgets', newBudget);
    LocalChangeEmitter.emit();
    return newBudget;
  }

  async getBudgets(): Promise<Budget[]> {
    return this.getCollection<Budget>('budgets');
  }

  async updateBudget(budget: Budget): Promise<void> {
    const updated = { ...budget, updated_at: Date.now() };
    await this.setItem('budgets', updated);
    LocalChangeEmitter.emit();
  }

  async deleteBudget(id: string): Promise<void> {
    await this.deleteItem('budgets', id);
    LocalChangeEmitter.emit();
  }

  async upsertBudget(budget: Budget): Promise<void> {
    await this.setItem('budgets', budget);
  }

  /* ─────────────────────────────────────────────────────────────
     Loan Methods
  ───────────────────────────────────────────────────────────── */
  async createLoan(loan: Omit<Loan, 'id'>): Promise<Loan> {
    const newLoan = { ...loan, id: generateUUID(), updated_at: Date.now() };
    await this.setItem('loans', newLoan);
    LocalChangeEmitter.emit();
    return newLoan;
  }

  async getLoans(): Promise<Loan[]> {
    return this.getCollection<Loan>('loans');
  }

  async updateLoan(loan: Loan): Promise<void> {
    const updated = { ...loan, updated_at: Date.now() };
    await this.setItem('loans', updated);
    LocalChangeEmitter.emit();
  }

  async deleteLoan(id: string): Promise<void> {
    await this.deleteItem('loans', id);
    LocalChangeEmitter.emit();
  }

  async upsertLoan(loan: Loan): Promise<void> {
    await this.setItem('loans', loan);
  }

  // General
  async clearAllData(): Promise<void> {
    await this.runWithRetry(async (db) => {
      await db.runAsync('DELETE FROM accounts');
      await db.runAsync('DELETE FROM transactions');
      await db.runAsync('DELETE FROM budgets');
      await db.runAsync('DELETE FROM loans');
    });
    LocalChangeEmitter.emit();
  }
}
