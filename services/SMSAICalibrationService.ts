import AsyncStorage from '@/services/SessionStorage';
import { createSerialQueue } from '@/utils/asyncLock';

export interface SMSCalibrationFields {
  amount?: number;
  type?: 'INCOME' | 'EXPENSE';
  accountNumber?: string;
  merchant?: string;
  referenceNumber?: string;
  balance?: number;
  fees?: number;
  tax?: number;
  isLoanDisbursement?: boolean;
}

export interface SMSCalibrationExample {
  id: string;
  accountId: string;
  sender: string;
  rawMessage: string;
  fields: SMSCalibrationFields;
  verifiedAt: number;
}

export class SMSAICalibrationService {
  private static readonly STORAGE_KEY = 'sms_ai_calibration_examples';
  private static readonly mutate = createSerialQueue();
  private static readonly MAX_PER_ACCOUNT = 8;

  static async getForAccount(accountId: string): Promise<SMSCalibrationExample[]> {
    const all = await this.getAll();
    return all.filter(item => item.accountId === accountId).sort((a, b) => b.verifiedAt - a.verifiedAt);
  }

  static save(example: Omit<SMSCalibrationExample, 'id' | 'verifiedAt'>): Promise<SMSCalibrationExample> {
    return this.mutate(async () => {
      const all = await this.getAll();
      const saved: SMSCalibrationExample = {
        ...example,
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        verifiedAt: Date.now(),
      };
      const others = all.filter(item => item.accountId !== example.accountId);
      const accountItems = [saved, ...all.filter(item => item.accountId === example.accountId)]
        .slice(0, this.MAX_PER_ACCOUNT);
      await AsyncStorage.setItem(this.STORAGE_KEY, JSON.stringify([...others, ...accountItems]));
      return saved;
    });
  }

  static clearForAccount(accountId: string): Promise<void> {
    return this.mutate(async () => {
      const all = await this.getAll();
      await AsyncStorage.setItem(this.STORAGE_KEY, JSON.stringify(all.filter(item => item.accountId !== accountId)));
    });
  }

  private static async getAll(): Promise<SMSCalibrationExample[]> {
    try {
      const raw = await AsyncStorage.getItem(this.STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }
}
