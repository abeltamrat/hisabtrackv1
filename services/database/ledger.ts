import type { Account, Budget, IDatabase, Loan, Transaction } from '@/types/database';
import { createSerialQueue } from '@/utils/asyncLock';
import { accountDelta, money, sumMoney, validateTransaction, purpose } from '@/utils/finance';
import { generateUUID } from '@/utils/uuid';
import LocalChangeEmitter from '../LocalChangeEmitter';

export type Table = 'accounts' | 'transactions' | 'budgets' | 'loans' | 'meta';
export type Row = { table: Table; id: string; value?: any };
export type Change = Row & { token: string; base: number };
type Adapter = IDatabase & {
  readMeta(id: string): Promise<any>;
  commitRows(rows: Row[], metadata?: Record<string, any>): Promise<void>;
  getTransactionById?(id: string): Promise<Transaction | undefined>;
};
const tables: Array<Exclude<Table, 'meta'>> = ['accounts', 'transactions', 'budgets', 'loans'];
const key = (row: Row) => `${row.table}/${row.id}`;

function loanReminderAt(loan: Pick<Loan, 'due_date' | 'reminderDaysBefore' | 'reminderTime'>) {
  const reminder = new Date(loan.due_date);
  reminder.setDate(reminder.getDate() - (loan.reminderDaysBefore || 0));
  const clock = loan.reminderTime ? new Date(loan.reminderTime) : null;
  const hasClock = clock !== null && Number.isFinite(clock.getTime());
  reminder.setHours(hasClock ? clock.getHours() : 9, hasClock ? clock.getMinutes() : 0, 0, 0);
  return reminder.getTime();
}

/** One writer, atomic compound operations, and an outbox committed with the data. */
export class LedgerDatabase implements IDatabase {
  private queue = createSerialQueue();
  private active = true;
  constructor(private raw: Adapter, readonly scope: string) {}
  private initialization: Promise<void> | null = null;
  init() {
    if (!this.initialization) this.initialization = this.run(async () => {
      await this.raw.init();
      if (await this.raw.readMeta('ledger_baseline_v1')) return;
      const transactions = await this.raw.getTransactions();
      const rows: Row[] = [];
      for (const account of await this.raw.getAccounts()) {
        const difference = money(account.balance - sumMoney(transactions.map(t => accountDelta(t, account.id))));
        if (difference) rows.push(this.baseline(account, difference));
      }
      await this.commit(rows, [], { ledger_baseline_v1: true });
    }).catch(error => { this.initialization = null; throw error; });
    return this.initialization;
  }
  private baseline(account: Account, difference: number): Row {
    const id = `baseline-${account.id}`;
    return { table: 'transactions', id, value: { id, account_id: account.id, amount: Math.abs(difference), type: difference > 0 ? 'INCOME' : 'EXPENSE', purpose: 'ADJUSTMENT', category: 'Opening Balance', description: 'Preserved legacy balance', date: account.created_at || 1, updated_at: Date.now() } };
  }
  /**
   * Find one transaction by id. Prefers the adapter's keyed lookup; the
   * fallback keeps any adapter without it working (older builds, test doubles).
   */
  private async transactionById(id: string): Promise<Transaction | undefined> {
    if (this.raw.getTransactionById) return this.raw.getTransactionById(id);
    return (await this.raw.getTransactions()).find(t => t.id === id);
  }
  deactivate() { this.active = false; }
  drain() { return this.queue(async () => undefined); }
  private run<T>(fn: () => Promise<T>): Promise<T> {
    return this.queue(async () => { if (!this.active) throw new Error('Session changed. Reopen this screen.'); return fn(); });
  }
  private read(table: Table): Promise<any[]> {
    if (table === 'meta') return this.raw.readMeta('synced_meta').then(values => Object.values(values || {}));
    return this.raw[({ accounts: 'getAccounts', transactions: 'getTransactions', budgets: 'getBudgets', loans: 'getLoans' } as const)[table]]();
  }
  private async commit(rows: Row[], derived: Row[] = [], meta: Record<string, any> = {}) {
    const outbox: Record<string, Change> = await this.raw.readMeta('outbox') || {};
    const revisions = await this.raw.readMeta('revisions') || {};
    for (const row of rows) outbox[key(row)] = { ...row, token: generateUUID(), base: outbox[key(row)]?.base ?? revisions[key(row)] ?? 0 };
    await this.rawCommit([...rows, ...derived], { ...meta, outbox });
    LocalChangeEmitter.emit();
  }
  private async rawCommit(rows: Row[], metadata: Record<string, any> = {}) {
    const synced = await this.raw.readMeta('synced_meta') || {};
    for (const row of rows.filter(r => r.table === 'meta')) {
      if (row.value === undefined) delete synced[row.id]; else synced[row.id] = row.value;
    }
    await this.raw.commitRows(rows.filter(r => r.table !== 'meta'), { ...metadata, synced_meta: synced });
  }
  writeSyncedMeta(id: string, items: any[]) { return this.run(() => {
    const value = { id, items, updated_at: Date.now() }; this.validateEntity('meta', value);
    return this.commit([{ table: 'meta', id, value }]);
  }); }
  getAccounts() { return this.run(() => this.raw.getAccounts()); }
  getTransactions(filters?: Parameters<IDatabase['getTransactions']>[0]) { return this.run(() => this.raw.getTransactions(filters)); }
  getBudgets() { return this.run(() => this.raw.getBudgets()); }
  getLoans() { return this.run(() => this.raw.getLoans()); }
  readMeta(id: string) { return this.run(() => this.raw.readMeta(id)); }
  writeMeta(id: string, value: any) { return this.run(() => this.raw.commitRows([], { [id]: value })); }

  private async balances(oldTx?: Transaction, next?: Transaction): Promise<Row[]> {
    const accounts = await this.raw.getAccounts();
    if (next) validateTransaction(next, accounts);
    return accounts.filter(a => [oldTx?.account_id, oldTx?.to_account_id, next?.account_id, next?.to_account_id].includes(a.id)).map(a => ({
      table: 'accounts', id: a.id, value: { ...a, balance: sumMoney([a.balance, oldTx ? -accountDelta(oldTx, a.id) : 0, next ? accountDelta(next, a.id) : 0]) },
    }));
  }
  private async buildTransaction(input: Omit<Transaction, 'id'>): Promise<Transaction> {
    validateTransaction(input, await this.raw.getAccounts());
    return { ...input, id: input.operation_id ? `op-${input.operation_id}` : generateUUID(), amount: money(input.amount), fees: money(input.fees || 0), tax: money(input.tax || 0), purpose: purpose(input) as Transaction['purpose'], updated_at: Date.now() } as Transaction;
  }
  createTransaction(input: Omit<Transaction, 'id'>) {
    return this.run(async () => {
      const tx = await this.buildTransaction(input);
      if (input.operation_id) {
        const existing = await this.transactionById(tx.id);
        if (existing) {
          if (existing.account_id !== tx.account_id || existing.amount !== tx.amount || existing.type !== tx.type || existing.to_account_id !== tx.to_account_id) throw new Error('Operation already recorded with different details');
          return existing;
        }
      }
      await this.commit([{ table: 'transactions', id: tx.id, value: tx }], await this.balances(undefined, tx));
      return tx;
    });
  }
  updateTransaction(id: string, updates: Partial<Omit<Transaction, 'id'>>) {
    return this.run(async () => {
      const old = await this.transactionById(id);
      if (!old) throw new Error('Transaction not found');
      if (old.loan_id || old.operation_id?.startsWith('repayment-')) throw new Error('Loan postings must be corrected through the loan workflow');
      const tx = { ...old, ...updates, id, updated_at: Date.now() } as Transaction;
      validateTransaction(tx, await this.raw.getAccounts());
      tx.amount = money(tx.amount);
      await this.commit([{ table: 'transactions', id, value: tx }], await this.balances(old, tx));
      return tx;
    });
  }
  deleteTransaction(id: string, silent = false) {
    return this.run(async () => {
      const old = await this.transactionById(id);
      if (old?.loan_id && !silent) throw new Error('Loan postings must be corrected through the loan workflow');
      await this.commit([{ table: 'transactions', id }], old ? await this.balances(old) : []);
    });
  }
  createAccount(input: Omit<Account, 'id' | 'created_at'>) {
    return this.run(async () => {
      this.validateAccount(input);
      const existing = await this.raw.getAccounts();
      if (existing.some(a => a.currency !== input.currency)) throw new Error('Use the existing ledger currency; currency conversion is not supported');
      const account: Account = { ...input, balance: money(input.balance), id: generateUUID(), created_at: Date.now(), updated_at: Date.now() };
      const rows: Row[] = [{ table: 'accounts', id: account.id, value: account }];
      if (account.balance !== 0) {
        const id = generateUUID();
        rows.push({ table: 'transactions', id, value: { id, account_id: account.id, amount: Math.abs(account.balance), type: account.balance > 0 ? 'INCOME' : 'EXPENSE', purpose: 'ADJUSTMENT', category: 'Opening Balance', description: 'Initial Opening Balance', date: account.created_at, updated_at: Date.now() } });
      }
      await this.commit(rows); return account;
    });
  }
  private validateAccount(a: Partial<Account>) {
    if (!a.name?.trim() || !/^[A-Z]{3}$/.test(a.currency || '') || !['BANK', 'MOBILE_MONEY', 'CASH', 'CARD', 'SAVINGS'].includes(a.type || '')) throw new Error('Invalid account');
    money(a.balance!); if (money(a.locked_amount ?? 0) < 0) throw new Error('Invalid locked amount');
  }
  updateAccount(input: Account) {
    return this.run(async () => {
      this.validateAccount(input);
      const old = (await this.raw.getAccounts()).find(a => a.id === input.id);
      if (!old) throw new Error('Account not found');
      if (old.currency !== input.currency) throw new Error('Existing account currency cannot be relabeled');
      const account = { ...input, balance: money(input.balance), updated_at: Date.now() };
      const rows: Row[] = [{ table: 'accounts', id: input.id, value: account }];
      const diff = money(account.balance - old.balance);
      if (diff) {
        const id = generateUUID();
        rows.push({ table: 'transactions', id, value: { id, account_id: account.id, amount: Math.abs(diff), type: diff > 0 ? 'INCOME' : 'EXPENSE', purpose: 'ADJUSTMENT', category: 'Balance Adjustment', description: 'Manual Balance Adjustment', date: Date.now(), updated_at: Date.now() } });
      }
      await this.commit(rows);
    });
  }
  deleteAccount(id: string) {
    return this.run(async () => {
      if ((await this.raw.getTransactions({ account_id: id })).length) throw new Error('This account has ledger history. Keep it to preserve financial records.');
      await this.commit([{ table: 'accounts', id }]);
    });
  }
  private validateEntity(table: Table, value: any) {
    if (table === 'meta' && (value.id !== 'categories' || !Array.isArray(value.items) || value.items.some((item: any) => !item || typeof item.id !== 'string' || typeof item.name !== 'string' || !item.name.trim()))) throw new Error('Invalid synced categories');
    if (table === 'accounts') this.validateAccount(value);
    if (table === 'transactions') validateTransaction(value);
    if (table === 'budgets' && (!['MONTHLY', 'WEEKLY'].includes(value.period) || money(value.limit_amount) < 0 || !Number.isFinite(value.start_date) || !Number.isFinite(value.end_date) || value.end_date < value.start_date)) throw new Error('Invalid budget');
    if (table === 'loans' && (!['BORROWED', 'LENT'].includes(value.type) || !['ACTIVE', 'PAID', 'DEFAULTED'].includes(value.status) || money(value.principal_amount) <= 0 || money(value.remaining_balance) < 0 || !Number.isFinite(value.interest_rate) || value.interest_rate < 0 || !Number.isFinite(value.start_date) || !Number.isFinite(value.due_date) || value.due_date < value.start_date)) throw new Error('Invalid loan');
  }
  private save<T extends { id?: string }>(table: Table, input: T) {
    return this.run(async () => {
      this.validateEntity(table, input);
      let extra: Record<string, any> = {};
      if (table === 'loans') {
        const loan = input as unknown as Loan;
        extra = { reminder_at: loanReminderAt(loan), currency: (await this.raw.getAccounts())[0]?.currency || 'ETB', interest_method: 'FLAT_MONTHLY' };
        if (loan.id && !loan.shared_loan_id) {
          const old = (await this.raw.getLoans()).find(l => l.id === loan.id);
          if (old && ['principal_amount', 'interest_rate', 'start_date', 'due_date', 'remaining_balance'].some(k => (old as any)[k] !== (loan as any)[k]) && (await this.raw.getTransactions()).some(t => t.loan_id === loan.id)) throw new Error('Recorded loan amounts cannot be overwritten. Use the payment workflow.');
        }
      }
      const value = { ...input, ...extra, id: input.id || generateUUID(), updated_at: Date.now() };
      await this.commit([{ table, id: value.id, value }]); return value;
    });
  }
  createBudget(input: Omit<Budget, 'id'>): Promise<Budget> { return this.save('budgets', input as Budget); }
  async updateBudget(input: Budget) { await this.save('budgets', input); }
  deleteBudget(id: string) { return this.run(() => this.commit([{ table: 'budgets', id }])); }
  createLoan(input: Omit<Loan, 'id'>): Promise<Loan> { return this.save('loans', input as Loan); }
  async updateLoan(input: Loan) { await this.save('loans', input); }
  deleteLoan(id: string) { return this.run(async () => {
    if ((await this.raw.getTransactions()).some(t => t.loan_id === id)) throw new Error('Keep loans with recorded payments to preserve the cash ledger');
    await this.commit([{ table: 'loans', id }]);
  }); }
  async upsertAccount(a: Account) { await this.save('accounts', a); }
  async upsertTransaction(t: Transaction) { await this.save('transactions', t); }
  async upsertBudget(b: Budget) { await this.save('budgets', b); }
  async upsertLoan(l: Loan) { await this.save('loans', l); }

  allocateLinkedInterest(sharedLoanId: string, repayments: Array<{ id: string; status: string; interestAmount?: number }>) {
    return this.run(async () => {
      const transactions = await this.raw.getTransactions(), rows: Row[] = [];
      for (const repayment of repayments) {
        const ids = [`repayment-record-${repayment.id}`, `repayment-confirm-${sharedLoanId}-${repayment.id}-${this.scope}`];
        const tx = transactions.find(t => t.operation_id && ids.includes(t.operation_id));
        const interest = repayment.status === 'CONFIRMED' ? money(repayment.interestAmount || 0) : 0;
        if (!tx || money(tx.interest_amount || 0) === interest) continue;
        const value = { ...tx, interest_amount: interest, updated_at: Date.now() }; validateTransaction(value);
        rows.push({ table: 'transactions', id: tx.id, value });
      }
      if (rows.length) await this.commit(rows);
    });
  }
  recordLoanPayment(loanId: string, accountId: string, amount: number, operationId: string) {
    return this.run(async () => {
      // buildTransaction derives the id from operation_id, so the keyed lookup
      // catches retries without a scan. A record written by an older build could
      // carry operation_id under a random id, and missing it would double-post a
      // payment, so a miss still falls back to the scan.
      const existing = await this.transactionById(`op-${operationId}`)
        ?? (await this.raw.getTransactions()).find(t => t.operation_id === operationId);
      if (existing) {
        if (existing.loan_id !== loanId || existing.account_id !== accountId || existing.amount !== money(amount)) throw new Error('Payment operation already has different details');
        return existing;
      }
      const loan = (await this.raw.getLoans()).find(l => l.id === loanId);
      if (!loan || loan.shared_loan_id) throw new Error('Use the shared repayment workflow for linked loans');
      if (money(amount) <= 0 || money(amount) > money(loan.remaining_balance)) throw new Error('Payment must not exceed the remaining balance');
      const tx = await this.buildTransaction({ account_id: accountId, amount, type: loan.type === 'LENT' ? 'INCOME' : 'EXPENSE', purpose: 'FINANCING', loan_id: loan.id, operation_id: operationId, category: 'Loan Repayment', description: `Repayment ${loan.type === 'LENT' ? 'from' : 'to'} ${loan.lender_borrower_name}`, date: Date.now() });
      const start = new Date(loan.start_date), due = new Date(loan.due_date);
      const months = Math.max(1, (due.getFullYear() - start.getFullYear()) * 12 + due.getMonth() - start.getMonth() - (due.getDate() < start.getDate() ? 1 : 0));
      const totalInterest = loan.total_interest ?? money(loan.principal_amount * loan.interest_rate / 100 * months / 12);
      const alreadyPaid = Math.max(0, money(loan.principal_amount + totalInterest - loan.remaining_balance));
      const remainingInterest = loan.remaining_interest ?? Math.max(0, money(totalInterest - alreadyPaid));
      const interest = Math.min(amount, remainingInterest);
      tx.interest_amount = money(interest);
      const remaining = money(loan.remaining_balance - amount);
      await this.commit([{ table: 'transactions', id: tx.id, value: tx }, { table: 'loans', id: loan.id, value: { ...loan, total_interest: totalInterest, remaining_interest: money(remainingInterest - interest), remaining_balance: remaining, status: remaining === 0 ? 'PAID' : 'ACTIVE', updated_at: Date.now() } }], await this.balances(undefined, tx));
      return tx;
    });
  }
  createLoanWithCash(input: Omit<Loan, 'id'>, accountId: string, paid: number) {
    return this.run(async () => {
      this.validateEntity('loans', input);
      if (money(paid) < 0 || !Number.isFinite(paid)) throw new Error('Invalid initial payment');
      const start = new Date(input.start_date), due = new Date(input.due_date);
      const months = Math.max(1, (due.getFullYear() - start.getFullYear()) * 12 + due.getMonth() - start.getMonth() - (due.getDate() < start.getDate() ? 1 : 0));
      const totalInterest = money(input.principal_amount * input.interest_rate / 100 * months / 12);
      const total = sumMoney([input.principal_amount, totalInterest]);
      if (money(paid) > total || money(input.remaining_balance) !== money(total - paid)) throw new Error('Loan balance must equal principal plus flat interest minus payments');
      const reminder = new Date(input.due_date);
      reminder.setDate(reminder.getDate() - (input.reminderDaysBefore || 0));
      const clock = input.reminderTime ? new Date(input.reminderTime) : null;
      reminder.setHours(clock?.getHours() ?? 9, clock?.getMinutes() ?? 0, 0, 0);
      if (totalInterest < 0) throw new Error('Invalid loan principal/payment total');
      const loan: Loan = { ...input, currency: (await this.raw.getAccounts())[0]?.currency || 'ETB', reminder_at: reminder.getTime(), status: money(input.remaining_balance) === 0 ? 'PAID' : 'ACTIVE', total_interest: totalInterest, remaining_interest: Math.max(0, money(totalInterest - paid)), interest_method: 'FLAT_MONTHLY', id: generateUUID(), updated_at: Date.now() };
      const tx = await this.buildTransaction({ account_id: accountId, amount: loan.principal_amount, type: loan.type === 'LENT' ? 'EXPENSE' : 'INCOME', purpose: 'FINANCING', loan_id: loan.id, category: 'Loans', description: `Loan ${loan.type === 'LENT' ? 'to' : 'from'} ${loan.lender_borrower_name}`, date: loan.start_date });
      const rows: Row[] = [{ table: 'loans', id: loan.id, value: loan }, { table: 'transactions', id: tx.id, value: tx }];
      const balances = await this.balances(undefined, tx);
      if (paid > 0) {
        const payment = await this.buildTransaction({ account_id: accountId, amount: paid, type: loan.type === 'LENT' ? 'INCOME' : 'EXPENSE', purpose: 'FINANCING', loan_id: loan.id, category: 'Loan Repayment', description: 'Initial loan repayment', date: loan.start_date });
        payment.interest_amount = Math.min(paid, totalInterest);
        rows.push({ table: 'transactions', id: payment.id, value: payment });
        for (const row of balances) row.value.balance = money(row.value.balance + accountDelta(payment, row.id));
      }
      await this.commit(rows, balances); return loan;
    });
  }
  recalculateAccountBalance(id: string) {
    return this.run(async () => {
      const account = (await this.raw.getAccounts()).find(a => a.id === id);
      if (!account) return;
      const balance = sumMoney((await this.raw.getTransactions({ account_id: id })).map(t => accountDelta(t, id)));
      await this.raw.commitRows([{ table: 'accounts', id, value: { ...account, balance } }]); LocalChangeEmitter.emit();
    });
  }
  removeDuplicateTransactions(id: string) {
    return this.run(async () => {
      const seen = new Set<string>(), remove: Row[] = [];
      for (const t of await this.raw.getTransactions({ account_id: id })) {
        const identity = t.sms_id ? `sms:${t.sms_id}` : t.reference_number ? `ref:${t.account_id}:${t.type}:${t.reference_number}` : null;
        if (!identity) continue;
        if (seen.has(identity)) remove.push({ table: 'transactions', id: t.id }); else seen.add(identity);
      }
      const deleted = new Set(remove.map(r => r.id));
      const remaining = (await this.raw.getTransactions()).filter(t => !deleted.has(t.id));
      const balances: Row[] = (await this.raw.getAccounts()).map(a => ({ table: 'accounts', id: a.id, value: { ...a, balance: sumMoney(remaining.map(t => accountDelta(t, a.id))) } }));
      if (remove.length) await this.commit(remove, balances); return remove.length;
    });
  }
  clearAllData() {
    return this.run(async () => {
      const rows: Row[] = [];
      for (const table of tables) for (const item of await this.read(table)) rows.push({ table, id: item.id });
      for (const value of await this.read('meta')) rows.push({ table: 'meta', id: value.id });
      await this.commit(rows);
    });
  }
  restore(data: { accounts: Account[]; transactions: Transaction[]; budgets: Budget[]; loans: Loan[] }, metadata: Record<string, any> = {}) {
    return this.run(async () => {
      const rows: Row[] = [];
      const accounts = new Map((await this.raw.getAccounts()).map(a => [a.id, a]));
      data.accounts.forEach(a => {
        if (accounts.has(a.id) && accounts.get(a.id)!.currency !== a.currency) throw new Error('Backup cannot relabel an existing account currency');
        accounts.set(a.id, a);
      });
      if (new Set([...accounts.values()].map(a => a.currency)).size > 1) throw new Error('Restore requires the same ledger currency');
      for (const table of tables) for (const value of data[table]) {
        this.validateEntity(table, value);
        if (table === 'transactions') validateTransaction(value as Transaction, [...accounts.values()]);
        rows.push({ table, id: value.id, value: { ...value, updated_at: Date.now() } });
      }
      const txs = new Map((await this.raw.getTransactions()).map(t => [t.id, t]));
      data.transactions.forEach(t => txs.set(t.id, t));
      for (const account of data.accounts) {
        const difference = money(account.balance - sumMoney(data.transactions.map(t => accountDelta(t, account.id))));
        if (difference) {
          const row = this.baseline(account, difference);
          if (data.transactions.some(t => t.id === row.id)) throw new Error('Backup balance disagrees with its preserved baseline');
          rows.push(row); txs.set(row.id, row.value);
        }
      }
      const balances: Row[] = [...accounts.values()].map(a => ({ table: 'accounts', id: a.id, value: { ...a, balance: sumMoney([...txs.values()].map(t => accountDelta(t, a.id))) } }));
      await this.commit(rows, balances, metadata);
    });
  }
  async seedOutbox() {
    return this.run(async () => {
      if (await this.raw.readMeta('sync_initialized')) return;
      const rows: Row[] = [];
      for (const table of tables) for (const value of await this.read(table)) rows.push({ table, id: value.id, value });
      for (const value of await this.read('meta')) rows.push({ table: 'meta', id: value.id, value });
      await this.commit(rows, [], { sync_initialized: true });
    });
  }
  resolveConflict(conflict: { key: string; change: Change; remote: any; revision: number }, choice: 'local' | 'cloud') {
    return this.run(async () => {
      const outbox = await this.raw.readMeta('outbox') || {};
      if (outbox[conflict.key]?.token !== conflict.change.token) throw new Error('Local record changed. Synchronize and review again.');
      const revisions = await this.raw.readMeta('revisions') || {};
      const rows: Row[] = [];
      if (choice === 'local') {
        const change = outbox[conflict.key];
        change.base = conflict.revision; change.token = generateUUID();
        if (change.value) {
          change.value = { ...change.value, updated_at: Math.max(Date.now(), Number(conflict.remote?.updated_at || 0)) };
          rows.push({ table: change.table, id: change.id, value: change.value });
        }
      }
      else {
        delete outbox[conflict.key]; revisions[conflict.key] = conflict.revision;
        const remote = conflict.remote;
        let value;
        if (remote && !remote._deleted) {
          const { _revision, _operation, _deleted, _syncedAt, ...data } = remote;
          value = { ...data, id: conflict.change.id }; this.validateEntity(conflict.change.table, value);
        }
        rows.push({ table: conflict.change.table, id: conflict.change.id, value });
        const accounts = await this.raw.getAccounts(), transactions = await this.raw.getTransactions();
        const merged = new Map(transactions.map(t => [t.id, t]));
        if (conflict.change.table === 'transactions') { if (value) merged.set(conflict.change.id, value); else merged.delete(conflict.change.id); }
        for (const account of accounts) {
          if (conflict.change.table === 'accounts' && conflict.change.id === account.id) {
            if (!value && [...merged.values()].some(t => t.account_id === account.id || t.to_account_id === account.id)) throw new Error('Cannot remove an account that still has ledger history');
            if (value) value.balance = sumMoney([...merged.values()].map(t => accountDelta(t, account.id)));
            continue;
          }
          rows.push({ table: 'accounts', id: account.id, value: { ...account, balance: sumMoney([...merged.values()].map(t => accountDelta(t, account.id))) } });
        }
      }
      const conflicts = (await this.raw.readMeta('sync_conflicts') || []).filter((item: any) => item.key !== conflict.key);
      await this.rawCommit(rows, { outbox, revisions, sync_conflicts: conflicts });
      LocalChangeEmitter.emit();
    });
  }
  acknowledge(changes: Change[], revisions: Record<string, number>) {
    return this.run(async () => {
      const outbox: Record<string, Change> = await this.raw.readMeta('outbox') || {};
      const known = await this.raw.readMeta('revisions') || {};
      for (const change of changes) {
        const k = key(change); known[k] = revisions[k];
        if (outbox[k]?.token === change.token) delete outbox[k];
        else if (outbox[k]) outbox[k].base = revisions[k];
      }
      await this.raw.commitRows([], { outbox, revisions: known });
    });
  }
  applyRemote(changes: Array<Row & { revision: number }>) {
    return this.run(async () => {
      const outbox = await this.raw.readMeta('outbox') || {}, revisions = await this.raw.readMeta('revisions') || {};
      const rows: Row[] = [];
      for (const change of changes) {
        const k = key(change);
        if (outbox[k] || (revisions[k] !== undefined && change.revision <= revisions[k])) continue;
        let row: Row = change;
        if (change.table === 'loans' && change.value && !Number.isFinite(change.value.reminder_at)) {
          const value = { ...change.value, reminder_at: loanReminderAt(change.value), updated_at: Date.now() };
          row = { table: 'loans', id: change.id, value };
          // Persist the derived field remotely so the indexed scheduler can see
          // loans created by builds that predate reminder_at.
          outbox[k] = { ...row, token: generateUUID(), base: change.revision };
        }
        if (row.value) this.validateEntity(row.table, row.value);
        rows.push(row); revisions[k] = change.revision;
      }
      // Derived balances are rebuilt from the combined ledger in the same commit.
      const accounts = new Map((await this.raw.getAccounts()).map(a => [a.id, a]));
      const txs = new Map((await this.raw.getTransactions()).map(t => [t.id, t]));
      for (const row of rows) {
        const target = row.table === 'accounts' ? accounts : row.table === 'transactions' ? txs : null;
        if (target) { if (row.value) target.set(row.id, row.value); else target.delete(row.id); }
      }
      // Older cloud clients stored a balance without necessarily posting its opening entry.
      // Preserve that baseline once, with a deterministic ID shared by all upgrading devices.
      for (const change of changes) {
        if (change.table !== 'accounts' || change.revision !== 0 || !change.value || !rows.includes(change)) continue;
        const a = accounts.get(change.id)!;
        const baselineId = `baseline-${a.id}`;
        if (txs.has(baselineId)) continue;
        const difference = money(a.balance - sumMoney([...txs.values()].map(t => accountDelta(t, a.id))));
        if (!difference) continue;
        const row = this.baseline(a, difference);
        rows.push(row); txs.set(row.id, row.value);
        outbox[key(row)] = { ...row, token: generateUUID(), base: revisions[key(row)] || 0 };
      }
      if (new Set([...accounts.values()].map(a => a.currency)).size > 1) throw new Error('Cloud records contain multiple ledger currencies; resolve them before merging');
      for (const tx of txs.values()) validateTransaction(tx, [...accounts.values()]);
      for (const a of accounts.values()) rows.push({ table: 'accounts', id: a.id, value: { ...a, balance: sumMoney([...txs.values()].map(t => accountDelta(t, a.id))) } });
      await this.rawCommit(rows, { revisions, outbox });
      if (changes.length) LocalChangeEmitter.emit();
    });
  }
}
