import { CATEGORIES } from '@/constants/MockData';
import React, { createContext, useContext, useState } from 'react';

export type TransactionType = 'income' | 'expense';

export interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  type: TransactionType;
  parentId?: string;
}

interface TransactionContextType {
  categories: Category[];
  addCategory: (category: Omit<Category, 'id'>) => Promise<void>;
  updateCategory: (id: string, updates: Partial<Category>) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  refreshCategories: () => Promise<void>;
  isLoading: boolean;
}

const TransactionContext = createContext<TransactionContextType | undefined>(undefined);

export function TransactionProvider({ children }: { children: React.ReactNode }) {
  const [categories, setCategories] = useState<Category[]>([]);

  // Load categories from storage
  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { StorageService } = await import('@/utils/storage');
        const storedCategories = await StorageService.loadCategories();
        if (mounted) {
          if (storedCategories.length > 0) {
            // Transform stored categories to match context format
            const transformedCategories: Category[] = storedCategories.map(cat => ({
              ...cat,
              type: cat.type.toLowerCase() as TransactionType,
            }));
            setCategories(transformedCategories);
          } else {
            // Use default categories if none stored
            const defaultCategories = CATEGORIES.map(cat => ({
              ...cat,
              type: cat.type.toLowerCase() as TransactionType,
            }));
            setCategories(defaultCategories);
          }
        }
      } catch (e) {
        // Fallback to default categories
        const defaultCategories = CATEGORIES.map(cat => ({
          ...cat,
          type: cat.type.toLowerCase() as TransactionType,
        }));
        if (mounted) {
          setCategories(defaultCategories);
        }
      }
    })();
    return () => { mounted = false; };
  }, []);
  const [isLoading, setIsLoading] = useState(false);

  const refreshCategories = async () => {
    try {
      const { StorageService } = await import('@/utils/storage');
      const storedCategories = await StorageService.loadCategories();
      if (storedCategories.length > 0) {
        const transformedCategories: Category[] = storedCategories.map(cat => ({
          ...cat,
          type: cat.type.toLowerCase() as TransactionType,
        }));
        setCategories(transformedCategories);
      } else {
        const defaultCategories = CATEGORIES.map(cat => ({
          ...cat,
          type: cat.type.toLowerCase() as TransactionType,
        }));
        setCategories(defaultCategories);
      }
    } catch (e) {
      const defaultCategories = CATEGORIES.map(cat => ({
        ...cat,
        type: cat.type.toLowerCase() as TransactionType,
      }));
      setCategories(defaultCategories);
    }
  };

  const addCategory = async (categoryData: Omit<Category, 'id'>) => {
    const newCategory: Category = {
      ...categoryData,
      id: Date.now().toString(),
    };
    const updatedCategories = [...categories, newCategory];
    setCategories(updatedCategories);
    
    try {
      const { StorageService } = await import('@/utils/storage');
      await StorageService.saveCategories(updatedCategories);
    } catch (error) {
      console.error('Error saving categories:', error);
      // Revert on error
      setCategories(categories);
      throw error;
    }
  };

  const updateCategory = async (id: string, updates: Partial<Category>) => {
    const existing = categories.find(cat => cat.id === id);
    const updatedCategories = categories.map(cat =>
      cat.id === id ? { ...cat, ...updates } : cat
    );
    setCategories(updatedCategories);

    try {
      const { StorageService } = await import('@/utils/storage');
      await StorageService.saveCategories(updatedCategories);

      if (existing && updates.name && updates.name !== existing.name) {
        const oldName = existing.name;
        const newName = updates.name;

        // 1. Cascade to Budgets (database)
        try {
          const { getDatabase } = await import('@/services/database');
          const db = await getDatabase();
          const budgets = await db.getBudgets();
          const affectedBudgets = budgets.filter(b => b.category === oldName);
          await Promise.all(
            affectedBudgets.map(b => db.updateBudget({ ...b, category: newName }))
          );
          if (affectedBudgets.length > 0) {
            console.log(`[TransactionContext] Cascaded category rename to ${affectedBudgets.length} budget(s)`);
          }
        } catch (err) {
          console.warn('[TransactionContext] Budget cascade rename failed:', err);
        }

        // 2. Cascade to Transactions (database)
        try {
          const { getDatabase } = await import('@/services/database');
          const db = await getDatabase();
          const transactions = await db.getTransactions();
          const affectedTxs = transactions.filter(tx => tx.category === oldName);
          await Promise.all(
            affectedTxs.map(tx => db.updateTransaction(tx.id, { category: newName }))
          );
          if (affectedTxs.length > 0) {
            console.log(`[TransactionContext] Cascaded category rename to ${affectedTxs.length} transaction(s)`);
          }
        } catch (err) {
          console.warn('[TransactionContext] Transaction cascade rename failed:', err);
        }

        // 3. Cascade to RecurringTransactions (AsyncStorage/localStorage)
        try {
          const { Platform } = await import('react-native');
          const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
          let loaded: any[] = [];
          if (Platform.OS === 'web') {
            const stored = localStorage.getItem('recurring_transactions');
            if (stored) loaded = JSON.parse(stored);
          } else {
            const stored = await AsyncStorage.getItem('@hisabtrack_recurring_transactions');
            if (stored) loaded = JSON.parse(stored);
          }

          let modified = false;
          const updatedRecurring = loaded.map(rt => {
            if (rt.category === oldName) {
              modified = true;
              return { ...rt, category: newName };
            }
            return rt;
          });

          if (modified) {
            if (Platform.OS === 'web') {
              localStorage.setItem('recurring_transactions', JSON.stringify(updatedRecurring));
            } else {
              await AsyncStorage.setItem('@hisabtrack_recurring_transactions', JSON.stringify(updatedRecurring));
            }
            console.log('[TransactionContext] Cascaded category rename to recurring transactions');
          }
        } catch (err) {
          console.warn('[TransactionContext] Recurring transactions cascade rename failed:', err);
        }

        // 4. Cascade to SMSLearningRules (AsyncStorage)
        try {
          const { SMSLearningService } = await import('@/services/SMSLearningService');
          const rules = await SMSLearningService.getAllRules();
          let modified = false;
          for (const key in rules) {
            if (rules[key].category === oldName) {
              rules[key].category = newName;
              modified = true;
            }
          }
          if (modified) {
            await SMSLearningService.saveAllRules(rules);
            console.log('[TransactionContext] Cascaded category rename to SMS learning rules');
          }
        } catch (err) {
          console.warn('[TransactionContext] SMS learning rules cascade rename failed:', err);
        }

        // Emit local change to notify UI
        try {
          const LocalChangeEmitter = (await import('@/services/LocalChangeEmitter')).default;
          LocalChangeEmitter.emit();
        } catch (err) {
          console.warn('[TransactionContext] Failed to emit local changes:', err);
        }
      }
    } catch (error) {
      console.error('Error saving categories:', error);
      // Revert on error
      setCategories(categories);
      throw error;
    }
  };

  const deleteCategory = async (id: string) => {
    const deletedCats = categories.filter(cat => cat.id === id || cat.parentId === id);
    const deletedNames = deletedCats.map(cat => cat.name);

    const updatedCategories = categories.filter(cat => cat.id !== id && cat.parentId !== id);
    setCategories(updatedCategories);
    
    try {
      const { StorageService } = await import('@/utils/storage');
      await StorageService.saveCategories(updatedCategories);

      if (deletedNames.length > 0) {
        // 1. Cascade to Budgets (database): delete budget for the deleted categories
        try {
          const { getDatabase } = await import('@/services/database');
          const db = await getDatabase();
          const budgets = await db.getBudgets();
          const affectedBudgets = budgets.filter(b => deletedNames.includes(b.category));
          await Promise.all(
            affectedBudgets.map(b => db.deleteBudget(b.id))
          );
          if (affectedBudgets.length > 0) {
            console.log(`[TransactionContext] Cascaded category deletion to delete ${affectedBudgets.length} budget(s)`);
          }
        } catch (err) {
          console.warn('[TransactionContext] Budget cascade delete failed:', err);
        }

        // 2. Cascade to Transactions (database): migrate to 'Other'
        try {
          const { getDatabase } = await import('@/services/database');
          const db = await getDatabase();
          const transactions = await db.getTransactions();
          const affectedTxs = transactions.filter(tx => deletedNames.includes(tx.category));
          await Promise.all(
            affectedTxs.map(tx => db.updateTransaction(tx.id, { category: 'Other' }))
          );
          if (affectedTxs.length > 0) {
            console.log(`[TransactionContext] Cascaded category deletion to migrate ${affectedTxs.length} transaction(s) to 'Other'`);
          }
        } catch (err) {
          console.warn('[TransactionContext] Transaction cascade migrate failed:', err);
        }

        // 3. Cascade to RecurringTransactions (AsyncStorage/localStorage): migrate to 'Other'
        try {
          const { Platform } = await import('react-native');
          const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
          let loaded: any[] = [];
          if (Platform.OS === 'web') {
            const stored = localStorage.getItem('recurring_transactions');
            if (stored) loaded = JSON.parse(stored);
          } else {
            const stored = await AsyncStorage.getItem('@hisabtrack_recurring_transactions');
            if (stored) loaded = JSON.parse(stored);
          }

          let modified = false;
          const updatedRecurring = loaded.map(rt => {
            if (deletedNames.includes(rt.category)) {
              modified = true;
              return { ...rt, category: 'Other' };
            }
            return rt;
          });

          if (modified) {
            if (Platform.OS === 'web') {
              localStorage.setItem('recurring_transactions', JSON.stringify(updatedRecurring));
            } else {
              await AsyncStorage.setItem('@hisabtrack_recurring_transactions', JSON.stringify(updatedRecurring));
            }
            console.log('[TransactionContext] Cascaded category deletion to recurring transactions');
          }
        } catch (err) {
          console.warn('[TransactionContext] Recurring transactions cascade migrate failed:', err);
        }

        // 4. Cascade to SMSLearningRules (AsyncStorage): migrate to 'Other'
        try {
          const { SMSLearningService } = await import('@/services/SMSLearningService');
          const rules = await SMSLearningService.getAllRules();
          let modified = false;
          for (const key in rules) {
            if (deletedNames.includes(rules[key].category)) {
              rules[key].category = 'Other';
              modified = true;
            }
          }
          if (modified) {
            await SMSLearningService.saveAllRules(rules);
            console.log('[TransactionContext] Cascaded category deletion to SMS learning rules');
          }
        } catch (err) {
          console.warn('[TransactionContext] SMS learning rules cascade migrate failed:', err);
        }

        // Emit local change to notify UI
        try {
          const LocalChangeEmitter = (await import('@/services/LocalChangeEmitter')).default;
          LocalChangeEmitter.emit();
        } catch (err) {
          console.warn('[TransactionContext] Failed to emit local changes:', err);
        }
      }
    } catch (error) {
      console.error('Error saving categories during deletion:', error);
      // Revert on error
      setCategories(categories);
      throw error;
    }
  };

  return (
    <TransactionContext.Provider
      value={{
        categories,
        addCategory,
        updateCategory,
        deleteCategory,
        refreshCategories,
        isLoading,
      }}
    >
      {children}
    </TransactionContext.Provider>
  );
}

export function useTransactions() {
  const context = useContext(TransactionContext);
  if (context === undefined) {
    throw new Error('useTransactions must be used within a TransactionProvider');
  }
  return context;
}
