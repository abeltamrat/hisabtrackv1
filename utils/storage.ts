import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Category, Transaction } from '../context/TransactionContext';

const TRANSACTIONS_KEY = '@hisabtrack_transactions';
const CATEGORIES_KEY = '@hisabtrack_categories';

export const StorageService = {
  // Transactions
  async saveTransactions(transactions: Transaction[]): Promise<void> {
    try {
      await AsyncStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(transactions));
    } catch (error) {
      console.error('Error saving transactions:', error);
    }
  },

  async loadTransactions(): Promise<Transaction[]> {
    try {
      const data = await AsyncStorage.getItem(TRANSACTIONS_KEY);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error('Error loading transactions:', error);
      return [];
    }
  },

  // Categories
  async saveCategories(categories: Category[]): Promise<void> {
    try {
      await AsyncStorage.setItem(CATEGORIES_KEY, JSON.stringify(categories));
    } catch (error) {
      console.error('Error saving categories:', error);
    }
  },

  async loadCategories(): Promise<Category[]> {
    try {
      const data = await AsyncStorage.getItem(CATEGORIES_KEY);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error('Error loading categories:', error);
      return [];
    }
  },

  // Clear all data
  async clearAll(): Promise<void> {
    try {
      await AsyncStorage.multiRemove([TRANSACTIONS_KEY, CATEGORIES_KEY, '@hisabtrack_recurring_transactions', 'notifications']);
    } catch (error) {
      console.error('Error clearing storage:', error);
    }
  },
};
