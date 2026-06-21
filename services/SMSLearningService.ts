import AsyncStorage from '@react-native-async-storage/async-storage';

export interface SMSRule {
    merchant?: string;
    referencePrefix?: string;
    category: string;
    description: string;
    matchBy: 'merchant' | 'reference';
}

export class SMSLearningService {
    private static STORAGE_KEY = 'sms_learning_rules';

    /**
     * Save a learning rule based on user correction (Account-based)
     */
    static async learn(input: {
        accountId: string;
        sender: string;
        rawMerchant?: string;
        referenceNumber?: string;
        correctedDescription: string;
        correctedCategory: string;
    }): Promise<void> {
        const rules = await this.getAllRules();
        const sender = this.normalizeText(input.sender);
        if (!sender) {
            return;
        }

        const merchantKey = this.buildMerchantKey(input.accountId, sender, input.rawMerchant);
        if (merchantKey) {
            rules[merchantKey] = {
                merchant: input.rawMerchant,
                category: input.correctedCategory,
                description: input.correctedDescription,
                matchBy: 'merchant',
            };
        }

        const referencePrefix = this.getReferencePrefix(input.referenceNumber);
        if (referencePrefix) {
            rules[this.buildReferenceKey(input.accountId, sender, referencePrefix)] = {
                referencePrefix,
                category: input.correctedCategory,
                description: input.correctedDescription,
                matchBy: 'reference',
            };
        }

        await this.saveAllRules(rules);
    }

    /**
     * Get a learned rule for a merchant or sender/reference pattern
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
        if (merchantKey && rules[merchantKey]) {
            return rules[merchantKey];
        }

        const referencePrefix = this.getReferencePrefix(input.referenceNumber);
        if (referencePrefix) {
            const referenceKey = this.buildReferenceKey(input.accountId, sender, referencePrefix);
            if (rules[referenceKey]) {
                return rules[referenceKey];
            }
        }

        return null;
    }

    private static buildMerchantKey(accountId: string, sender: string, rawMerchant?: string) {
        const merchant = this.normalizeText(rawMerchant);
        if (!merchant) {
            return null;
        }
        return `${accountId}_merchant_${sender}_${merchant}`;
    }

    private static buildReferenceKey(accountId: string, sender: string, referencePrefix: string) {
        return `${accountId}_reference_${sender}_${referencePrefix}`;
    }

    private static normalizeText(value?: string) {
        return (value || '')
            .trim()
            .toLowerCase()
            .replace(/\s+/g, ' ');
    }

    private static getReferencePrefix(referenceNumber?: string) {
        const normalized = (referenceNumber || '')
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '');

        if (normalized.length < 3) {
            return '';
        }

        return normalized.slice(0, 6);
    }

    static async saveAllRules(rules: Record<string, SMSRule>) {
        try {
            await AsyncStorage.setItem(this.STORAGE_KEY, JSON.stringify(rules));
        } catch (e) {
            console.error('Failed to save SMS learning rules', e);
        }
    }

    /**
     * Get all learning rules
     */
    static async getAllRules(): Promise<Record<string, SMSRule>> {
        try {
            const stored = await AsyncStorage.getItem(this.STORAGE_KEY);
            return stored ? JSON.parse(stored) : {};
        } catch (e) {
            console.error('Failed to load SMS learning rules', e);
            return {};
        }
    }

    /**
     * Clear rules for a specific account
     */
    static async clearRulesForAccount(accountId: string): Promise<void> {
        const rules = await this.getAllRules();
        const newRules: Record<string, SMSRule> = {};
        for (const k in rules) {
            if (!k.startsWith(`${accountId}_`)) {
                newRules[k] = rules[k];
            }
        };
        await this.saveAllRules(newRules);
    }

    /**
     * Clear all learned rules
     */
    static async clearAllRules(): Promise<void> {
        await AsyncStorage.removeItem(this.STORAGE_KEY);
    }
}
