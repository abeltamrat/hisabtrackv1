export type AccountType = 'BANK' | 'MOBILE_MONEY' | 'CASH' | 'CARD' | 'SAVINGS';
export type TransactionType = 'INCOME' | 'EXPENSE' | 'TRANSFER';
export type BudgetPeriod = 'MONTHLY' | 'WEEKLY';
export type BudgetRolloverMode = 'NONE' | 'CARRY_UNUSED' | 'REDUCE_NEXT';
export type LoanType = 'BORROWED' | 'LENT';
export type LoanStatus = 'ACTIVE' | 'PAID' | 'DEFAULTED';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  balance: number;
  currency: string;
  is_locked: boolean;
  locked_amount: number;
  created_at: number; // Timestamp
  updated_at?: number; // Timestamp of last update
  account_number?: string;
  sms_number?: string;
  logo?: string;
}

interface TransactionBase {
  id: string;
  account_id: string;
  amount: number;
  category: string;
  tags?: string[];
  date: number; // Timestamp
  description: string;
  sender_receiver?: string;
  reference_number?: string;
  sms_id?: string;
  fees?: number;
  tax?: number;
  updated_at?: number;
}

export interface StandardTransaction extends TransactionBase {
  type: Exclude<TransactionType, 'TRANSFER'>;
  to_account_id?: string;
}

export interface TransferTransaction extends TransactionBase {
  type: 'TRANSFER';
  to_account_id: string;
}

export type Transaction = StandardTransaction | TransferTransaction;

export interface Budget {
  id: string;
  category: string;
  limit_amount: number;
  base_limit_amount?: number;
  rollover_mode?: BudgetRolloverMode;
  period: BudgetPeriod;
  start_date: number;
  end_date: number;
  updated_at?: number;
}

export interface Loan {
  id: string;
  type: LoanType;
  principal_amount: number;
  interest_rate: number;
  start_date: number;
  due_date: number;
  lender_borrower_name: string;
  status: LoanStatus;
  remaining_balance: number;
  updated_at?: number;
  reminderEnabled?: boolean;
  reminderDaysBefore?: number;
  reminderTime?: number;
  notificationId?: string;
}

export interface IDatabase {
  // Account Methods
  createAccount(account: Omit<Account, 'id' | 'created_at'>): Promise<Account>;
  getAccounts(): Promise<Account[]>;
  updateAccount(account: Account): Promise<void>;
  deleteAccount(id: string): Promise<void>;

  // Transaction Methods
  createTransaction(transaction: Omit<Transaction, 'id'>): Promise<Transaction>;
  getTransactions(filters?: { account_id?: string; startDate?: number; endDate?: number }): Promise<Transaction[]>;
  updateTransaction(id: string, updates: Partial<Omit<Transaction, 'id'>>): Promise<Transaction>;
  deleteTransaction(id: string, silent?: boolean): Promise<void>;
  recalculateAccountBalance(accountId: string): Promise<void>;
  removeDuplicateTransactions(accountId: string): Promise<number>;

  // Budget Methods
  createBudget(budget: Omit<Budget, 'id'>): Promise<Budget>;
  getBudgets(): Promise<Budget[]>;
  updateBudget(budget: Budget): Promise<void>;
  deleteBudget(id: string): Promise<void>;

  // Loan Methods
  createLoan(loan: Omit<Loan, 'id'>): Promise<Loan>;
  getLoans(): Promise<Loan[]>;
  updateLoan(loan: Loan): Promise<void>;
  deleteLoan(id: string): Promise<void>;

  // General
  init(): Promise<void>;
  clearAllData(): Promise<void>;
  // Upsert helpers for sync
  upsertAccount(account: Account): Promise<void>;
  upsertTransaction(transaction: Transaction): Promise<void>;
  upsertBudget(budget: Budget): Promise<void>;
  upsertLoan(loan: Loan): Promise<void>;
}

export type RecurringFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface RecurringTransaction {
  id: string;
  name: string;
  amount: number;
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  category: string;
  tags?: string[];
  frequency: RecurringFrequency;
  startDate: number;
  endDate?: number;
  nextDate: number;
  isActive: boolean;
  accountId: string;
  toAccountId?: string; // For transfers
  description?: string;
  totalRepetitions?: number;
  completedRepetitions: number;
  reminderEnabled: boolean;
  reminderDaysBefore: number;
  reminderTime?: number;
  notificationId?: string;
}
