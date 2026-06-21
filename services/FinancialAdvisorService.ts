import BudgetService from '@/services/BudgetService';
import { Budget, Loan, RecurringTransaction, Transaction } from '@/types/database';

export interface FinancialInsight {
  id: string;
  type: 'warning' | 'success' | 'info' | 'suggestion';
  title: string;
  description: string;
  icon: string;
  color: string;
  priority: number;
}

export class FinancialAdvisorService {
  /**
   * Analyze transactions and provide intelligent insights
   */
  static analyzeTransactions(
    transactions: Transaction[],
    previousPeriodTransactions: Transaction[] = [],
    budgets: Budget[] = [],
    loans: Loan[] = [],
    recurring: RecurringTransaction[] = []
  ): FinancialInsight[] {
    const insights: FinancialInsight[] = [];

    // Calculate basic metrics
    const income = this.getTotalByType(transactions, 'INCOME');
    const expenses = this.getTotalByType(transactions, 'EXPENSE');
    const balance = income - expenses;

    // Previous period metrics
    const prevIncome = this.getTotalByType(previousPeriodTransactions, 'INCOME');
    const prevExpenses = this.getTotalByType(previousPeriodTransactions, 'EXPENSE');

    // 1. Overall financial health
    insights.push(...this.analyzeFinancialHealth(income, expenses, balance));

    // 2. Spending patterns
    insights.push(...this.analyzeSpendingPatterns(transactions));

    // 3. Category analysis
    insights.push(...this.analyzeCategorySpending(transactions));

    // 4. Month-over-month trends
    if (previousPeriodTransactions.length > 0) {
      insights.push(...this.analyzeTrends(income, expenses, prevIncome, prevExpenses));
    }

    // 5. Unusual transactions
    insights.push(...this.detectAnomalies(transactions));

    // 6. Savings opportunities
    insights.push(...this.findSavingsOpportunities(transactions, income, expenses));

    // 7. NEW: Subscription Detection
    insights.push(...this.detectSubscriptions(transactions, recurring));

    // 8. NEW: Debt Risk Analysis
    insights.push(...this.analyzeDebtRisk(loans, income));

    // 9. NEW: Cash Flow Prediction
    insights.push(...this.predictCashFlow(balance, recurring, loans));

    // 10. NEW: Budget Adherence
    insights.push(...this.analyzeBudgetAdherence(transactions, budgets));

    // 11. NEW: Day of Week Analysis
    insights.push(...this.analyzeDayOfWeekSpending(transactions));

    // 12. NEW: Merchant Concentration
    insights.push(...this.analyzeMerchantConcentration(transactions));

    // 13. NEW: Financial Runway
    insights.push(...this.analyzeRunway(balance, expenses));

    // 14. NEW: Savings Velocity
    if (previousPeriodTransactions.length > 0) {
      insights.push(...this.analyzeSavingsVelocity(income, expenses, prevIncome, prevExpenses));
    }

    // 15. NEW: Archetype Detection
    insights.push(...this.detectArchetype(income, expenses, transactions));

    // 16. NEW: Savvy Optimization
    insights.push(...this.analyzeOptimization(transactions, expenses));

    // 17. NEW: Liquidity Check
    insights.push(...this.analyzeLiquidity(transactions, balance));

    // 18. NEW: Fixed Cost Analysis
    insights.push(...this.analyzeFixedCosts(recurring, expenses));

    // 19. NEW: The Latte Factor
    insights.push(...this.analyzeSmallFrequentPurchases(transactions));

    // Sort by priority (higher priority first)
    return insights.sort((a, b) => b.priority - a.priority).slice(0, 10);
  }

  private static analyzeOptimization(transactions: Transaction[], totalExpenses: number): FinancialInsight[] {
    const insights: FinancialInsight[] = [];
    if (totalExpenses <= 0) return insights;

    const categoryTotals = this.groupByCategory(transactions.filter(t => t.type === 'EXPENSE'));
    const entries = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);

    if (entries.length > 0) {
      const [topCat, amount] = entries[0];
      const potentialSaving = amount * 0.15; // Aim for 15% reduction in top category

      insights.push({
        id: 'optimization-tip',
        type: 'suggestion',
        title: '💡 Quick Win',
        description: `Reducing "${topCat}" spending by prefix 15% would save you $${potentialSaving.toFixed(0)} this period.`,
        icon: 'lightbulb-o',
        color: '#eab308',
        priority: 48,
      });
    }

    return insights;
  }

  private static analyzeLiquidity(transactions: Transaction[], balance: number): FinancialInsight[] {
    const insights: FinancialInsight[] = [];
    const expenses = transactions.filter(t => t.type === 'EXPENSE');
    if (expenses.length < 5) return insights;

    const dailyExp = this.getTotalByType(transactions, 'EXPENSE') / 30; // Rough monthly to daily
    if (dailyExp > 0) {
      const daysOfSurvival = balance / dailyExp;

      if (daysOfSurvival < 7) {
        insights.push({
          id: 'low-liquidity',
          type: 'warning',
          title: '🌊 Liquidity Warning',
          description: `Your current cash covers less than ${daysOfSurvival.toFixed(0)} days of average spending.`,
          icon: 'tint',
          color: '#ef4444',
          priority: 97,
        });
      } else {
        insights.push({
          id: 'liquidity-info',
          type: 'info',
          title: '💧 Cash Buffer',
          description: `You have ${daysOfSurvival.toFixed(0)} days of liquidity at your current spending rate.`,
          icon: 'shield',
          color: '#3b82f6',
          priority: 42,
        });
      }
    }

    return insights;
  }

  private static analyzeSavingsVelocity(
    income: number,
    expenses: number,
    prevIncome: number,
    prevExpenses: number
  ): FinancialInsight[] {
    const insights: FinancialInsight[] = [];
    const currentRate = income > 0 ? (income - expenses) / income : 0;
    const prevRate = prevIncome > 0 ? (prevIncome - prevExpenses) / prevIncome : 0;

    const velocity = currentRate - prevRate;

    if (velocity > 0.05) {
      insights.push({
        id: 'savings-acceleration',
        type: 'success',
        title: '🚀 Savings Velocity Up',
        description: `Your savings rate improved by ${(velocity * 100).toFixed(0)}% vs last period. You're gaining momentum!`,
        icon: 'bolt',
        color: '#10b981',
        priority: 82,
      });
    }

    return insights;
  }

  private static detectArchetype(income: number, expenses: number, transactions: Transaction[]): FinancialInsight[] {
    const insights: FinancialInsight[] = [];
    const savingsRate = income > 0 ? (income - expenses) / income : 0;
    const expenseCount = transactions.filter(t => t.type === 'EXPENSE').length;

    let archetype = { title: '', desc: '', icon: '', color: '' };

    if (savingsRate > 0.4) {
      archetype = {
        title: 'The Fortress',
        desc: 'You have an exceptionally high savings rate. Your financial security is your priority.',
        icon: 'university',
        color: '#059669'
      };
    } else if (savingsRate > 0.15 && expenseCount < 15) {
      archetype = {
        title: 'The Minimalist',
        desc: 'You make few, deliberate purchases and maintain a healthy surplus.',
        icon: 'leaf',
        color: '#10b981'
      };
    } else if (expenseCount > 40) {
      archetype = {
        title: 'The High-Frequency Spender',
        desc: 'You make many small purchases. Consolidation could reveal hidden savings.',
        icon: 'shopping-cart',
        color: '#f59e0b'
      };
    } else if (savingsRate < 0) {
      archetype = {
        title: 'The Lifestyle Enthusiast',
        desc: 'You are currently prioritizing experiences or needs over surplus. Monitor your runway.',
        icon: 'glass',
        color: '#ef4444'
      };
    } else {
      archetype = {
        title: 'The Balanced Strategist',
        desc: 'You maintain a steady equilibrium between enjoying today and saving for tomorrow.',
        icon: 'balance-scale',
        color: '#3b82f6'
      };
    }

    insights.push({
      id: 'archetype',
      type: 'info',
      title: `👤 Archetype: ${archetype.title}`,
      description: archetype.desc,
      icon: archetype.icon,
      color: archetype.color,
      priority: 35,
    });

    return insights;
  }

  private static analyzeDayOfWeekSpending(transactions: Transaction[]): FinancialInsight[] {
    const insights: FinancialInsight[] = [];
    const expenses = transactions.filter(t => t.type === 'EXPENSE');
    if (expenses.length < 10) return insights;

    const dayTotals: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    expenses.forEach(t => {
      const day = new Date(t.date).getDay();
      dayTotals[day] += t.amount;
    });

    const weekendTotal = dayTotals[0] + dayTotals[6]; // Sun + Sat
    const weekdayTotal = dayTotals[1] + dayTotals[2] + dayTotals[3] + dayTotals[4] + dayTotals[5];

    const weekendAvg = weekendTotal / 2;
    const weekdayAvg = weekdayTotal / 5;

    if (weekendAvg > weekdayAvg * 1.5) {
      insights.push({
        id: 'weekend-spender',
        type: 'info',
        title: '🏖️ Weekend Surge',
        description: `Your spending spikes by ${((weekendAvg / weekdayAvg - 1) * 100).toFixed(0)}% on weekends. Plan your leisure budget!`,
        icon: 'calendar',
        color: '#8b5cf6',
        priority: 40,
      });
    }

    return insights;
  }

  private static analyzeMerchantConcentration(transactions: Transaction[]): FinancialInsight[] {
    const insights: FinancialInsight[] = [];
    const expenses = transactions.filter(t => t.type === 'EXPENSE');
    if (expenses.length < 5) return insights;

    const merchants: Record<string, number> = {};
    expenses.forEach(t => {
      const name = (t.description || t.sender_receiver || 'Unknown').split(' ')[0].toLowerCase();
      if (name.length > 2) {
        merchants[name] = (merchants[name] || 0) + t.amount;
      }
    });

    const totalExpense = expenses.reduce((s, t) => s + t.amount, 0);
    const topMerchant = Object.entries(merchants).sort((a, b) => b[1] - a[1])[0];

    if (topMerchant && topMerchant[1] > totalExpense * 0.2) {
      insights.push({
        id: 'merchant-monopoly',
        type: 'suggestion',
        title: `🏢 Top Payee: ${topMerchant[0].toUpperCase()}`,
        description: `You've spent ${((topMerchant[1] / totalExpense) * 100).toFixed(0)}% of your budget at ${topMerchant[0]}. Can you find cheaper alternatives?`,
        icon: 'shopping-bag',
        color: '#f97316',
        priority: 55,
      });
    }

    return insights;
  }

  private static analyzeRunway(balance: number, monthlyExpenses: number): FinancialInsight[] {
    const insights: FinancialInsight[] = [];
    if (monthlyExpenses <= 0 || balance <= 0) return insights;

    const runwayMonths = balance / monthlyExpenses;

    if (runwayMonths >= 6) {
      insights.push({
        id: 'strong-runway',
        type: 'success',
        title: '🛡️ Strong Runway',
        description: `Your current balance can cover ${runwayMonths.toFixed(1)} months of expenses. You are very secure!`,
        icon: 'shield',
        color: '#10b981',
        priority: 75,
      });
    } else if (runwayMonths < 1) {
      insights.push({
        id: 'short-runway',
        type: 'warning',
        title: '⚠️ Critical Runway',
        description: `Your balance covers less than 1 month of expenses. Immediate savings recommended.`,
        icon: 'clock-o',
        color: '#ef4444',
        priority: 99,
      });
    }

    return insights;
  }

  private static detectSubscriptions(transactions: Transaction[], recurring: RecurringTransaction[]): FinancialInsight[] {
    const insights: FinancialInsight[] = [];
    const expenses = transactions.filter(t => t.type === 'EXPENSE');

    // Group by amount and description to find potential hidden subscriptions
    const groups: Record<string, Transaction[]> = {};
    expenses.forEach(t => {
      const key = `${t.amount}-${t.description?.toLowerCase() || ''}-${t.category}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    });

    Object.entries(groups).forEach(([key, matches]) => {
      if (matches.length >= 2) {
        // Check if this is already tracked as a recurring transaction
        const desc = matches[0].description;
        const exists = recurring.some(r => r.name.toLowerCase() === desc?.toLowerCase());

        if (!exists) {
          insights.push({
            id: `potential-sub-${key}`,
            type: 'suggestion',
            title: '📅 Hidden Subscription?',
            description: `We noticed "${desc}" repeats frequently ($${matches[0].amount}). Add it to recurring to track it better.`,
            icon: 'refresh',
            color: '#f97316',
            priority: 45,
          });
        }
      }
    });

    return insights;
  }

  private static analyzeDebtRisk(loans: Loan[], monthlyIncome: number): FinancialInsight[] {
    const insights: FinancialInsight[] = [];
    const debts = loans.filter(l => l.type === 'BORROWED' && l.status === 'ACTIVE');
    const totalDebt = debts.reduce((s, l) => s + l.remaining_balance, 0);

    if (totalDebt > 0 && monthlyIncome > 0) {
      const debtToIncome = totalDebt / monthlyIncome;
      if (debtToIncome > 2) {
        insights.push({
          id: 'high-debt-risk',
          type: 'warning',
          title: '🚩 High Debt Ratio',
          description: `Your total debt is ${debtToIncome.toFixed(1)}x your monthly income. Focus on high-interest repayment.`,
          icon: 'warning',
          color: '#ef4444',
          priority: 95,
        });
      } else if (debtToIncome > 1) {
        insights.push({
          id: 'moderate-debt',
          type: 'info',
          title: '⚖️ Debt Management',
          description: `Your debt is roughly equal to your monthly income. Avoid new borrowing for now.`,
          icon: 'balance-scale',
          color: '#f59e0b',
          priority: 70,
        });
      }
    }
    return insights;
  }

  private static predictCashFlow(currentBalance: number, recurring: RecurringTransaction[], loans: Loan[]): FinancialInsight[] {
    const insights: FinancialInsight[] = [];
    const now = new Date();
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const daysLeft = endOfMonth.getDate() - now.getDate();

    if (daysLeft < 1) return insights;

    // Estimate upcoming recurring costs
    const upcomingRecurring = recurring
      .filter(r => r.isActive && r.nextDate <= endOfMonth.getTime())
      .reduce((s, r) => s + (r.type === 'EXPENSE' ? r.amount : -r.amount), 0);

    // Estimate upcoming loan payments
    const upcomingLoans = loans
      .filter(l => l.status === 'ACTIVE' && l.type === 'BORROWED' && l.due_date <= endOfMonth.getTime())
      .reduce((s, l) => s + (l.remaining_balance / 3), 0); // Estimate partial payment if not full

    const projectedExpenses = upcomingRecurring + upcomingLoans;
    const projectedSafeSpend = currentBalance - projectedExpenses;

    if (projectedSafeSpend < 0) {
      insights.push({
        id: 'cash-flow-alert',
        type: 'warning',
        title: '📉 Cash Flow Shortfall',
        description: `Projected expenses ($${projectedExpenses.toFixed(0)}) exceed current balance. You may need to draw from savings.`,
        icon: 'bank',
        color: '#ef4444',
        priority: 98,
      });
    } else if (projectedSafeSpend < currentBalance * 0.2) {
      insights.push({
        id: 'tight-budget',
        type: 'warning',
        title: '⚠️ Tight Month Ahead',
        description: `Only $${projectedSafeSpend.toFixed(0)} left for non-essential spending after bills and loans.`,
        icon: 'clock-o',
        color: '#f97316',
        priority: 85,
      });
    } else {
      insights.push({
        id: 'healthy-outlook',
        type: 'success',
        title: '🌟 Positive Outlook',
        description: `You're on track to finish the month with roughly $${projectedSafeSpend.toFixed(0)} surplus.`,
        icon: 'star',
        color: '#10b981',
        priority: 60,
      });
    }

    return insights;
  }

  private static analyzeBudgetAdherence(transactions: Transaction[], budgets: Budget[]): FinancialInsight[] {
    const insights: FinancialInsight[] = [];
    if (budgets.length === 0) return insights;

    const now = Date.now();
    budgets
      .filter((budget) => budget.start_date <= now && budget.end_date >= now)
      .forEach(budget => {
      const metrics = BudgetService.calculateBudgetMetrics(budget, budgets, transactions);
      if (metrics.effectiveLimit <= 0) {
        return;
      }

      const percentage = (metrics.spent / metrics.effectiveLimit) * 100;

      if (percentage >= 100) {
        insights.push({
          id: `budget-exceeded-${budget.id}`,
          type: 'warning',
          title: `🚫 Budget Over: ${budget.category}`,
          description: `You've exceeded your ${budget.category} budget by $${Math.abs(metrics.remaining).toFixed(0)}.`,
          icon: 'close',
          color: '#ef4444',
          priority: 92,
        });
      } else if (percentage >= 85) {
        insights.push({
          id: `budget-near-${budget.id}`,
          type: 'warning',
          title: `⚠️ Budget Alert: ${budget.category}`,
          description: `You've used ${percentage.toFixed(0)}% of your "${budget.category}" budget ($${metrics.remaining.toFixed(0)} left).`,
          icon: 'warning',
          color: '#f97316',
          priority: 88,
        });
      }
    });

    return insights;
  }

  private static analyzeFinancialHealth(
    income: number,
    expenses: number,
    balance: number
  ): FinancialInsight[] {
    const insights: FinancialInsight[] = [];
    const savingsRate = income > 0 ? (balance / income) * 100 : 0;

    if (savingsRate > 30) {
      insights.push({
        id: 'excellent-savings',
        type: 'success',
        title: '🎉 Excellent Savings Rate',
        description: `You're saving ${savingsRate.toFixed(1)}% of your income! Keep up the great work.`,
        icon: 'check-circle',
        color: '#10b981',
        priority: 90,
      });
    } else if (savingsRate > 20) {
      insights.push({
        id: 'good-savings',
        type: 'success',
        title: '✅ Healthy Savings',
        description: `You're saving ${savingsRate.toFixed(1)}% of your income. Consider aiming for 30%+.`,
        icon: 'thumbs-up',
        color: '#22c55e',
        priority: 70,
      });
    } else if (savingsRate > 10) {
      insights.push({
        id: 'moderate-savings',
        type: 'info',
        title: '💡 Room for Improvement',
        description: `Your savings rate is ${savingsRate.toFixed(1)}%. Try to increase it to 20%+.`,
        icon: 'info-circle',
        color: '#3b82f6',
        priority: 60,
      });
    } else if (balance < 0) {
      insights.push({
        id: 'spending-more',
        type: 'warning',
        title: '⚠️ Spending Exceeds Income',
        description: `You spent ${Math.abs(savingsRate).toFixed(1)}% more than you earned. Review your expenses.`,
        icon: 'exclamation-triangle',
        color: '#ef4444',
        priority: 100,
      });
    }

    return insights;
  }

  private static analyzeSpendingPatterns(transactions: Transaction[]): FinancialInsight[] {
    const insights: FinancialInsight[] = [];
    const expenses = transactions.filter(t => t.type === 'EXPENSE');

    if (expenses.length === 0) return insights;

    // Analyze spending frequency
    const avgDailyTransactions = this.getAvgDailyTransactions(expenses);

    if (avgDailyTransactions > 5) {
      const potentialSavings = expenses.length * 2; // Assume $2 per small transaction
      insights.push({
        id: 'frequent-spending',
        type: 'suggestion',
        title: '🛍️ Frequent Small Purchases',
        description: `You make ${avgDailyTransactions.toFixed(1)} transactions/day. Consolidating purchases could save ~$${potentialSavings.toFixed(0)}.`,
        icon: 'shopping-cart',
        color: '#f59e0b',
        priority: 50,
      });
    }

    // Analyze large transactions
    const largeTransactions = this.getLargeTransactions(expenses);
    if (largeTransactions.length > 0) {
      const totalLarge = largeTransactions.reduce((sum, t) => sum + t.amount, 0);
      const percentOfTotal = (totalLarge / this.getTotalByType(transactions, 'EXPENSE')) * 100;

      insights.push({
        id: 'large-purchases',
        type: 'info',
        title: '📊 Large Purchases Detected',
        description: `${largeTransactions.length} large transactions account for ${percentOfTotal.toFixed(0)}% of your spending.`,
        icon: 'credit-card',
        color: '#8b5cf6',
        priority: 40,
      });
    }

    return insights;
  }

  private static analyzeCategorySpending(transactions: Transaction[]): FinancialInsight[] {
    const insights: FinancialInsight[] = [];
    const expenses = transactions.filter(t => t.type === 'EXPENSE');

    if (expenses.length === 0) return insights;

    const categoryTotals = this.groupByCategory(expenses);
    const topCategory = this.getTopCategory(categoryTotals);
    const totalExpenses = this.getTotalByType(transactions, 'EXPENSE');

    if (topCategory) {
      const percentage = (topCategory.amount / totalExpenses) * 100;

      if (percentage > 40) {
        insights.push({
          id: 'high-category-spending',
          type: 'warning',
          title: `⚠️ High ${topCategory.category} Spending`,
          description: `${percentage.toFixed(0)}% of expenses are in "${topCategory.category}". Consider setting limits.`,
          icon: 'pie-chart',
          color: '#f97316',
          priority: 80,
        });
      } else if (percentage > 25) {
        insights.push({
          id: 'notable-category',
          type: 'info',
          title: `💰 Top Category: ${topCategory.category}`,
          description: `This accounts for ${percentage.toFixed(0)}% of your spending.`,
          icon: 'bar-chart',
          color: '#3b82f6',
          priority: 30,
        });
      }
    }

    return insights;
  }

  private static analyzeTrends(
    income: number,
    expenses: number,
    prevIncome: number,
    prevExpenses: number
  ): FinancialInsight[] {
    const insights: FinancialInsight[] = [];

    // Income trend
    const incomeChange = prevIncome > 0 ? ((income - prevIncome) / prevIncome) * 100 : 0;
    if (incomeChange > 10) {
      insights.push({
        id: 'income-increase',
        type: 'success',
        title: '📈 Income Increased',
        description: `Your income rose by ${incomeChange.toFixed(1)}% compared to last period!`,
        icon: 'arrow-up',
        color: '#10b981',
        priority: 85,
      });
    } else if (incomeChange < -10) {
      insights.push({
        id: 'income-decrease',
        type: 'warning',
        title: '📉 Income Decreased',
        description: `Income dropped ${Math.abs(incomeChange).toFixed(1)}%. Monitor your expenses closely.`,
        icon: 'arrow-down',
        color: '#ef4444',
        priority: 95,
      });
    }

    // Expense trend
    const expenseChange = prevExpenses > 0 ? ((expenses - prevExpenses) / prevExpenses) * 100 : 0;
    if (expenseChange > 20) {
      insights.push({
        id: 'spending-spike',
        type: 'warning',
        title: '⚠️ Spending Spike',
        description: `Expenses increased ${expenseChange.toFixed(1)}%. Review recent purchases.`,
        icon: 'trending-up',
        color: '#ef4444',
        priority: 90,
      });
    } else if (expenseChange < -10) {
      insights.push({
        id: 'spending-decrease',
        type: 'success',
        title: '🎯 Reduced Spending',
        description: `Great job! Expenses dropped ${Math.abs(expenseChange).toFixed(1)}%.`,
        icon: 'trending-down',
        color: '#10b981',
        priority: 75,
      });
    }

    return insights;
  }

  private static detectAnomalies(transactions: Transaction[]): FinancialInsight[] {
    const insights: FinancialInsight[] = [];
    const expenses = transactions.filter(t => t.type === 'EXPENSE');

    if (expenses.length < 5) return insights;

    const avgAmount = expenses.reduce((sum, t) => sum + t.amount, 0) / expenses.length;
    const unusualTransactions = expenses.filter(t => t.amount > avgAmount * 3);

    if (unusualTransactions.length > 0) {
      insights.push({
        id: 'unusual-spending',
        type: 'info',
        title: '🔍 Unusual Transactions',
        description: `Found ${unusualTransactions.length} transactions significantly above average. Review for accuracy.`,
        icon: 'search',
        color: '#6366f1',
        priority: 45,
      });
    }

    return insights;
  }

  private static findSavingsOpportunities(
    transactions: Transaction[],
    income: number,
    expenses: number
  ): FinancialInsight[] {
    const insights: FinancialInsight[] = [];

    // Check if user could save more
    const savingsRate = income > 0 ? ((income - expenses) / income) * 100 : 0;

    if (savingsRate < 20 && savingsRate > 0) {
      const targetSavings = income * 0.2;
      const currentSavings = income - expenses;
      const additionalSavings = targetSavings - currentSavings;

      if (additionalSavings > 0) {
        insights.push({
          id: 'savings-opportunity',
          type: 'suggestion',
          title: '💡 Savings Opportunity',
          description: `Save an extra ${additionalSavings.toFixed(0)} to reach the recommended 20% savings rate.`,
          icon: 'lightbulb-o',
          color: '#eab308',
          priority: 65,
        });
      }
    }

    // Suggest emergency fund
    const monthlyExpenses = expenses;
    const currentBalance = income - expenses;
    const emergencyFundGoal = monthlyExpenses * 3;

    if (currentBalance > 0 && currentBalance < emergencyFundGoal) {
      insights.push({
        id: 'emergency-fund',
        type: 'suggestion',
        title: '🏦 Build Emergency Fund',
        description: `Aim for ${emergencyFundGoal.toFixed(0)} (3 months expenses). You're ${((currentBalance / emergencyFundGoal) * 100).toFixed(0)}% there.`,
        icon: 'bank',
        color: '#06b6d4',
        priority: 55,
      });
    }

    return insights;
  }

  private static analyzeFixedCosts(recurring: RecurringTransaction[], totalExpenses: number): FinancialInsight[] {
    const insights: FinancialInsight[] = [];
    if (totalExpenses === 0) return insights;

    const fixedCostSum = recurring
      .filter(r => r.type === 'EXPENSE' && r.isActive)
      .reduce((sum, r) => sum + r.amount, 0);

    const ratio = (fixedCostSum / totalExpenses) * 100;

    if (ratio > 60) {
      insights.push({
        id: 'high-fixed-costs',
        type: 'warning',
        title: '🔒 High Fixed Costs',
        description: `Fixed bills consume ${ratio.toFixed(0)}% of your spending. This reduces flexibility in emergencies.`,
        icon: 'lock',
        color: '#ef4444',
        priority: 60,
      });
    }

    return insights;
  }

  private static analyzeSmallFrequentPurchases(transactions: Transaction[]): FinancialInsight[] {
    const insights: FinancialInsight[] = [];
    const smallPurchases = transactions.filter(t => t.type === 'EXPENSE' && t.amount < 20); // < $20

    if (smallPurchases.length > 5) {
      const total = smallPurchases.reduce((sum, t) => sum + t.amount, 0);
      if (total > 100) {
        insights.push({
          id: 'latte-factor',
          type: 'info',
          title: '☕ The Latte Factor',
          description: `Small purchases (<$20) added up to $${total.toFixed(0)} this period. Mind the little things!`,
          icon: 'coffee',
          color: '#f59e0b',
          priority: 50,
        });
      }
    }
    return insights;
  }

  // Helper methods
  private static getTotalByType(transactions: Transaction[], type: string): number {
    return transactions
      .filter(t => t.type === type)
      .reduce((sum, t) => sum + t.amount, 0);
  }

  private static groupByCategory(transactions: Transaction[]): Record<string, number> {
    return transactions.reduce((acc, t) => {
      const category = t.category || 'Uncategorized';
      acc[category] = (acc[category] || 0) + t.amount;
      return acc;
    }, {} as Record<string, number>);
  }

  private static getTopCategory(categoryTotals: Record<string, number>): { category: string; amount: number } | null {
    const entries = Object.entries(categoryTotals);
    if (entries.length === 0) return null;

    const [category, amount] = entries.reduce((max, curr) =>
      curr[1] > max[1] ? curr : max
    );

    return { category, amount };
  }

  private static getAvgDailyTransactions(transactions: Transaction[]): number {
    if (transactions.length === 0) return 0;

    const dates = transactions.map(t => new Date(t.date).toDateString());
    const uniqueDays = new Set(dates).size;

    return uniqueDays > 0 ? transactions.length / uniqueDays : 0;
  }

  private static getLargeTransactions(transactions: Transaction[]): Transaction[] {
    if (transactions.length === 0) return [];

    const avgAmount = transactions.reduce((sum, t) => sum + t.amount, 0) / transactions.length;
    return transactions.filter(t => t.amount > avgAmount * 2);
  }
}
