import AsyncStorage from '@/services/SessionStorage';
import { createSerialQueue } from '@/utils/asyncLock';
import type { SmartAlertFeedback } from '@/utils/phase2Intelligence';

const FEEDBACK_KEY = 'smart_alert_feedback';
const RECURRING_KEY = 'recurring_review_decisions';
const mutate = createSerialQueue();

export interface RecurringReviewDecision { alertId: string; decision: 'SKIPPED' | 'MOVED' | 'AMOUNT_ACCEPTED' | 'DISMISSED'; at: number }

export class SmartReviewService {
  static async getAlertFeedback(): Promise<SmartAlertFeedback[]> {
    const raw = await AsyncStorage.getItem(FEEDBACK_KEY);
    try { return raw ? JSON.parse(raw) : []; } catch { return []; }
  }

  static async setAlertFeedback(alertId: string, decision: SmartAlertFeedback['decision']): Promise<void> {
    await mutate(async () => {
      const existing = (await this.getAlertFeedback()).filter(item => item.alertId !== alertId);
      await AsyncStorage.setItem(FEEDBACK_KEY, JSON.stringify([...existing, { alertId, decision, at: Date.now() }].slice(-500)));
    });
  }

  static async getRecurringDecisions(): Promise<RecurringReviewDecision[]> {
    const raw = await AsyncStorage.getItem(RECURRING_KEY);
    try { return raw ? JSON.parse(raw) : []; } catch { return []; }
  }

  static async setRecurringDecision(alertId: string, decision: RecurringReviewDecision['decision']): Promise<void> {
    await mutate(async () => {
      const existing = (await this.getRecurringDecisions()).filter(item => item.alertId !== alertId);
      await AsyncStorage.setItem(RECURRING_KEY, JSON.stringify([...existing, { alertId, decision, at: Date.now() }].slice(-500)));
    });
  }

  static async clearAll(): Promise<void> { await AsyncStorage.multiRemove([FEEDBACK_KEY, RECURRING_KEY]); }
}

export default SmartReviewService;
