import BUNDLED_LOGOS from '@/assets/bankLogos/et';
import { Bank } from '@/types/bank';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BANKS_STORAGE_KEY = 'hisabtrack_banks';

export class BankService {
  /**
   * Get all bundled banks (pre-loaded Ethiopian banks)
   */
  static async getBundledBanks(): Promise<Bank[]> {
    return BUNDLED_LOGOS.map((logo, index) => {
      return {
        id: `bundled_${index}`,
        name: logo.name,
        logo: logo.url, // Keep the clean URL for display/editing
        logoSrc: logo.src, // Pass the require() result directly
        color: this.generateColorFromName(logo.name),
        country: 'ET',
        isBundled: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    });
  }

  /**
   * Get all custom (user-added) banks
   */
  static async getCustomBanks(): Promise<Bank[]> {
    try {
      const data = await AsyncStorage.getItem(BANKS_STORAGE_KEY);
      if (!data) return [];
      return JSON.parse(data);
    } catch (error) {
      console.error('Failed to load custom banks:', error);
      return [];
    }
  }

  /**
   * Get all banks (bundled + custom)
   */
  static async getAllBanks(): Promise<Bank[]> {
    const [bundled, custom] = await Promise.all([
      this.getBundledBanks(),
      this.getCustomBanks(),
    ]);
    return [...custom, ...bundled];
  }

  /**
   * Get a single bank by ID
   */
  static async getBankById(id: string): Promise<Bank | null> {
    const banks = await this.getAllBanks();
    return banks.find(bank => bank.id === id) || null;
  }

  /**
   * Add a new custom bank
   */
  static async addBank(bank: Omit<Bank, 'id' | 'createdAt' | 'updatedAt' | 'isBundled'>): Promise<Bank> {
    const customBanks = await this.getCustomBanks();
    const newBank: Bank = {
      ...bank,
      id: `custom_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      isBundled: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    customBanks.push(newBank);
    await AsyncStorage.setItem(BANKS_STORAGE_KEY, JSON.stringify(customBanks));
    return newBank;
  }

  /**
   * Update an existing custom bank
   */
  static async updateBank(id: string, updates: Partial<Bank>): Promise<Bank | null> {
    const customBanks = await this.getCustomBanks();
    const index = customBanks.findIndex(bank => bank.id === id);
    
    if (index === -1) {
      throw new Error('Cannot update bundled banks');
    }

    customBanks[index] = {
      ...customBanks[index],
      ...updates,
      updatedAt: Date.now(),
    };

    await AsyncStorage.setItem(BANKS_STORAGE_KEY, JSON.stringify(customBanks));
    return customBanks[index];
  }

  /**
   * Delete a custom bank
   */
  static async deleteBank(id: string): Promise<void> {
    const customBanks = await this.getCustomBanks();
    const filtered = customBanks.filter(bank => bank.id !== id);
    
    if (filtered.length === customBanks.length) {
      throw new Error('Cannot delete bundled banks');
    }

    await AsyncStorage.setItem(BANKS_STORAGE_KEY, JSON.stringify(filtered));
  }

  /**
   * Search banks by name
   */
  static async searchBanks(query: string): Promise<Bank[]> {
    const allBanks = await this.getAllBanks();
    const lowerQuery = query.toLowerCase();
    return allBanks.filter(bank => 
      bank.name.toLowerCase().includes(lowerQuery) ||
      bank.country?.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Get banks by country
   */
  static async getBanksByCountry(country: string): Promise<Bank[]> {
    const allBanks = await this.getAllBanks();
    return allBanks.filter(bank => bank.country === country);
  }

  /**
   * Generate a color from bank name (for consistent branding)
   */
  private static generateColorFromName(name: string): string {
    const colors = [
      '#3b82f6', // blue
      '#10b981', // emerald
      '#f59e0b', // amber
      '#8b5cf6', // purple
      '#ef4444', // red
      '#06b6d4', // cyan
      '#ec4899', // pink
      '#14b8a6', // teal
    ];
    
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    return colors[Math.abs(hash) % colors.length];
  }

  /**
   * Import a bundled bank as a custom bank (for editing)
   */
  static async importBundledBank(bundledId: string): Promise<Bank> {
    const bundledBanks = await this.getBundledBanks();
    const bundled = bundledBanks.find(b => b.id === bundledId);
    
    if (!bundled) {
      throw new Error('Bundled bank not found');
    }

    return this.addBank({
      name: bundled.name,
      logo: bundled.logo,
      color: bundled.color,
      country: bundled.country,
    });
  }
}
