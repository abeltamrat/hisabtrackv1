import { Account, Loan, RecurringFrequency, RecurringTransaction } from '@/types/database';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_FORECAST_OCCURRENCES = 730;

export type ForecastEventType = 'INCOME' | 'EXPENSE' | 'TRANSFER' | 'LOAN_DUE';

export interface ForecastEvent {
  id: string;
  title: string;
  category: string;
  amount: number;
  date: number;
  type: ForecastEventType;
  source: 'recurring' | 'loan';
  accountId?: string;
  toAccountId?: string;
  balanceAfter?: number;
}

export interface ForecastSnapshot {
  date: number;
  totalBalance: number;
}

export interface ForecastAccountProjection {
  accountId: string;
  accountName: string;
  currentBalance: number;
  projectedBalance: number;
  delta: number;
  isVirtual?: boolean;
}

export interface ForecastResult {
  startingBalance: number;
  projectedBalance: number;
  lowestBalance: number;
  lowestBalanceDate: number | null;
  upcomingIncome: number;
  upcomingExpense: number;
  upcomingLoanPayments: number;
  events: ForecastEvent[];
  snapshots: ForecastSnapshot[];
  largeExpenses: ForecastEvent[];
  accountProjections: ForecastAccountProjection[];
}

interface ForecastOptions {
  accounts: Account[];
  recurring: RecurringTransaction[];
  loans: Loan[];
  days: number;
  startDate?: number;
}

export class ForecastService {
  static readonly LOAN_OBLIGATION_ID = '__loan_obligations__';
  static readonly LOAN_OBLIGATION_NAME = 'Loan obligations';

  static generateForecast(options: ForecastOptions): ForecastResult {
    const startDate = this.startOfDay(options.startDate ?? Date.now());
    const safeDays = Math.max(1, options.days);
    const endDate = this.endOfDay(startDate + (safeDays - 1) * DAY_MS);

    const accountNames = new Map(options.accounts.map((account) => [account.id, account.name]));
    const currentBalances = new Map(options.accounts.map((account) => [account.id, account.balance]));
    const projectedBalances = new Map(currentBalances);

    const startingBalance = options.accounts.reduce((sum, account) => sum + account.balance, 0);
    let runningBalance = startingBalance;
    let lowestBalance = startingBalance;
    let lowestBalanceDate: number | null = startDate;

    const events = [
      ...this.generateRecurringEvents(options.recurring, startDate, endDate),
      ...this.generateLoanEvents(options.loans, startDate, endDate),
    ].sort((left, right) => left.date - right.date || left.amount - right.amount);

    const snapshots: ForecastSnapshot[] = [];
    let eventIndex = 0;

    for (let currentDay = startDate; currentDay <= endDate; currentDay += DAY_MS) {
      while (eventIndex < events.length && this.isSameDay(events[eventIndex].date, currentDay)) {
        const event = events[eventIndex];

        switch (event.type) {
          case 'INCOME':
            if (event.accountId) {
              projectedBalances.set(
                event.accountId,
                (projectedBalances.get(event.accountId) ?? 0) + event.amount
              );
              if (!accountNames.has(event.accountId)) {
                accountNames.set(event.accountId, 'Missing account');
                currentBalances.set(event.accountId, 0);
              }
            }
            runningBalance += event.amount;
            break;
          case 'EXPENSE':
            if (event.accountId) {
              projectedBalances.set(
                event.accountId,
                (projectedBalances.get(event.accountId) ?? 0) - event.amount
              );
              if (!accountNames.has(event.accountId)) {
                accountNames.set(event.accountId, 'Missing account');
                currentBalances.set(event.accountId, 0);
              }
            }
            runningBalance -= event.amount;
            break;
          case 'TRANSFER':
            if (event.accountId) {
              projectedBalances.set(
                event.accountId,
                (projectedBalances.get(event.accountId) ?? 0) - event.amount
              );
              if (!accountNames.has(event.accountId)) {
                accountNames.set(event.accountId, 'Missing account');
                currentBalances.set(event.accountId, 0);
              }
            }
            if (event.toAccountId) {
              projectedBalances.set(
                event.toAccountId,
                (projectedBalances.get(event.toAccountId) ?? 0) + event.amount
              );
              if (!accountNames.has(event.toAccountId)) {
                accountNames.set(event.toAccountId, 'Missing account');
                currentBalances.set(event.toAccountId, 0);
              }
            }
            break;
          case 'LOAN_DUE':
            projectedBalances.set(
              this.LOAN_OBLIGATION_ID,
              (projectedBalances.get(this.LOAN_OBLIGATION_ID) ?? 0) - event.amount
            );
            if (!accountNames.has(this.LOAN_OBLIGATION_ID)) {
              accountNames.set(this.LOAN_OBLIGATION_ID, this.LOAN_OBLIGATION_NAME);
              currentBalances.set(this.LOAN_OBLIGATION_ID, 0);
            }
            runningBalance -= event.amount;
            break;
        }

        event.balanceAfter = runningBalance;

        if (runningBalance < lowestBalance) {
          lowestBalance = runningBalance;
          lowestBalanceDate = event.date;
        }

        eventIndex += 1;
      }

      snapshots.push({
        date: currentDay,
        totalBalance: runningBalance,
      });

      if (runningBalance < lowestBalance) {
        lowestBalance = runningBalance;
        lowestBalanceDate = currentDay;
      }
    }

    const accountProjections = [...projectedBalances.entries()].map(([accountId, projectedBalance]) => {
      const currentBalance = currentBalances.get(accountId) ?? 0;
      return {
        accountId,
        accountName: accountNames.get(accountId) ?? 'Unknown account',
        currentBalance,
        projectedBalance,
        delta: projectedBalance - currentBalance,
        isVirtual: accountId === this.LOAN_OBLIGATION_ID,
      };
    }).sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta));

    const upcomingIncome = events
      .filter((event) => event.type === 'INCOME')
      .reduce((sum, event) => sum + event.amount, 0);

    const upcomingExpense = events
      .filter((event) => event.type === 'EXPENSE')
      .reduce((sum, event) => sum + event.amount, 0);

    const upcomingLoanPayments = events
      .filter((event) => event.type === 'LOAN_DUE')
      .reduce((sum, event) => sum + event.amount, 0);

    const largeExpenses = events
      .filter((event) => event.type === 'EXPENSE' || event.type === 'LOAN_DUE')
      .sort((left, right) => right.amount - left.amount || left.date - right.date)
      .slice(0, 5);

    return {
      startingBalance,
      projectedBalance: runningBalance,
      lowestBalance,
      lowestBalanceDate,
      upcomingIncome,
      upcomingExpense,
      upcomingLoanPayments,
      events,
      snapshots,
      largeExpenses,
      accountProjections,
    };
  }

  private static generateRecurringEvents(
    recurringTransactions: RecurringTransaction[],
    startDate: number,
    endDate: number
  ): ForecastEvent[] {
    const events: ForecastEvent[] = [];

    for (const recurring of recurringTransactions) {
      if (!recurring.isActive) continue;

      let currentDate = recurring.nextDate;
      let generatedCount = 0;

      while (currentDate < startDate && generatedCount < MAX_FORECAST_OCCURRENCES) {
        if (recurring.endDate && currentDate > recurring.endDate) break;
        if (
          recurring.totalRepetitions &&
          recurring.completedRepetitions + generatedCount >= recurring.totalRepetitions
        ) {
          break;
        }

        currentDate = this.incrementDate(recurring.frequency, currentDate);
        generatedCount += 1;
      }

      while (currentDate <= endDate && generatedCount < MAX_FORECAST_OCCURRENCES) {
        if (recurring.endDate && currentDate > recurring.endDate) break;
        if (
          recurring.totalRepetitions &&
          recurring.completedRepetitions + generatedCount >= recurring.totalRepetitions
        ) {
          break;
        }

        events.push({
          id: `${recurring.id}:${currentDate}`,
          title: recurring.name,
          category: recurring.category,
          amount: recurring.amount,
          date: currentDate,
          type: recurring.type,
          source: 'recurring',
          accountId: recurring.accountId,
          toAccountId: recurring.toAccountId,
        });

        currentDate = this.incrementDate(recurring.frequency, currentDate);
        generatedCount += 1;
      }
    }

    return events;
  }

  private static generateLoanEvents(loans: Loan[], startDate: number, endDate: number): ForecastEvent[] {
    return loans
      .filter(
        (loan) =>
          loan.status === 'ACTIVE' &&
          loan.type === 'BORROWED' &&
          loan.due_date >= startDate &&
          loan.due_date <= endDate &&
          loan.remaining_balance > 0
      )
      .map((loan) => ({
        id: `loan:${loan.id}`,
        title: `Loan payment - ${loan.lender_borrower_name}`,
        category: 'Loan Repayment',
        amount: loan.remaining_balance,
        date: loan.due_date,
        type: 'LOAN_DUE' as const,
        source: 'loan' as const,
      }));
  }

  private static incrementDate(frequency: RecurringFrequency, dateMs: number): number {
    const nextDate = new Date(dateMs);

    switch (frequency) {
      case 'DAILY':
        nextDate.setDate(nextDate.getDate() + 1);
        break;
      case 'WEEKLY':
        nextDate.setDate(nextDate.getDate() + 7);
        break;
      case 'MONTHLY':
        nextDate.setMonth(nextDate.getMonth() + 1);
        break;
      case 'YEARLY':
        nextDate.setFullYear(nextDate.getFullYear() + 1);
        break;
    }

    return nextDate.getTime();
  }

  private static startOfDay(timestamp: number) {
    const date = new Date(timestamp);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }

  private static endOfDay(timestamp: number) {
    const date = new Date(timestamp);
    date.setHours(23, 59, 59, 999);
    return date.getTime();
  }

  private static isSameDay(left: number, right: number) {
    return this.startOfDay(left) === this.startOfDay(right);
  }
}

export default ForecastService;
