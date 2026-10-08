import type { Account } from '@/types/database';
import type { ForecastResult } from '@/services/ForecastService';
import { money, sumMoney } from '@/utils/finance';

export interface SafeToSpendAccount {
  accountId: string;
  accountName: string;
  currentBalance: number;
  lockedAmount: number;
  reserveAmount: number;
  lowestProjectedBalance: number;
  plannedNetChange: number;
  safeToSpend: number;
}

export interface SafeToSpendResult {
  total: number;
  accounts: SafeToSpendAccount[];
  horizonEnd: number | null;
  unassignedCommitments: number;
  confirmedUpcomingIncome: number;
  scheduledOutflows: number;
  uncertainIncome: number;
  unresolvedBalanceGaps: number;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  limitations: string[];
}

export class SafeToSpendService {
  /**
   * The amount that can leave each account today while every forecasted daily
   * balance still stays at or above that account's reserve. Locked money has
   * already been removed from ForecastService's account balances.
   */
  static calculate(accounts: Account[], forecast: ForecastResult, unresolvedBalanceGaps = 0): SafeToSpendResult {
    const rows = accounts.map((account) => {
      const unlockedNow = money(account.balance - (account.locked_amount || 0));
      const projected = forecast.snapshots.map(snapshot =>
        money(snapshot.accountBalances[account.id] ?? unlockedNow)
      );
      const lowestProjectedBalance = projected.length ? Math.min(unlockedNow, ...projected) : unlockedNow;
      const reserveAmount = money(Math.max(0, account.reserve_amount || 0));
      return {
        accountId: account.id,
        accountName: account.name,
        currentBalance: money(account.balance),
        lockedAmount: money(Math.max(0, account.locked_amount || 0)),
        reserveAmount,
        lowestProjectedBalance: money(lowestProjectedBalance),
        plannedNetChange: money((projected.at(-1) ?? unlockedNow) - unlockedNow),
        safeToSpend: money(Math.max(0, lowestProjectedBalance - reserveAmount)),
      };
    });

    const unassignedCommitments = money(Math.max(0, forecast.upcomingLoanPayments));
    const transferCosts = sumMoney(forecast.events.filter(event => event.type === 'TRANSFER').map(event => money((event.fees || 0) + (event.tax || 0))));
    const scheduledOutflows = sumMoney([forecast.upcomingExpense, forecast.upcomingLoanPayments, transferCosts]);
    const uncertainIncome = sumMoney(forecast.inferredIncome.map(item => item.amount));
    const limitations = [
      ...(unresolvedBalanceGaps > 0 ? [`${unresolvedBalanceGaps} unresolved bank balance gap${unresolvedBalanceGaps === 1 ? '' : 's'}`] : []),
      ...(uncertainIncome > 0 ? ['inferred income is shown separately and is not spendable yet'] : []),
    ];
    return {
      total: money(Math.max(0, sumMoney(rows.map(row => row.safeToSpend)) - unassignedCommitments)),
      accounts: rows,
      horizonEnd: forecast.snapshots.at(-1)?.date ?? null,
      unassignedCommitments,
      confirmedUpcomingIncome: forecast.upcomingIncome,
      scheduledOutflows,
      uncertainIncome,
      unresolvedBalanceGaps,
      confidence: unresolvedBalanceGaps > 0 ? 'LOW' : forecast.inferredIncome.length > 0 ? 'MEDIUM' : 'HIGH',
      limitations,
    };
  }
}

export default SafeToSpendService;
