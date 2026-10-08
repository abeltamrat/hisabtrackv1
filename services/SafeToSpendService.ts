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
}

export class SafeToSpendService {
  /**
   * The amount that can leave each account today while every forecasted daily
   * balance still stays at or above that account's reserve. Locked money has
   * already been removed from ForecastService's account balances.
   */
  static calculate(accounts: Account[], forecast: ForecastResult): SafeToSpendResult {
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
    return {
      total: money(Math.max(0, sumMoney(rows.map(row => row.safeToSpend)) - unassignedCommitments)),
      accounts: rows,
      horizonEnd: forecast.snapshots.at(-1)?.date ?? null,
      unassignedCommitments,
    };
  }
}

export default SafeToSpendService;
