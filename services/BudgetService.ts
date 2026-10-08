import { money, operatingTransactions, sumMoney } from '@/utils/finance';
import { Budget, BudgetPeriod, BudgetRolloverMode, Transaction } from '@/types/database';
import { ethiopianMonthBounds } from '@/utils/ethiopianCalendar';

export interface BudgetMetrics {
  budget: Budget;
  baseLimit: number;
  effectiveLimit: number;
  spent: number;
  remaining: number;
  progress: number;
  rolloverDelta: number;
  rolloverMode: BudgetRolloverMode;
  previousBudget?: Budget;
}

export interface BudgetPace {
  elapsedDays: number;
  totalDays: number;
  remainingDays: number;
  dailySpend: number;
  projectedSpend: number;
  exhaustionDate: number | null;
  hasEnoughHistory: boolean;
}

export interface BudgetSuggestion {
  category: string;
  period: BudgetPeriod;
  suggestedLimit: number;
  periodSpending: number[];
}

export interface BudgetMetricOptions {
  excludeTransactionId?: string;
  includedCategories?: string[];
}

export class BudgetService {
  static hierarchyAllocationIssue(options: {
    category: string;
    amount: number;
    period: BudgetPeriod;
    range: { start: number; end: number };
    budgets: Budget[];
    excludeId?: string;
    parentCategory?: string;
    descendantCategories?: string[];
  }): string | null {
    const active = options.budgets.filter(budget =>
      budget.id !== options.excludeId && budget.period === options.period &&
      budget.start_date <= options.range.end && budget.end_date >= options.range.start
    );
    if (options.parentCategory) {
      const parent = active.find(budget => budget.category === options.parentCategory);
      if (parent) {
        const siblingTotal = sumMoney(active
          .filter(budget => budget.category !== options.parentCategory && (options.descendantCategories || []).includes(budget.category))
          .map(budget => this.getBaseLimit(budget)));
        if (money(siblingTotal + options.amount) > this.getBaseLimit(parent)) {
          return `Child budgets would total ${money(siblingTotal + options.amount).toFixed(2)}, above the ${this.getBaseLimit(parent).toFixed(2)} ${options.parentCategory} budget.`;
        }
      }
    } else if (options.descendantCategories?.length) {
      const childTotal = sumMoney(active.filter(budget => options.descendantCategories!.includes(budget.category)).map(budget => this.getBaseLimit(budget)));
      if (options.amount < childTotal) return `This parent limit cannot be below its ${childTotal.toFixed(2)} of child budgets.`;
    }
    return null;
  }
  static calculatePace(metrics: BudgetMetrics, now = Date.now()): BudgetPace {
    const start = new Date(metrics.budget.start_date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(metrics.budget.end_date);
    end.setHours(23, 59, 59, 999);
    const cursor = Math.min(Math.max(now, start.getTime()), end.getTime());
    const calendarDay = (value: number) => {
      const date = new Date(value);
      return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
    };
    const elapsedDays = Math.max(1, calendarDay(cursor) - calendarDay(start.getTime()) + 1);
    const totalDays = Math.max(1, calendarDay(end.getTime()) - calendarDay(start.getTime()) + 1);
    const dailySpend = metrics.spent > 0 ? metrics.spent / elapsedDays : 0;
    const projectedSpend = money(dailySpend * totalDays);
    const daysToLimit = dailySpend > 0 ? Math.ceil(metrics.effectiveLimit / dailySpend) : Infinity;
    let exhaustionDate: number | null = null;
    if (Number.isFinite(daysToLimit) && daysToLimit <= totalDays) {
      const exhausted = new Date(start);
      exhausted.setDate(exhausted.getDate() + Math.max(0, daysToLimit - 1));
      exhaustionDate = Math.min(end.getTime(), exhausted.getTime());
    }
    return {
      elapsedDays,
      totalDays,
      remainingDays: Math.max(0, totalDays - elapsedDays),
      dailySpend: money(dailySpend),
      projectedSpend,
      exhaustionDate,
      hasEnoughHistory: elapsedDays >= 3 && metrics.spent > 0,
    };
  }

  static suggestLimits(
    transactions: Transaction[],
    categories: string[],
    period: BudgetPeriod = 'MONTHLY',
    now = Date.now(),
  ): BudgetSuggestion[] {
    const current = this.getCurrentPeriodRange(period, now);
    const ranges: Array<{ start: number; end: number }> = [];
    let cursor = current.start;
    for (let index = 0; index < 3; index += 1) {
      if (period === 'WEEKLY') {
        const end = cursor - 1;
        const startDate = new Date(cursor);
        startDate.setDate(startDate.getDate() - 7);
        ranges.unshift({ start: startDate.getTime(), end });
        cursor = startDate.getTime();
      } else {
        const date = new Date(cursor);
        const start = new Date(date.getFullYear(), date.getMonth() - 1, 1);
        start.setHours(0, 0, 0, 0);
        const end = new Date(date.getFullYear(), date.getMonth(), 0);
        end.setHours(23, 59, 59, 999);
        ranges.unshift({ start: start.getTime(), end: end.getTime() });
        cursor = start.getTime();
      }
    }

    const expenses = operatingTransactions(transactions).filter(transaction => transaction.type === 'EXPENSE');
    if (!expenses.length || Math.min(...expenses.map(transaction => transaction.date)) > ranges[0].start) return [];

    return categories.map(category => {
      const periodSpending = ranges.map(range => sumMoney(expenses
        .filter(transaction => transaction.category === category && transaction.date >= range.start && transaction.date <= range.end)
        .map(transaction => transaction.amount)));
      const sorted = [...periodSpending].sort((left, right) => left - right);
      return {
        category,
        period,
        suggestedLimit: money(sorted[1]),
        periodSpending,
      };
    }).filter(suggestion => suggestion.suggestedLimit > 0)
      .sort((left, right) => right.suggestedLimit - left.suggestedLimit || left.category.localeCompare(right.category));
  }
  static getRolloverMode(budget: Budget): BudgetRolloverMode {
    return budget.rollover_mode ?? 'NONE';
  }

  static getBaseLimit(budget: Budget) {
    return budget.base_limit_amount ?? budget.limit_amount;
  }

  static calculateBudgetSpent(
    budget: Budget,
    transactions: Transaction[],
    options?: BudgetMetricOptions
  ) {
    return sumMoney(operatingTransactions(transactions)
      .filter(
        (transaction) =>
          transaction.type === 'EXPENSE' &&
          (options?.includedCategories || [budget.category]).includes(transaction.category) &&
          transaction.date >= budget.start_date &&
          transaction.date <= Math.min(budget.end_date, Date.now()) &&
          (!options?.excludeTransactionId || transaction.id !== options.excludeTransactionId)
      )
      .map(transaction => transaction.amount));
  }

  static calculateBudgetMetrics(
    budget: Budget,
    allBudgets: Budget[],
    transactions: Transaction[],
    options?: BudgetMetricOptions
  ): BudgetMetrics {
    return this.calculateBudgetMetricsInternal(
      budget,
      allBudgets,
      transactions,
      new Map<string, BudgetMetrics>(),
      options
    );
  }

  static calculateBudgetCollectionMetrics(
    budgets: Budget[],
    allBudgets: Budget[],
    transactions: Transaction[],
    categoryScopes: Record<string, string[]> = {},
  ) {
    const cache = new Map<string, BudgetMetrics>();
    return budgets.map((budget) =>
      this.calculateBudgetMetricsInternal(budget, allBudgets, transactions, cache, {
        includedCategories: categoryScopes[budget.category] || [budget.category],
      })
    );
  }

  static getCurrentPeriodRange(period: BudgetPeriod, now = Date.now(), calendar: 'GREGORIAN' | 'ETHIOPIAN' = 'GREGORIAN') {
    const date = new Date(now);

    if (period === 'WEEKLY') {
      const day = date.getDay();
      const diffToMonday = (day + 6) % 7;
      const start = new Date(date);
      start.setDate(date.getDate() - diffToMonday);
      start.setHours(0, 0, 0, 0);

      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      end.setTime(end.getTime() - 1);
      return {
        start: start.getTime(),
        end: end.getTime(),
      };
    }

    if (calendar === 'ETHIOPIAN') return ethiopianMonthBounds(now);
    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    end.setHours(23, 59, 59, 999);
    return {
      start: start.getTime(),
      end: end.getTime(),
    };
  }

  /** The period immediately after the one ending at `end`, kept contiguous. */
  static getNextPeriodRange(period: BudgetPeriod, end: number, calendar: 'GREGORIAN' | 'ETHIOPIAN' = 'GREGORIAN') {
    // `findPreviousBudget` links a chain by requiring exactly 1ms between a
    // period's end and the next one's start, so the next period must begin on
    // that millisecond or the rollover chain silently breaks.
    const start = end + 1;
    if (period === 'WEEKLY') {
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      return { start, end: end.getTime() - 1 };
    }
    if (calendar === 'ETHIOPIAN') return ethiopianMonthBounds(start);
    const date = new Date(start);
    const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    last.setHours(23, 59, 59, 999);
    return { start, end: last.getTime() };
  }

  /**
   * Budgets are stored one row per period, and nothing used to create the next
   * one — so on the 1st of the month every budget fell outside the active
   * window and the screen looked as though the user's budgets and their
   * accumulated carry-over had been deleted.
   *
   * This returns the rows needed to extend each category's chain up to the
   * period covering `now`. It is pure so the behaviour is testable, and
   * idempotent: a category whose latest period already covers `now` yields
   * nothing, so repeated calls never duplicate a budget.
   */
  static planRollForward(budgets: Budget[], now = Date.now(), maxPeriods = 24): Budget[] {
    const latestByChain = new Map<string, Budget>();
    for (const budget of budgets) {
      const key = `${budget.category}|${budget.period}|${budget.calendar_system || 'GREGORIAN'}`;
      const current = latestByChain.get(key);
      if (!current || budget.end_date > current.end_date) latestByChain.set(key, budget);
    }

    const planned: Budget[] = [];
    for (const latest of latestByChain.values()) {
      // Already covers now (or is scheduled ahead of it): nothing to do.
      if (latest.end_date >= now) continue;

      let cursor = latest;
      let created = 0;
      while (cursor.end_date < now && created < maxPeriods) {
        const range = this.getNextPeriodRange(cursor.period, cursor.end_date, cursor.calendar_system || 'GREGORIAN');
        const next: Budget = {
          // Every device derives the same key for the same category and period.
          // This makes concurrent roll-forward an upsert instead of two rows.
          id: `rollover-${latest.period}-${range.start}-${encodeURIComponent(latest.category)}`,
          category: latest.category,
          period: latest.period,
          calendar_system: latest.calendar_system,
          // The user's intended limit, not a limit already adjusted by rollover.
          limit_amount: this.getBaseLimit(latest),
          base_limit_amount: this.getBaseLimit(latest),
          rollover_mode: this.getRolloverMode(latest),
          start_date: range.start,
          end_date: range.end,
        };
        planned.push(next);
        cursor = next;
        created += 1;
      }

      // A chain stale by more than maxPeriods is not worth reconstructing, and
      // carrying a year-old surplus forward would be misleading. Start clean at
      // the current period instead.
      if (cursor.end_date < now) {
        const range = this.getCurrentPeriodRange(latest.period, now, latest.calendar_system || 'GREGORIAN');
        while (planned.length && planned[planned.length - 1].category === latest.category
          && planned[planned.length - 1].period === latest.period) planned.pop();
        planned.push({
          id: `rollover-${latest.period}-${range.start}-${encodeURIComponent(latest.category)}`,
          category: latest.category,
          period: latest.period,
          calendar_system: latest.calendar_system,
          limit_amount: this.getBaseLimit(latest),
          base_limit_amount: this.getBaseLimit(latest),
          rollover_mode: 'NONE',
          start_date: range.start,
          end_date: range.end,
        });
      }
    }
    return planned;
  }

  private static calculateBudgetMetricsInternal(
    budget: Budget,
    allBudgets: Budget[],
    transactions: Transaction[],
    cache: Map<string, BudgetMetrics>,
    options?: BudgetMetricOptions
  ): BudgetMetrics {
    const cached = cache.get(budget.id);
    if (cached) {
      return cached;
    }

    const rolloverMode = this.getRolloverMode(budget);
    const baseLimit = this.getBaseLimit(budget);
    const previousBudget = this.findPreviousBudget(budget, allBudgets);

    let rolloverDelta = 0;
    if (previousBudget && rolloverMode !== 'NONE') {
      const previousMetrics = this.calculateBudgetMetricsInternal(
        previousBudget,
        allBudgets,
        transactions,
        cache,
        options
      );

      if (rolloverMode === 'CARRY_UNUSED' && previousMetrics.remaining > 0) {
        rolloverDelta = previousMetrics.remaining;
      } else if (rolloverMode === 'REDUCE_NEXT' && previousMetrics.remaining < 0) {
        rolloverDelta = previousMetrics.remaining;
      }
    }

    const effectiveLimit = Math.max(0, baseLimit + rolloverDelta);
    const spent = this.calculateBudgetSpent(budget, transactions, options);
    const remaining = effectiveLimit - spent;
    const progress = effectiveLimit > 0 ? Math.min((spent / effectiveLimit) * 100, 100) : spent > 0 ? 100 : 0;

    const metrics: BudgetMetrics = {
      budget,
      baseLimit,
      effectiveLimit,
      spent,
      remaining,
      progress,
      rolloverDelta,
      rolloverMode,
      previousBudget,
    };

    cache.set(budget.id, metrics);
    return metrics;
  }

  private static findPreviousBudget(budget: Budget, allBudgets: Budget[]) {
    return allBudgets
      .filter(
        (candidate) =>
          candidate.id !== budget.id &&
          candidate.category === budget.category &&
          candidate.period === budget.period &&
          candidate.end_date < budget.start_date &&
          budget.start_date - candidate.end_date <= 1
      )
      .sort((left, right) => right.end_date - left.end_date)[0];
  }
}

export default BudgetService;
