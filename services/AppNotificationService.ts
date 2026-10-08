import { sessionLocalStorage } from '@/services/SessionStorage';
import { Account, Budget, Loan, RecurringTransaction, Transaction } from '@/types/database';
import AsyncStorage from '@/services/SessionStorage';
import { Platform } from 'react-native';

import BudgetService from '@/services/BudgetService';
import LocalChangeEmitter from '@/services/LocalChangeEmitter';
import { operatingExpense, operatingIncome, sumMoney } from '@/utils/finance';
import ForecastService from '@/services/ForecastService';
import { reconcileForecastWarnings } from '@/utils/forecastWarnings';

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  sourceKey?: string;
  type: 'info' | 'warning' | 'success' | 'tip' | 'alert';
  icon: string;
  color: string;
  timestamp: number;
  read: boolean;
  isAI?: boolean; // Flag to distinguish AI-driven notifications
  actionType?: 'view_transactions' | 'view_budget' | 'view_reports' | 'view_loans' | 'view_recurring' | 'view_drafts' | 'view_funds' | 'view_smart_review';
  /** Opens this fund when actionType is view_funds. */
  fundId?: string;
}

const STORAGE_KEY = 'app_notifications';
const MAX_NOTIFICATIONS = 50;

export class AppNotificationService {
  static async syncSourceNotifications(
    prefix: string,
    active: Array<Omit<AppNotification, 'id' | 'timestamp' | 'read'>>,
  ): Promise<void> {
    const existing = await this.getNotifications();
    const previousKeys = new Set(existing.filter(item => item.sourceKey?.startsWith(prefix)).map(item => item.sourceKey));
    const activeKeys = new Set(active.map(item => item.sourceKey).filter((key): key is string => !!key));
    const now = Date.now();
    const next = existing
      .filter(item => !item.sourceKey?.startsWith(prefix) || activeKeys.has(item.sourceKey))
      .map(item => {
        const replacement = active.find(activeItem => activeItem.sourceKey === item.sourceKey);
        return replacement ? { ...item, ...replacement } : item;
      });
    for (const item of active) {
      if (item.sourceKey && !previousKeys.has(item.sourceKey)) next.push({ ...item, id: `${item.sourceKey}:${now}`, timestamp: now, read: false });
    }
    next.sort((a, b) => b.timestamp - a.timestamp);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next.slice(0, MAX_NOTIFICATIONS)));
    LocalChangeEmitter.emit();
  }

  static async syncForecastNotifications(
    active: Array<Omit<AppNotification, 'id' | 'timestamp' | 'read'>>,
  ): Promise<void> {
    const existing = await this.getNotifications();
    const now = Date.now();
    const retained = reconcileForecastWarnings(existing, active, now);
    const next = retained.slice(0, MAX_NOTIFICATIONS);
    if (JSON.stringify(next) !== JSON.stringify(existing.slice(0, MAX_NOTIFICATIONS))) {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      LocalChangeEmitter.emit();
    }
  }
  /**
   * Get all notifications
   */
  static async getNotifications(): Promise<AppNotification[]> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEY);
      if (data) {
        const notifications = JSON.parse(data) as AppNotification[];
        return notifications.sort((a, b) => b.timestamp - a.timestamp);
      }
      return [];
    } catch (error) {
      console.error('Error getting notifications:', error);
      return [];
    }
  }

  /**
   * Add a new notification
   */
  static async addNotification(notification: Omit<AppNotification, 'id' | 'timestamp' | 'read'>): Promise<void> {
    try {
      const notifications = await this.getNotifications();

      if (notification.sourceKey) {
        const existingBySource = notifications.find((item) => item.sourceKey === notification.sourceKey);
        if (existingBySource) return;
      }
      
      // Avoid duplicates relative to title and message in last 24h
      const recent = notifications.find(n => 
        n.title === notification.title && 
        n.message === notification.message && 
        Date.now() - n.timestamp < 24 * 60 * 60 * 1000
      );
      if (recent) return;

      const newNotification: AppNotification = {
        ...notification,
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        timestamp: Date.now(),
        read: false,
      };

      notifications.unshift(newNotification);

      // Keep only the latest MAX_NOTIFICATIONS
      const trimmed = notifications.slice(0, MAX_NOTIFICATIONS);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      LocalChangeEmitter.emit();
    } catch (error) {
      console.error('Error adding notification:', error);
    }
  }

  /**
   * Mark notification as read
   */
  static async markAsRead(id: string): Promise<void> {
    try {
      const notifications = await this.getNotifications();
      const updated = notifications.map(n => 
        n.id === id ? { ...n, read: true } : n
      );
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      LocalChangeEmitter.emit();
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  }

  /**
   * Mark all notifications as read
   */
  static async markAllAsRead(): Promise<void> {
    try {
      const notifications = await this.getNotifications();
      const updated = notifications.map(n => ({ ...n, read: true }));
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      LocalChangeEmitter.emit();
    } catch (error) {
      console.error('Error marking all as read:', error);
    }
  }

  /**
   * Delete a notification
   */
  static async deleteNotification(id: string): Promise<void> {
    try {
      const notifications = await this.getNotifications();
      const filtered = notifications.filter(n => n.id !== id);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
      LocalChangeEmitter.emit();
    } catch (error) {
      console.error('Error deleting notification:', error);
    }
  }

  /**
   * Clear all notifications
   */
  static async clearAll(): Promise<void> {
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
      LocalChangeEmitter.emit();
    } catch (error) {
      console.error('Error clearing notifications:', error);
    }
  }

  /**
   * Get unread count
   */
  static async getUnreadCount(): Promise<number> {
    try {
      const notifications = await this.getNotifications();
      return notifications.filter(n => !n.read).length;
    } catch (error) {
      console.error('Error getting unread count:', error);
      return 0;
    }
  }

  /**
   * Get unread count for AI notifications only
   */
  static async getAIUnreadCount(): Promise<number> {
    try {
      const notifications = await this.getNotifications();
      return notifications.filter(n => !n.read && n.isAI).length;
    } catch (error) {
      console.error('Error getting AI unread count:', error);
      return 0;
    }
  }

  /**
   * Get unread count for regular notifications only
   */
  static async getRegularUnreadCount(): Promise<number> {
    try {
      const notifications = await this.getNotifications();
      return notifications.filter(n => !n.read && !n.isAI).length;
    } catch (error) {
      console.error('Error getting regular unread count:', error);
      return 0;
    }
  }

  /**
   * Comprehensive check for all data types
   */
  static async checkAll(): Promise<void> {
    try {
      // 1. Fetch Transactions & Loans (from Database)
      const { getDatabase } = await import('./database');
      const db = await getDatabase();
      const transactions = await db.getTransactions();
      const loans = await db.getLoans();
      const budgets = await db.getBudgets();
      const accounts = await db.getAccounts();

      // 2. Fetch Recurring (from Storage)
      let recurring: RecurringTransaction[] = [];
      const recurringKey = Platform.OS === 'web' ? 'recurring_transactions' : '@hisabtrack_recurring_transactions';
      if (Platform.OS === 'web') {
        const stored = sessionLocalStorage.getItem(recurringKey);
        if (stored) recurring = JSON.parse(stored);
      } else {
        const stored = await AsyncStorage.getItem(recurringKey);
        if (stored) recurring = JSON.parse(stored);
      }
      
      // 3. Generate Insights
      const categories = await (await import('@/utils/storage')).StorageService.loadCategories();
      const effectiveCategories = categories.length ? categories : (await import('@/constants/MockData')).CATEGORIES;
      const categoryScopes = (await import('@/utils/categoryHierarchy')).buildCategoryScopes(effectiveCategories);
      await this.generateSmartNotifications(transactions, loans, recurring, budgets, accounts[0]?.currency || 'ETB', accounts, categoryScopes);
      const phase2 = await (await import('@/services/Phase2IntelligenceService')).Phase2IntelligenceService.analyze(transactions, accounts);
      const reviewNotifications: Array<Omit<AppNotification, 'id' | 'timestamp' | 'read'>> = [
        ...phase2.smsAlerts.map(alert => ({ sourceKey: `phase2:${alert.id}`, title: alert.title, message: alert.explanation, type: alert.severity === 'WARNING' ? 'warning' as const : 'info' as const, icon: alert.kind === 'POSSIBLE_DOUBLE_DEBIT' ? 'clone' : 'exclamation-circle', color: alert.severity === 'WARNING' ? '#dc2626' : '#2563eb', actionType: 'view_smart_review' as const })),
        ...phase2.recurringAlerts.map(alert => ({ sourceKey: `phase2:${alert.id}`, title: alert.title, message: alert.explanation, type: 'warning' as const, icon: 'calendar-times-o', color: '#d97706', actionType: 'view_smart_review' as const })),
        ...phase2.recipientSuggestions.slice(0, 3).map(suggestion => ({ sourceKey: `phase2:${suggestion.id}`, title: 'Recipient aliases may match', message: `${suggestion.left} and ${suggestion.right}: ${suggestion.reason}`, type: 'info' as const, icon: 'user-circle', color: '#7c3aed', actionType: 'view_smart_review' as const })),
      ];
      await this.syncSourceNotifications('phase2:', reviewNotifications.slice(0, 12));
      const settings = await (await import('@/contexts/AppSettingsContext')).loadStoredAppSettings();
      const digestSettings = settings.backgroundReminders;
      const hour = new Date().getHours();
      const inQuietHours = digestSettings.quietHoursStart > digestSettings.quietHoursEnd
        ? hour >= digestSettings.quietHoursStart || hour < digestSettings.quietHoursEnd
        : hour >= digestSettings.quietHoursStart && hour < digestSettings.quietHoursEnd;
      if (digestSettings.periodDigestAlertsEnabled && !inQuietHours) {
        const drafts = await (await import('@/services/DraftTransactionService')).DraftTransactionService.getAll();
        const pending = drafts.filter(item => item.status === 'PENDING');
        const discrepancies = (await import('@/services/ReconciliationService')).ReconciliationService.unresolvedCount(accounts, drafts, transactions);
        const digestTools = await import('@/services/PeriodDigestService');
        for (const kind of ['WEEKLY', 'MONTHLY'] as const) {
          const digest = digestTools.createPeriodDigest(kind, transactions, recurring, { pendingDrafts: pending.length, discrepancies });
          const copy = digestTools.formatPeriodDigest(digest, accounts[0]?.currency || 'ETB', settings.balancesHidden, settings.language);
          await this.addNotification({ sourceKey: `digest:${digest.key}`, title: copy.title, message: copy.message, type: digest.discrepancies || digest.pendingDrafts ? 'warning' : 'info', icon: 'calendar-check-o', color: '#4f46e5', actionType: 'view_reports' });
        }
      }
      
    } catch (error) {
      console.error('Error in checkAll:', error);
    }
  }

  /**
   * Generate AI financial notifications based on all data
   */
  static async generateSmartNotifications(
    transactions: Transaction[], 
    loans: Loan[] = [], 
    recurring: RecurringTransaction[] = [],
    budgets: Budget[] = [],
    currency = 'ETB',
    accounts: Account[] = [],
    categoryScopes: Record<string, string[]> = {},
  ): Promise<void> {
    if (transactions.length === 0 && loans.length === 0 && recurring.length === 0 && accounts.length === 0) return;

    const notifications: Array<Omit<AppNotification, 'id' | 'timestamp' | 'read'>> = [];
    const now = Date.now();
    const today = new Date();
    const thisMonth = today.getMonth();
    const thisYear = today.getFullYear();
    const dayOfMonth = today.getDate();
    const formatMoney = (amount: number) => `${currency} ${amount.toFixed(2)}`;

    if (accounts.length > 0) {
      const forecast = ForecastService.generateForecast({ accounts, recurring, loans, days: 30, transactions });
      const forecastNotifications: Array<Omit<AppNotification, 'id' | 'timestamp' | 'read'>> = [];
      for (const warning of forecast.lowBalanceWarnings) {
        const causes = warning.causingEvents
          .filter(event => event.type !== 'INCOME')
          .map(event => event.title)
          .slice(0, 2);
        forecastNotifications.push({
          sourceKey: `forecast:low:${warning.accountId}`,
          title: `Low-balance forecast: ${warning.accountName}`,
          message: `${warning.accountName} may fall below ${formatMoney(warning.reserveAmount)} on ${new Date(warning.crossingDate).toLocaleDateString()}${causes.length ? ` after ${causes.join(' and ')}` : ''}.`,
          type: 'warning',
          icon: 'line-chart',
          color: '#dc2626',
          isAI: false,
          actionType: 'view_reports',
        });
      }
      await this.syncForecastNotifications(forecastNotifications);
    }

    // -- Transaction Metrics --
    const thisMonthTransactions = transactions.filter(t => {
      const date = new Date(t.date);
      return date.getMonth() === thisMonth && date.getFullYear() === thisYear;
    });

    const income = sumMoney(thisMonthTransactions.map(operatingIncome));
    
    const expenses = sumMoney(thisMonthTransactions.map(operatingExpense));

    // 1. 💸 High Spending Alert
    if (income > 0 && expenses > income * 0.85) {
      notifications.push({
        title: '💸 High Spending Alert',
        message: `You've spent ${((expenses / income) * 100).toFixed(0)}% of your income. Watch your budget!`,
        type: 'warning',
        icon: 'exclamation-triangle',
        color: '#f59e0b',
        isAI: true,
        actionType: 'view_reports',
      });
    }

    // 2. 🎉 Savings Encouragement
    if (income > expenses && (income - expenses) > income * 0.25) {
      notifications.push({
        title: '🎉 Great Savings!',
        message: `You're saving ${((income - expenses) / income * 100).toFixed(0)}% of your income!`,
        type: 'success',
        icon: 'thumbs-up',
        color: '#10b981',
        isAI: true,
      });
    }

    // 3. 🎯 Loan Analysis
    const activeLoans = loans.filter(l => l.status === 'ACTIVE' && l.type === 'BORROWED');
    activeLoans.forEach(loan => {
       const dueDate = new Date(loan.due_date);
       const daysUntilDue = Math.ceil((dueDate.getTime() - now) / (1000 * 60 * 60 * 24));
       
       if (daysUntilDue <= 3 && daysUntilDue >= 0) {
         notifications.push({
           title: '⚠️ Loan Payment Due',
           message: `Payment for '${loan.lender_borrower_name}' is due in ${daysUntilDue === 0 ? 'today' : daysUntilDue + ' days'}.`,
           type: 'alert',
           icon: 'bank',
           color: '#ef4444',
           isAI: true,
           actionType: 'view_loans',
         });
       } else if (daysUntilDue < 0) {
          notifications.push({
           title: '🚨 Overdue Loan',
           message: `Payment for '${loan.lender_borrower_name}' was due ${Math.abs(daysUntilDue)} days ago!`,
           type: 'warning',
           icon: 'warning',
           color: '#dc2626',
           isAI: true,
           actionType: 'view_loans',
         });
       }
    });

    if (activeLoans.length > 0 && expenses < income * 0.5 && Math.random() > 0.7) {
       notifications.push({
           title: '💡 Pay Off Debt',
           message: 'You have a surplus this month. Consider making an extra loan payment to save on interest.',
           type: 'tip',
           icon: 'money',
           color: '#3b82f6',
           isAI: true,
           actionType: 'view_loans',
       });
    }

    // 4. 🔄 Recurring Payment Forecast
    const upcomingRecurring = recurring.filter(r => r.isActive && r.nextDate > now && r.nextDate < now + (7 * 24 * 60 * 60 * 1000));
    upcomingRecurring.forEach(rec => {
       const daysUntil = Math.ceil((rec.nextDate - now) / (1000 * 60 * 60 * 24));
       if (daysUntil <= 3) {
          notifications.push({
             title: '📅 Upcoming Bill',
             message: `${rec.name} (${formatMoney(rec.amount)}) is due in ${daysUntil} days.`,
             type: 'info',
             icon: 'calendar',
             color: '#8b5cf6',
             isAI: true,
             actionType: 'view_recurring',
          });
       }
    });
    
    // Detect duplicate subscriptions (same amount & similar name in recurring)
    // Simple check: if multiple active recurring have same amount and category
    const subGroups: Record<string, RecurringTransaction[]> = {};
    recurring.filter(r => r.isActive && r.type === 'EXPENSE').forEach(r => {
       const key = `${r.amount}-${r.category}`;
       if (!subGroups[key]) subGroups[key] = [];
       subGroups[key].push(r);
    });
    
    Object.values(subGroups).forEach(group => {
       if (group.length > 1) {
          notifications.push({
             title: '🔍 Duplicate Subscription?',
             message: `You have ${group.length} recurring payments for ${formatMoney(group[0].amount)} in ${group[0].category}. Check if they are duplicates.`,
             type: 'warning',
             icon: 'search',
             color: '#f97316',
             isAI: true,
             actionType: 'view_recurring',
          });
       }
    });

    // 5. 📉 Budget Forecasting
    budgets
      .filter((budget) => budget.start_date <= now && budget.end_date >= now)
      .forEach(budget => {
       const metrics = BudgetService.calculateBudgetMetrics(budget, budgets, transactions, {
         includedCategories: categoryScopes[budget.category] || [budget.category],
       });
       const pace = BudgetService.calculatePace(metrics, now);
       const spent = metrics.spent;
       const limit = metrics.effectiveLimit;
       if (limit <= 0) {
         return;
       }
       const percent = spent / limit;
       
       // Alert if over 90%
       if (percent > 0.9 && percent <= 1.0) {
          notifications.push({
             title: `⚠️ Budget Alert: ${budget.category}`,
             message: `You've used ${(percent * 100).toFixed(0)}% of your ${budget.category} budget with ${pace.remainingDays} days left in this period.`,
             type: 'warning',
             icon: 'pie-chart',
             color: '#f59e0b',
             isAI: true,
             actionType: 'view_budget',
          });
       }
       // Forecast
       if (pace.hasEnoughHistory && pace.projectedSpend > limit && percent < 1.0) {
          const exhaustion = pace.exhaustionDate
            ? ` It may run out on ${new Date(pace.exhaustionDate).toLocaleDateString()}.`
            : '';
          const period = `${new Date(budget.start_date).toLocaleDateString()}–${new Date(budget.end_date).toLocaleDateString()}`;
          notifications.push({
             title: `📈 Budget Forecast: ${budget.category}`,
             message: `${formatMoney(spent)} spent from a ${formatMoney(limit)} limit for ${period}. At this rate, you'll exceed it by ${formatMoney(pace.projectedSpend - limit)}.${exhaustion}`,
             type: 'tip',
             icon: 'line-chart',
             color: '#6366f1',
             isAI: true,
             actionType: 'view_budget',
          });
       }
    });

    // 6. 📅 Mid-Month & Weekly Checks
    if (dayOfMonth === 15) {
      notifications.push({
        title: '📅 Mid-Month Check',
        message: 'Time to review your budget! Make adjustments if needed.',
        type: 'tip',
        icon: 'calendar',
        color: '#6366f1',
        isAI: true,
        actionType: 'view_budget',
      });
    }

    if (today.getDay() === 0) { // Sunday
      notifications.push({
        title: '📊 Weekly Review',
        message: 'Take a moment to review your spendings this week.',
        type: 'info',
        icon: 'bar-chart',
        color: '#3b82f6',
        isAI: true,
        actionType: 'view_reports',
      });
    }

    // 7. General Financial Tips (Random)
    if (Math.random() > 0.8) { // 20% chance per check
       const tips = [
          "Try the 50/30/20 rule: 50% needs, 30% wants, 20% savings.",
          "Building an emergency fund of 3-6 months expenses gives peace of mind.",
          "Review your recurring subscriptions monthly to cancel unused ones.",
          "Pay off high-interest debt first to save money.",
          "Track small expenses—they add up fast!",
       ];
       notifications.push({
          title: '💡 Financial Wisdom',
          message: tips[Math.floor(Math.random() * tips.length)],
          type: 'tip',
          icon: 'lightbulb-o',
          color: '#eab308',
          isAI: true,
       });
    }

    // Add unique notifications (up to 3 per batch)
    const toAdd = notifications.slice(0, 3);
    for (const notification of toAdd) {
      await this.addNotification(notification);
    }
  }

  /**
   * Send a welcome notification
   */
  static async sendWelcomeNotification(): Promise<void> {
    await this.addNotification({
      title: '👋 Welcome to HisabTrack!',
      message: 'Start tracking your finances and achieve your financial goals.',
      type: 'success',
      icon: 'heart',
      color: '#ec4899',
    });
  }

  /**
   * Send daily financial tip
   */
  static async sendDailyTip(): Promise<void> {
    // Replaced by generic tips in generateSmartNotifications or keep as manual trigger
    await this.checkAll(); // Trigger a full check instead of just a tip
  }
}
