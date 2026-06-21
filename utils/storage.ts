import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Category } from '../context/TransactionContext';

const CATEGORIES_KEY = '@hisabtrack_categories';

export const StorageService = {
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
      await AsyncStorage.multiRemove([CATEGORIES_KEY, '@hisabtrack_recurring_transactions', 'notifications']);
    } catch (error) {
      console.error('Error clearing storage:', error);
    }
  },
};
