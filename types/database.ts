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
  /** User-selected cash cushion used by forecasts and safe-to-spend. */
  reserve_amount?: number;
  created_at: number; // Timestamp
  updated_at?: number; // Timestamp of last update
  account_number?: string;
  sms_number?: string;
  /** How the opening balance was established. */
  balance_source?: 'MANUAL' | 'SMS';
  /** Latest SMS timestamp already represented by an SMS-derived opening balance. */
  balance_as_of?: number;
  /** Names seen in SMS that identify this owned account. */
  aliases?: string[];
  logo?: string;
  /** Set on the cash account that holds a shared fund (owner mirror or custodian float). */
  fund_id?: string;
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
  /** External project this was paid or received for (whole transaction; splits may override). */
  project?: ProjectLink;
  /** Itemized purchase (item × quantity × unit price). Lines may cover part of the amount. */
  lines?: PurchaseLine[];
  /** Supplier from a connected system's supplier list (otherwise sender_receiver / People). */
  supplier?: SupplierLink;
  date: number; // Timestamp
  description: string;
  sender_receiver?: string;
  /** Stable People-directory link. The observed SMS/manual name stays in sender_receiver. */
  person_id?: string;
  /** Name shown when this transaction was recorded, retained across later renames. */
  person_name_snapshot?: string;
  person_link_source?: 'MANUAL' | 'SMS_CONFIRMED' | 'HISTORICAL_REVIEW';
  person_alias_used?: string;
  reference_number?: string;
  sms_id?: string;
  fees?: number;
  tax?: number;
  service_charge?: number;
  vat?: number;
  disaster_recovery_fee?: number;
  receipt_url?: string;
  updated_at?: number;
  /** Shared fund this movement belongs to. Rows with fund_entry_id are managed from the fund screen. */
  fund_id?: string;
  fund_entry_id?: string;
  /** Owner side: derived from the custodian's entry and rebuilt by FundLedgerService. */
  fund_mirror?: boolean;
  /** Community workflow ownership. These rows are corrected from the Equb/Iddir screen. */
  community_group_id?: string;
  community_event_id?: string;
}

export interface TransactionSplit {
  id: string;
  amount: number;
  category: string;
  description?: string;
  tags?: string[];
  project?: ProjectLink;
}

/**
 * Link to a project in a connected system. The title is a snapshot taken when
 * the link was made, so history still reads correctly if the project is later
 * renamed, closed, or the connection is removed.
 */
export interface ProjectLink {
  source: 'mela';
  id: number;
  code?: string;
  title: string;
}

export interface SupplierLink {
  source: 'mela';
  id: number;
  name: string;
}

export type ItemKind = 'MATERIAL' | 'TOOL' | 'OTHER';

/**
 * What was bought. Personal items are identified by their normalized name
 * ('local'), Mela catalog items by their Mela id ('mela'). Name, kind, unit and
 * category are snapshots, so the catalog can be rebuilt from purchase lines.
 */
export interface ItemLink {
  source: 'local' | 'mela';
  id: string;
  name: string;
  kind?: ItemKind;
  category?: string;
}

export interface PurchaseLine {
  id: string;
  item: ItemLink;
  quantity: number;
  unit?: string;
  unit_price: number;
  /** quantity × unit_price, rounded to cents. */
  amount: number;
  /** Overrides the transaction's project for this line. */
  project?: ProjectLink;
  /** On a split transaction, the part this item belongs to (it then uses that part's project). */
  split_id?: string;
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
  calendar_system?: 'GREGORIAN' | 'ETHIOPIAN';
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
  person_id?: string;
  person_name_snapshot?: string;
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

export type FundType = 'PETTY_CASH' | 'REVOLVING' | 'HELD_FOR_ME';
export type FundRole = 'OWNER' | 'CUSTODIAN';
export type FundEntryKind = 'DEPOSIT' | 'SPEND' | 'RETURN';
export type FundDepositSource = 'OWNER' | 'THIRD_PARTY' | 'OWNER_UNRECORDED';
export type FundEntryStatus = 'PENDING' | 'ACTIVE' | 'VOIDED';

export interface FundCategory {
  name: string;
  parentName?: string;
  icon: string;
  color: string;
  type: 'income' | 'expense';
}

/** Firestore sharedFunds/{id}. Written only by the mutateSharedFund callable. */
export interface SharedFund {
  id: string;
  ownerUid: string;
  ownerName: string;
  custodianUid: string | null;
  custodianName: string | null;
  members: string[];
  invitedUid: string | null;
  inviteEmailHint: string | null;
  inviteCode: string | null;
  inviteExpiresAt?: number;
  name: string;
  fundType: FundType;
  currency: string;
  floatTarget: number | null;
  lowBalancePct: number;
  linkStatus: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED';
  status: 'ACTIVE' | 'CLOSED';
  balance: number;
  totalIn: number;
  totalSpent: number;
  totalReturned: number;
  pendingIn: number;
  entryVersion: number;
  categories: FundCategory[];
  createdAt: number;
  updatedAt: number;
  acceptedAt?: number;
  closedAt?: number;
}

export interface FundEntryFlag {
  byUid: string;
  note: string;
  at: number;
  reply?: string;
  repliedAt?: number;
  resolved: boolean;
  resolvedAt?: number;
}

/** Firestore sharedFunds/{id}/entries/{entryId}. Never hard-deleted; voided instead. */
export interface FundEntry {
  id: string;
  kind: FundEntryKind;
  source?: FundDepositSource;
  amount: number;
  date: number;
  description: string;
  note?: string;
  payerName?: string;
  payerPersonId?: string;
  recipient?: string;
  recipientPersonId?: string;
  reference_number?: string;
  receipt_url?: string;
  sms_linked?: boolean;
  category?: string;
  splits?: TransactionSplit[];
  lines?: PurchaseLine[];
  project?: ProjectLink;
  supplier?: SupplierLink;
  tags?: string[];
  recordedByUid: string;
  recordedByRole: FundRole;
  createdAt: number;
  status: FundEntryStatus;
  voidReason?: string;
  voidedAt?: number;
  ackByUid?: string;
  ackAt?: number;
  /** The owner's say on how this entry counts in their own books. */
  ownerCategory?: string | null;
  ownerPurpose?: 'OPERATING' | 'FINANCING' | null;
  ownerSplits?: TransactionSplit[] | null;
  ownerAccountId?: string | null;
  classifiedAt?: number;
  flag?: FundEntryFlag;
}

export interface FundChangelogEntry {
  id: string;
  actorUid: string;
  actorName: string;
  timestamp: number;
  action: string;
  entryId?: string;
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
  person_id?: string;
  person_name_snapshot?: string;
  totalRepetitions?: number;
  completedRepetitions: number;
  reminderEnabled: boolean;
  reminderDaysBefore: number;
  reminderDaysBeforeList?: number[];
  reminderTime?: number;
  notificationId?: string;
  notificationIds?: string[];
  splits?: TransactionSplit[];
  calendar_system?: 'GREGORIAN' | 'ETHIOPIAN';
}
