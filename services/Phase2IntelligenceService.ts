import { DraftTransactionService } from '@/services/DraftTransactionService';
import { RecurringTransactionService } from '@/services/RecurringTransactionService';
import RecipientIdentityService, { type RecipientMergeSuggestion, type RecipientProfile } from '@/services/RecipientIdentityService';
import SmartReviewService from '@/services/SmartReviewService';
import { analyzeRecurringExpectations, analyzeSmsIntelligence, findRecurringEvidence, normalizeRecipient, type RecurringAlert, type SmartAlert } from '@/utils/phase2Intelligence';
import type { Account, Transaction } from '@/types/database';

export interface Phase2ReviewSnapshot {
  smsAlerts: SmartAlert[];
  recurringAlerts: RecurringAlert[];
  recipientSuggestions: RecipientMergeSuggestion[];
  recipientProfiles: RecipientProfile[];
}

export class Phase2IntelligenceService {
  static async analyze(transactions: Transaction[], accounts: Account[], now = Date.now()): Promise<Phase2ReviewSnapshot> {
    const initialRecurring = await RecurringTransactionService.getAll();
    for (const rule of initialRecurring.filter(item => item.isActive && item.nextDate <= now)) {
      if (findRecurringEvidence(rule, transactions).exact) await RecurringTransactionService.settleObservedOccurrence(rule.id, rule.nextDate);
    }
    const [drafts, recurring, feedback, decisions, profiles] = await Promise.all([
      DraftTransactionService.getAll(), RecurringTransactionService.getAll(), SmartReviewService.getAlertFeedback(), SmartReviewService.getRecurringDecisions(), RecipientIdentityService.getAll(),
    ]);
    const decidedRecurring = new Set(decisions.map(item => item.alertId));
    const profileByAlias = new Map<string, string>();
    for (const profile of profiles) for (const alias of profile.aliases) profileByAlias.set(normalizeRecipient(alias), profile.id);
    const recipientSuggestions = RecipientIdentityService.suggestMerges(drafts, accounts.flatMap(account => [account.name, ...(account.aliases || [])]))
      .filter(suggestion => {
        const left = profileByAlias.get(normalizeRecipient(suggestion.left));
        const right = profileByAlias.get(normalizeRecipient(suggestion.right));
        return !left || !right || left !== right;
      });
    return {
      smsAlerts: analyzeSmsIntelligence(drafts, feedback),
      recurringAlerts: analyzeRecurringExpectations(recurring, transactions, now).filter(alert => !decidedRecurring.has(alert.id)),
      recipientSuggestions,
      recipientProfiles: profiles,
    };
  }
}

export default Phase2IntelligenceService;
