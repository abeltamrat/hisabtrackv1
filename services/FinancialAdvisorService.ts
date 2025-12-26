import { Transaction } from '@/types/database';

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
    previousPeriodTransactions: Transaction[] = []
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

    // Sort by priority (higher priority first)
    return insights.sort((a, b) => b.priority - a.priority).slice(0, 8);
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
