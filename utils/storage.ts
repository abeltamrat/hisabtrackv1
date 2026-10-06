import AsyncStorage from '@/services/SessionStorage';
import type { Category } from '../context/TransactionContext';

const CATEGORIES_KEY = '@hisabtrack_categories';

export const StorageService = {
  // Categories
  async saveCategories(categories: Category[]): Promise<void> {
    try {
      const db = await (await import('@/services/database')).getDatabase();
      await db.writeSyncedMeta('categories', categories);
      await AsyncStorage.setItem(CATEGORIES_KEY, JSON.stringify(categories));
    } catch (error) {
      throw error;
    }
  },

  async loadCategories(): Promise<Category[]> {
    try {
      const db = await (await import('@/services/database')).getDatabase();
      const synced = await db.readMeta('synced_meta');
      if (synced?.categories) return synced.categories.items;
      const data = await AsyncStorage.getItem(CATEGORIES_KEY);
      const categories = data ? JSON.parse(data) : [];
      if (categories.length) await db.writeSyncedMeta('categories', categories);
      return categories;
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
