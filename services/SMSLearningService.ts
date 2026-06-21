import AsyncStorage from '@react-native-async-storage/async-storage';

export interface SMSRule {
  merchant?: string;
  referencePrefix?: string;
  category: string;
  description: string;
  matchBy: 'merchant' | 'reference' | 'sender';
  hitCount?: number;
  confidence?: number;
}

export class SMSLearningService {
  private static STORAGE_KEY = 'sms_learning_rules';

  /**
   * Save a learning rule from user correction or acceptance.
   *
   * Priority order for rule keys (highest to lowest):
   *   1. merchant key  (account + sender + normalised merchant name)
   *   2. reference key (account + sender + first-6 chars of ref number)
   *   3. sender key    (account + sender — catches transactions with no merchant)
   */
  static async learn(input: {
    accountId: string;
    sender: string;
    rawMerchant?: string;
    referenceNumber?: string;
    correctedDescription: string;
    correctedCategory: string;
    isCorrection?: boolean;
  }): Promise<void> {
    const rules = await this.getAllRules();
    const sender = this.normalizeText(input.sender);
    if (!sender) return;

    let saved = false;
    const isCorrection = input.isCorrection !== false; // default to true if not specified

    const merchantKey = this.buildMerchantKey(input.accountId, sender, input.rawMerchant);
    if (merchantKey) {
      const existing = rules[merchantKey];
      const prevHits = existing?.hitCount || 0;
      const prevConf = existing?.confidence ?? 0.8;
      rules[merchantKey] = {
        merchant: input.rawMerchant,
        category: input.correctedCategory,
        description: input.correctedDescription,
        matchBy: 'merchant',
        hitCount: prevHits + 1,
        confidence: isCorrection ? 1.0 : Math.min(1.0, prevConf + 0.05),
      };
      saved = true;
    }

    const referencePrefix = this.getReferencePrefix(input.referenceNumber);
    if (referencePrefix) {
      const refKey = this.buildReferenceKey(input.accountId, sender, referencePrefix);
      const existing = rules[refKey];
      const prevHits = existing?.hitCount || 0;
      const prevConf = existing?.confidence ?? 0.8;
      rules[refKey] = {
        referencePrefix,
        category: input.correctedCategory,
        description: input.correctedDescription,
        matchBy: 'reference',
        hitCount: prevHits + 1,
        confidence: isCorrection ? 1.0 : Math.min(1.0, prevConf + 0.05),
      };
      saved = true;
    }

    // Sender-level fallback: when there's no merchant or reference to key on,
    // store a general rule for this sender so future transactions from the same
    // bank sender get a sensible default.
    if (!saved) {
      const senderKey = this.buildSenderKey(input.accountId, sender);
      const existing = rules[senderKey];
      const prevHits = existing?.hitCount || 0;
      const prevConf = existing?.confidence ?? 0.8;
      rules[senderKey] = {
        category: input.correctedCategory,
        description: input.correctedDescription,
        matchBy: 'sender',
        hitCount: prevHits + 1,
        confidence: isCorrection ? 1.0 : Math.min(1.0, prevConf + 0.05),
      };
    }

    await this.saveAllRules(rules);
  }

  /**
   * Get the best matching rule for a transaction, searching in priority order:
   *   1. merchant  (most specific)
   *   2. reference prefix
   *   3. sender    (broadest fallback)
   */
  static async getRule(input: {
    accountId: string;
    sender: string;
    rawMerchant?: string;
    referenceNumber?: string;
  }): Promise<SMSRule | null> {
    const sender = this.normalizeText(input.sender);
    if (!sender) return null;

    const rules = await this.getAllRules();

    const merchantKey = this.buildMerchantKey(input.accountId, sender, input.rawMerchant);
    if (merchantKey && rules[merchantKey]) return rules[merchantKey];

    const referencePrefix = this.getReferencePrefix(input.referenceNumber);
    if (referencePrefix) {
      const referenceKey = this.buildReferenceKey(input.accountId, sender, referencePrefix);
      if (rules[referenceKey]) return rules[referenceKey];
    }

    // Sender-level fallback
    const senderKey = this.buildSenderKey(input.accountId, sender);
    if (rules[senderKey]) return rules[senderKey];

    return null;
  }

  // ── Key builders ──────────────────────────────────────────────────────────

  private static buildMerchantKey(accountId: string, sender: string, rawMerchant?: string): string | null {
    const { EnhancedSMSParser } = require('@/utils/enhancedSMSParser');
    const cleaned = EnhancedSMSParser.cleanMerchantName(rawMerchant);
    const merchant = this.normalizeText(cleaned || rawMerchant);
    if (!merchant) return null;
    return `${accountId}_merchant_${sender}_${merchant}`;
  }

  private static buildReferenceKey(accountId: string, sender: string, referencePrefix: string): string {
    return `${accountId}_reference_${sender}_${referencePrefix}`;
  }

  private static buildSenderKey(accountId: string, sender: string): string {
    return `${accountId}_sender_${sender}`;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private static normalizeText(value?: string): string {
    return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private static getReferencePrefix(referenceNumber?: string): string {
    const normalized = (referenceNumber ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return normalized.length >= 6 ? normalized.slice(0, 6) : '';
  }

  // ── Storage ───────────────────────────────────────────────────────────────

  static async saveAllRules(rules: Record<string, SMSRule>): Promise<void> {
    try {
      await AsyncStorage.setItem(this.STORAGE_KEY, JSON.stringify(rules));
    } catch (e) {
      console.error('Failed to save SMS learning rules', e);
    }
  }

  static async getAllRules(): Promise<Record<string, SMSRule>> {
    try {
      const stored = await AsyncStorage.getItem(this.STORAGE_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch (e) {
      console.error('Failed to load SMS learning rules', e);
      return {};
    }
  }

  static async clearRulesForAccount(accountId: string): Promise<void> {
    const rules = await this.getAllRules();
    const newRules: Record<string, SMSRule> = {};
    for (const k in rules) {
      if (!k.startsWith(`${accountId}_`)) newRules[k] = rules[k];
    }
    await this.saveAllRules(newRules);
  }

  static async clearAllRules(): Promise<void> {
    await AsyncStorage.removeItem(this.STORAGE_KEY);
  }

  static async deleteRule(key: string): Promise<void> {
    const rules = await this.getAllRules();
    if (rules[key]) {
      delete rules[key];
      await this.saveAllRules(rules);
    }
  }

  static async updateRule(key: string, updated: Partial<SMSRule>): Promise<void> {
    const rules = await this.getAllRules();
    if (rules[key]) {
      rules[key] = {
        ...rules[key],
        ...updated,
        confidence: 1.0,
      } as SMSRule;
      await this.saveAllRules(rules);
    }
  }
}
