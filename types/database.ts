export type AccountType = 'BANK' | 'MOBILE_MONEY' | 'CASH' | 'CARD' | 'SAVINGS';
export type TransactionType = 'INCOME' | 'EXPENSE' | 'TRANSFER';
export type BudgetPeriod = 'MONTHLY' | 'WEEKLY';
export type BudgetRolloverMode = 'NONE' | 'CARRY_UNUSED' | 'REDUCE_NEXT';
export type LoanType = 'BORROWED' | 'LENT';
export type LoanStatus = 'ACTIVE' | 'PAID' | 'DEFAULTED';
export type LinkRole = 'BORROWER' | 'LENDER';
export type LinkStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED';

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
  /** Names seen in SMS that identify this owned account. */
  aliases?: string[];
  logo?: string;
}

interface TransactionBase {
  interest_amount?: number;
  purpose?: 'OPERATING' | 'FINANCING' | 'ADJUSTMENT';
  operation_id?: string;
  loan_id?: string;
  id: string;
  account_id: string;
  amount: number;
  /** Total account debit when it differs from the recipient/principal amount. */
  gross_amount?: number;
  category: string;
  tags?: string[];
  /** Reporting allocations that sum to amount; they never move cash again. */
  splits?: TransactionSplit[];
  date: number; // Timestamp
  description: string;
  sender_receiver?: string;
  reference_number?: string;
  sms_id?: string;
  fees?: number;
  tax?: number;
  service_charge?: number;
  vat?: number;
  disaster_recovery_fee?: number;
  receipt_url?: string;
  updated_at?: number;
}

export interface TransactionSplit {
  id: string;
  amount: number;
  category: string;
  description?: string;
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
  total_interest?: number;
  remaining_interest?: number;
  interest_method?: 'FLAT_MONTHLY';
  reminder_at?: number;
  currency?: string;
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
  // Linked loan fields
  shared_loan_id?: string;
  link_role?: LinkRole;
  link_status?: LinkStatus;
  linked_uid?: string;
  linked_name?: string;
  linked_phone?: string;
  // True when this user sent the original link request (initiator), false when they accepted
  is_initiator?: boolean;
}

export interface SharedLoan {
  id?: string;
  borrowerUid: string;
  borrowerName: string;
  borrowerPhone: string;
  lenderUid: string;
  lenderName: string;
  lenderPhone: string;
  amount: number;
  description: string;
  dueDate: number;
  startDate: number;
  interestRate: number;
  status: LoanStatus;
  initiatorUid: string;
  linkStatus: LinkStatus;
  createdAt: number;
  updatedAt: number;
  borrowerLoanId: string;
  lenderLoanId: string;
}

export interface LinkedRepayment {
  interestAmount?: number;
  id?: string;
  amount: number;
  date: number;
  recordedByUid: string;
  recordedBy: LinkRole;
  status: 'PENDING_CONFIRMATION' | 'CONFIRMED' | 'REJECTED';
  confirmedAt?: number;
  rejectedAt?: number;
}

export interface LinkedChatMessage {
  id?: string;
  senderUid: string;
  senderName: string;
  text: string;
  timestamp: number;
  readBy: string[];
}

export interface LinkedChangelogEntry {
  id?: string;
  actorUid: string;
  actorName: string;
  timestamp: number;
  action: string;
  before?: Record<string, any>;
  after?: Record<string, any>;
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
  /** Estimated transfer costs included in amount and excluded from destination credit. */
  fees?: number;
  tax?: number;
  description?: string;
  totalRepetitions?: number;
  completedRepetitions: number;
  reminderEnabled: boolean;
  reminderDaysBefore: number;
  reminderTime?: number;
  notificationId?: string;
  splits?: TransactionSplit[];
}
