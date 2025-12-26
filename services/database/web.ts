import LocalChangeEmitter from '@/services/LocalChangeEmitter';
import { Account, Budget, IDatabase, Loan, Transaction } from '@/types/database';
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
    const newTransaction: Transaction = {
      ...transaction,
      id: generateUUID(),
      updated_at: Date.now(),
    };
    await db.put('transactions', newTransaction);

    // Update Account Balance
    const account = await db.get('accounts', transaction.account_id);
    if (account) {
      if (transaction.type === 'INCOME') {
        account.balance += transaction.amount;
      } else if (transaction.type === 'EXPENSE') {
        account.balance -= transaction.amount;
      }
      // Handle TRANSFER logic if needed, but type is INCOME/EXPENSE/TRANSFER?
      else if (transaction.type === 'TRANSFER') {
         // Logic for transfer might be complex if it involves two accounts, 
         // but usually specific fields define destination. 
         // For now, assuming standard +/- logic if type matches.
         account.balance -= transaction.amount;
      }
      await db.put('accounts', account);
    }

    LocalChangeEmitter.emit();

    return newTransaction;
  }

  async getTransactions(filters?: { account_id?: string; startDate?: number; endDate?: number }): Promise<Transaction[]> {
    const db = await this.getDB();
    let transactions: Transaction[];

    if (filters?.account_id) {
      transactions = await db.getAllFromIndex('transactions', 'by-account', filters.account_id);
    } else {
      transactions = await db.getAll('transactions');
    }

    if (filters?.startDate || filters?.endDate) {
      transactions = transactions.filter((t) => {
        const afterStart = filters.startDate ? t.date >= filters.startDate : true;
        const beforeEnd = filters.endDate ? t.date <= filters.endDate : true;
        return afterStart && beforeEnd;
      });
    }

    return transactions.sort((a, b) => b.date - a.date);
  }

  async updateTransaction(id: string, updates: Partial<Omit<Transaction, 'id'>>): Promise<Transaction> {
    const db = await this.getDB();
    const existing = await db.get('transactions', id);
    if (!existing) {
      throw new Error('Transaction not found');
    }

    const updated: Transaction = {
      ...existing,
      ...updates,
      updated_at: Date.now(),
    };

    // Handle balance updates if amount or type changed
    if (updates.amount !== undefined || updates.type !== undefined) {
      const account = await db.get('accounts', updated.account_id);
      if (account) {
        // Revert old transaction effect
        if (existing.type === 'INCOME') {
          account.balance -= existing.amount;
        } else if (existing.type === 'EXPENSE' || existing.type === 'TRANSFER') {
          account.balance += existing.amount;
        }

        // Apply new transaction effect
        if (updated.type === 'INCOME') {
          account.balance += updated.amount;
        } else if (updated.type === 'EXPENSE' || updated.type === 'TRANSFER') {
          account.balance -= updated.amount;
        }

        await db.put('accounts', account);
      }
    }

    await db.put('transactions', updated);
    LocalChangeEmitter.emit();
    return updated;
  }

  async deleteTransaction(id: string): Promise<void> {
    const db = await this.getDB();
    const transaction = await db.get('transactions', id);
    if (transaction) {
      // Revert balance change
      const account = await db.get('accounts', transaction.account_id);
      if (account) {
        if (transaction.type === 'INCOME') {
          account.balance -= transaction.amount;
        } else if (transaction.type === 'EXPENSE' || transaction.type === 'TRANSFER') {
          account.balance += transaction.amount;
        }
        await db.put('accounts', account);
      }
      await db.delete('transactions', id);
      LocalChangeEmitter.emit();
    }
  }

  // Budgets
  async createBudget(budget: Omit<Budget, 'id'>): Promise<Budget> {
    const db = await this.getDB();
    const newBudget: Budget = {
      ...budget,
      id: generateUUID(),
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
    };
    await db.put('loans', newLoan);
    LocalChangeEmitter.emit();
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
