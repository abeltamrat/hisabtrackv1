import LocalChangeEmitter from '@/services/LocalChangeEmitter';
import { Account, Budget, IDatabase, Loan, Transaction } from '@/types/database';
import { generateUUID } from '@/utils/uuid';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Android Database implementation using AsyncStorage
 * Simple JSON storage - Firestore is the source of truth
 */
export class AndroidDatabase implements IDatabase {
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    console.log('AndroidDatabase: Initializing AsyncStorage-based database');
    this.initialized = true;
  }

  // Helper methods for JSON storage
  private async getCollection<T>(key: string): Promise<T[]> {
    try {
      const data = await AsyncStorage.getItem(key);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error(`Error reading ${key}:`, error);
      return [];
    }
  }

  private async setCollection<T>(key: string, items: T[]): Promise<void> {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(items));
    } catch (error) {
      console.error(`Error writing ${key}:`, error);
      throw error;
    }
  }

  // Account Methods
  async createAccount(account: Omit<Account, 'id' | 'created_at'>): Promise<Account> {
    await this.init();
    const newAccount: Account = {
      ...account,
      id: generateUUID(),
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    const accounts = await this.getCollection<Account>('accounts');
    accounts.push(newAccount);
    await this.setCollection('accounts', accounts);
    
    LocalChangeEmitter.emit();
    return newAccount;
  }

  async getAccounts(): Promise<Account[]> {
    await this.init();
    return this.getCollection<Account>('accounts');
  }

  async updateAccount(account: Account): Promise<void> {
    await this.init();
    const accounts = await this.getCollection<Account>('accounts');
    const index = accounts.findIndex(a => a.id === account.id);
    
    if (index !== -1) {
      accounts[index] = { ...account, updated_at: Date.now() };
      await this.setCollection('accounts', accounts);
      LocalChangeEmitter.emit();
    }
  }

  async deleteAccount(id: string): Promise<void> {
    await this.init();
    const accounts = await this.getCollection<Account>('accounts');
    const filtered = accounts.filter(a => a.id !== id);
    await this.setCollection('accounts', filtered);
    LocalChangeEmitter.emit();
  }

  async upsertAccount(account: Account): Promise<void> {
    await this.init();
    const accounts = await this.getCollection<Account>('accounts');
    const index = accounts.findIndex(a => a.id === account.id);
    
    if (index !== -1) {
      accounts[index] = account;
    } else {
      accounts.push(account);
    }
    
    await this.setCollection('accounts', accounts);
  }

  // Transaction Methods
  async createTransaction(transaction: Omit<Transaction, 'id'>): Promise<Transaction> {
    await this.init();
    const newTransaction: Transaction = {
      ...transaction,
      id: generateUUID(),
      updated_at: Date.now(),
    };

    const transactions = await this.getCollection<Transaction>('transactions');
    transactions.push(newTransaction);
    await this.setCollection('transactions', transactions);
    
    LocalChangeEmitter.emit();
    return newTransaction;
  }

  async getTransactions(filters?: { account_id?: string; startDate?: number; endDate?: number }): Promise<Transaction[]> {
    await this.init();
    let transactions = await this.getCollection<Transaction>('transactions');

    if (filters?.account_id) {
      transactions = transactions.filter(t => t.account_id === filters.account_id);
    }
    if (filters?.startDate) {
      transactions = transactions.filter(t => t.date >= filters.startDate!);
    }
    if (filters?.endDate) {
      transactions = transactions.filter(t => t.date <= filters.endDate!);
    }

    return transactions;
  }

  async updateTransaction(id: string, updates: Partial<Omit<Transaction, 'id'>>): Promise<Transaction> {
    await this.init();
    const transactions = await this.getCollection<Transaction>('transactions');
    const index = transactions.findIndex(t => t.id === id);
    
    if (index === -1) {
      throw new Error('Transaction not found');
    }

    const existing = transactions[index];
    const updated: Transaction = {
      ...existing,
      ...updates,
      updated_at: Date.now(),
    };

    transactions[index] = updated;
    await this.setCollection('transactions', transactions);
    LocalChangeEmitter.emit();
    return updated;
  }

  async deleteTransaction(id: string): Promise<void> {
    await this.init();
    const transactions = await this.getCollection<Transaction>('transactions');
    const filtered = transactions.filter(t => t.id !== id);
    await this.setCollection('transactions', filtered);
    LocalChangeEmitter.emit();
  }

  async upsertTransaction(transaction: Transaction): Promise<void> {
    await this.init();
    const transactions = await this.getCollection<Transaction>('transactions');
    const index = transactions.findIndex(t => t.id === transaction.id);
    
    if (index !== -1) {
      transactions[index] = transaction;
    } else {
      transactions.push(transaction);
    }
    
    await this.setCollection('transactions', transactions);
  }

  // Budget Methods
  async createBudget(budget: Omit<Budget, 'id'>): Promise<Budget> {
    await this.init();
    const newBudget: Budget = {
      ...budget,
      id: generateUUID(),
      updated_at: Date.now(),
    };

    const budgets = await this.getCollection<Budget>('budgets');
    budgets.push(newBudget);
    await this.setCollection('budgets', budgets);
    
    LocalChangeEmitter.emit();
    return newBudget;
  }

  async getBudgets(): Promise<Budget[]> {
    await this.init();
    return this.getCollection<Budget>('budgets');
  }

  async updateBudget(budget: Budget): Promise<void> {
    await this.init();
    const budgets = await this.getCollection<Budget>('budgets');
    const index = budgets.findIndex(b => b.id === budget.id);
    
    if (index !== -1) {
      budgets[index] = { ...budget, updated_at: Date.now() };
      await this.setCollection('budgets', budgets);
      LocalChangeEmitter.emit();
    }
  }

  async deleteBudget(id: string): Promise<void> {
    await this.init();
    const budgets = await this.getCollection<Budget>('budgets');
    const filtered = budgets.filter(b => b.id !== id);
    await this.setCollection('budgets', filtered);
    LocalChangeEmitter.emit();
  }

  async upsertBudget(budget: Budget): Promise<void> {
    await this.init();
    const budgets = await this.getCollection<Budget>('budgets');
    const index = budgets.findIndex(b => b.id === budget.id);
    
    if (index !== -1) {
      budgets[index] = budget;
    } else {
      budgets.push(budget);
    }
    
    await this.setCollection('budgets', budgets);
  }

  // Loan Methods
  async createLoan(loan: Omit<Loan, 'id'>): Promise<Loan> {
    await this.init();
    const newLoan: Loan = {
      ...loan,
      id: generateUUID(),
      updated_at: Date.now(),
    };

    const loans = await this.getCollection<Loan>('loans');
    loans.push(newLoan);
    await this.setCollection('loans', loans);
    
    LocalChangeEmitter.emit();
    return newLoan;
  }

  async getLoans(): Promise<Loan[]> {
    await this.init();
    return this.getCollection<Loan>('loans');
  }

  async updateLoan(loan: Loan): Promise<void> {
    await this.init();
    const loans = await this.getCollection<Loan>('loans');
    const index = loans.findIndex(l => l.id === loan.id);
    
    if (index !== -1) {
      loans[index] = { ...loan, updated_at: Date.now() };
      await this.setCollection('loans', loans);
      LocalChangeEmitter.emit();
    }
  }

  async deleteLoan(id: string): Promise<void> {
    await this.init();
    const loans = await this.getCollection<Loan>('loans');
    const filtered = loans.filter(l => l.id !== id);
    await this.setCollection('loans', filtered);
    LocalChangeEmitter.emit();
  }

  async upsertLoan(loan: Loan): Promise<void> {
    await this.init();
    const loans = await this.getCollection<Loan>('loans');
    const index = loans.findIndex(l => l.id === loan.id);
    
    if (index !== -1) {
      loans[index] = loan;
    } else {
      loans.push(loan);
    }
    
    await this.setCollection('loans', loans);
  }

  // General Methods
  async clearAllData(): Promise<void> {
    await this.init();
    console.log('AndroidDatabase: Clearing all data');
    await AsyncStorage.multiRemove(['accounts', 'transactions', 'budgets', 'loans']);
    LocalChangeEmitter.emit();
  }
}

export default new AndroidDatabase();
