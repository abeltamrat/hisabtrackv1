import { Budget, Loan, RecurringTransaction, Transaction } from '@/types/database';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import BudgetService from '@/services/BudgetService';
import LocalChangeEmitter from '@/services/LocalChangeEmitter';

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
  actionType?: 'view_transactions' | 'view_budget' | 'view_reports' | 'view_loans' | 'view_recurring' | 'view_drafts';
}

const STORAGE_KEY = 'app_notifications';
const MAX_NOTIFICATIONS = 50;

export class AppNotificationService {
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

      // 2. Fetch Recurring (from Storage)
      let recurring: RecurringTransaction[] = [];
      const recurringKey = Platform.OS === 'web' ? 'recurring_transactions' : '@hisabtrack_recurring_transactions';
      if (Platform.OS === 'web') {
        const stored = localStorage.getItem(recurringKey);
        if (stored) recurring = JSON.parse(stored);
      } else {
        const stored = await AsyncStorage.getItem(recurringKey);
        if (stored) recurring = JSON.parse(stored);
      }
      
      // 3. Generate Insights
      await this.generateSmartNotifications(transactions, loans, recurring, budgets);
      
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
    budgets: Budget[] = []
  ): Promise<void> {
    if (transactions.length === 0 && loans.length === 0 && recurring.length === 0) return;

    const notifications: Array<Omit<AppNotification, 'id' | 'timestamp' | 'read'>> = [];
    const now = Date.now();
    const today = new Date();
    const thisMonth = today.getMonth();
    const thisYear = today.getFullYear();
    const daysInMonth = new Date(thisYear, thisMonth + 1, 0).getDate();
    const dayOfMonth = today.getDate();

    // -- Transaction Metrics --
    const thisMonthTransactions = transactions.filter(t => {
      const date = new Date(t.date);
      return date.getMonth() === thisMonth && date.getFullYear() === thisYear;
    });

    const income = thisMonthTransactions
      .filter(t => t.type === 'INCOME')
      .reduce((sum, t) => sum + t.amount, 0);
    
    const expenses = thisMonthTransactions
      .filter(t => t.type === 'EXPENSE')
      .reduce((sum, t) => sum + t.amount, 0);

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
             message: `${rec.name} ($${rec.amount}) is due in ${daysUntil} days.`,
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
             message: `You have ${group.length} recurring payments for $${group[0].amount} in ${group[0].category}. Check if they are duplicates.`,
             type: 'warning',
             icon: 'search',
             color: '#f97316',
             isAI: true,
             actionType: 'view_recurring',
          });
       }
    });

    // 5. 📉 Budget Forecasting
    // Calculate daily average spend per category
    const catSpending: Record<string, number> = {};
    thisMonthTransactions.filter(t => t.type === 'EXPENSE').forEach(t => {
       const cat = t.category || 'Uncategorized';
       catSpending[cat] = (catSpending[cat] || 0) + t.amount;
    });

    budgets
      .filter((budget) => budget.start_date <= now && budget.end_date >= now)
      .forEach(budget => {
       const spent = catSpending[budget.category] || 0;
       const limit = BudgetService.calculateBudgetMetrics(budget, budgets, transactions).effectiveLimit;
       if (limit <= 0) {
         return;
       }
       const percent = spent / limit;
       
       // Alert if over 90%
       if (percent > 0.9 && percent <= 1.0) {
          notifications.push({
             title: `⚠️ Budget Alert: ${budget.category}`,
             message: `You've used ${(percent * 100).toFixed(0)}% of your ${budget.category} budget with ${daysInMonth - dayOfMonth} days left.`,
             type: 'warning',
             icon: 'pie-chart',
             color: '#f59e0b',
             isAI: true,
             actionType: 'view_budget',
          });
       }
       // Forecast
       const dailyAvg = spent / dayOfMonth;
       const projected = dailyAvg * daysInMonth;
       if (dayOfMonth > 10 && projected > limit && percent < 1.0) { // Only forecast after 10 days
          notifications.push({
             title: `📈 Budget Forecast: ${budget.category}`,
             message: `At this rate, you'll exceed your budget by $${(projected - limit).toFixed(0)}.`,
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
