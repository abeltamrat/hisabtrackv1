import type { Account, Budget, Loan, RecurringTransaction, Transaction } from '@/types/database';
import type { AppNotification } from './AppNotificationService';
import Storage from './SessionStorage';
import { money, operatingExpense, operatingIncome } from '@/utils/finance';

/**
 * Alerts the existing smart notifications don't cover, detected locally:
 *  - a charge far above what the user normally pays that merchant/category,
 *  - a large income arriving (salary), with a concrete savings nudge.
 * Plus one AI-written daily briefing from the tool-calling agent, so the
 * text is grounded in real records rather than a template.
 */

type Alert = Omit<AppNotification, 'id' | 'timestamp' | 'read'>;

const DAY = 86400000;
const RECENT = 2 * DAY;
const HISTORY = 180 * DAY;
const BRIEFING_KEY = 'proactive_briefing_day';

const norm = (value?: string) => (value || '').toLowerCase().replace(/[^a-z0-9ሀ-፿]+/g, ' ').trim();
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export function detectUnusualSpending(transactions: Transaction[], currency: string, now = Date.now()): Alert[] {
  const alerts: Alert[] = [];
  const expenses = transactions.filter(tx => tx.type === 'EXPENSE' && operatingExpense(tx) > 0);
  for (const tx of expenses) {
    if (now - tx.date > RECENT || tx.date > now) continue;
    const amount = operatingExpense(tx);
    const earlier = expenses.filter(other => other.id !== tx.id && other.date < tx.date && tx.date - other.date <= HISTORY);
    const who = norm(tx.sender_receiver);
    const sameMerchant = who ? earlier.filter(o => norm(o.sender_receiver) === who) : [];
    const peers = sameMerchant.length >= 3 ? sameMerchant : earlier.filter(o => o.category === tx.category);
    if (peers.length < (sameMerchant.length >= 3 ? 3 : 5)) continue;
    const usual = median(peers.map(operatingExpense));
    // Both relative and absolute, so small items going from 20 to 70 don't alert.
    if (usual <= 0 || amount < usual * 3 || amount - usual < 300) continue;
    const label = sameMerchant.length >= 3 ? (tx.sender_receiver || tx.description) : tx.category;
    alerts.push({
      sourceKey: `proactive:unusual:${tx.id}`,
      title: `Unusual charge: ${label}`,
      message: `${currency} ${money(amount).toFixed(2)} on ${new Date(tx.date).toLocaleDateString()} is ${(amount / usual).toFixed(1)}× your usual ${currency} ${money(usual).toFixed(2)} for ${label}. Check it's correct.`,
      type: 'warning', icon: 'exclamation-triangle', color: '#d97706', actionType: 'view_transactions',
    });
  }
  return alerts;
}

export function detectIncomeArrived(transactions: Transaction[], currency: string, now = Date.now()): Alert[] {
  const incomes = transactions.filter(tx => tx.type === 'INCOME' && operatingIncome(tx) > 0);
  const alerts: Alert[] = [];
  for (const tx of incomes) {
    if (now - tx.date > RECENT || tx.date > now) continue;
    const amount = operatingIncome(tx);
    const earlier = incomes.filter(o => o.id !== tx.id && o.date < tx.date && tx.date - o.date <= HISTORY).map(operatingIncome);
    const isSalary = /salary|ደሞዝ|payroll/i.test(`${tx.category} ${tx.description}`);
    // A salary always counts; otherwise only an income clearly above the usual.
    if (!isSalary && (earlier.length < 3 || amount < median(earlier) * 2)) continue;
    const save = Math.round(amount * 0.2);
    alerts.push({
      sourceKey: `proactive:income:${tx.id}`,
      title: 'Income received',
      message: `${currency} ${money(amount).toFixed(2)} arrived${tx.sender_receiver ? ` from ${tx.sender_receiver}` : ''}. Setting aside 20% (${currency} ${save.toFixed(2)}) now, before spending starts, is the easiest way to save.`,
      type: 'success', icon: 'money', color: '#059669', actionType: 'view_budget',
    });
  }
  return alerts;
}

export interface ProactiveInput {
  transactions: Transaction[]; accounts: Account[]; budgets: Budget[]; loans: Loan[];
  recurring: RecurringTransaction[]; categories: string[];
}

export class ProactiveInsightsService {
  static async run(input: ProactiveInput): Promise<void> {
    const { AppNotificationService } = await import('./AppNotificationService');
    const currency = input.accounts[0]?.currency || 'ETB';
    for (const alert of [...detectUnusualSpending(input.transactions, currency), ...detectIncomeArrived(input.transactions, currency)]) {
      await AppNotificationService.addNotification(alert);
    }
    await this.dailyBriefing(input).catch(error => console.warn('Daily briefing skipped:', error));
  }

  /** One AI-written briefing per day (after 7am), only with a tool-capable provider and AI sharing on. */
  private static async dailyBriefing(input: ProactiveInput): Promise<void> {
    const now = new Date();
    if (now.getHours() < 7 || !input.transactions.length) return;
    const today = now.toISOString().slice(0, 10);
    if ((await Storage.getItem(BRIEFING_KEY)) === today) return;

    const { loadStoredAppSettings } = await import('@/contexts/AppSettingsContext');
    const settings = await loadStoredAppSettings();
    const { default: FinancialAgent } = await import('./FinancialAgent');
    const keys = { topToolsApiKey: settings.topToolsApiKey, groqApiKey: settings.groqApiKey };
    if (!settings.aiSharingEnabled || !FinancialAgent.isAvailable(keys)) return;

    const goals = JSON.parse((await Storage.getItem('financial_goals')) || '[]');
    const result = await FinancialAgent.run(
      'Write my daily money briefing in at most 3 short sentences: yesterday\'s spending vs my usual day, the one budget or bill that needs attention this week, and one concrete action for today. Use real numbers from the tools. No greeting, no headings.',
      [],
      { ...input, goals, currency: input.accounts[0]?.currency || 'ETB' },
      keys,
    );
    const { AppNotificationService } = await import('./AppNotificationService');
    await AppNotificationService.addNotification({
      sourceKey: `proactive:briefing:${today}`, title: 'Your daily briefing', message: result.answer.slice(0, 600),
      type: 'tip', icon: 'lightbulb-o', color: '#6366f1', isAI: true, actionType: 'view_reports',
    });
    await Storage.setItem(BRIEFING_KEY, today);
  }
}

export default ProactiveInsightsService;
