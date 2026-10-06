import { sessionLocalStorage } from '@/services/SessionStorage';
import { CATEGORIES } from '@/constants/MockData';
import { useAuth } from '@/contexts/AuthContext';
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
  const { user } = useAuth();

  const loadFromStorage = React.useCallback(async () => {
    try {
      const { StorageService } = await import('@/utils/storage');
      const storedCategories = await StorageService.loadCategories();
      if (storedCategories.length > 0) {
        setCategories(storedCategories.map(cat => ({
          ...cat,
          type: cat.type.toLowerCase() as TransactionType,
        })));
      } else {
        setCategories(CATEGORIES.map(cat => ({
          ...cat,
          type: cat.type.toLowerCase() as TransactionType,
        })));
      }
    } catch {
      setCategories(CATEGORIES.map(cat => ({
        ...cat,
        type: cat.type.toLowerCase() as TransactionType,
      })));
    }
  }, []);

  // Reload categories whenever the logged-in user changes (covers logout → new login)
  React.useEffect(() => {
    loadFromStorage().catch(() => {});
  }, [user?.uid, loadFromStorage]);

  // Reload categories after any sync (SyncService pulls categories from Firestore into AsyncStorage,
  // then DB operations fire LocalChangeEmitter — pick them up here)
  React.useEffect(() => {
    let unsub: (() => void) | null = null;
    import('@/services/LocalChangeEmitter').then(m => {
      unsub = m.default.subscribe(() => { loadFromStorage().catch(() => {}); });
    }).catch(() => {});
    return () => { if (unsub) unsub(); };
  }, [loadFromStorage]);
  const [isLoading, setIsLoading] = useState(false);

  const refreshCategories = loadFromStorage;

  const addCategory = async (categoryData: Omit<Category, 'id'>) => {
    if (!categoryData.name.trim() || categories.some(c => c.name === categoryData.name)) throw new Error('Choose a unique category name');
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

  const assertUnused = async (names: string[]) => {
    const db = await (await import('@/services/database')).getDatabase();
    const [transactions, budgets, rules] = await Promise.all([db.getTransactions(), db.getBudgets(), (await import('@/services/SMSLearningService')).SMSLearningService.getAllRules()]);
    const { Platform } = await import('react-native');
    const storage = (await import('@/services/SessionStorage')).default;
    const raw = Platform.OS === 'web' ? sessionLocalStorage.getItem('recurring_transactions') : await storage.getItem('@hisabtrack_recurring_transactions');
    const recurring = raw ? JSON.parse(raw) : [];
    if ([...transactions, ...budgets, ...recurring, ...Object.values(rules)].some(item => names.includes(item.category))) {
      throw new Error('This category is used by financial records or rules. Keep it to preserve history and create a new category instead.');
    }
  };
  const updateCategory = async (id: string, updates: Partial<Category>) => {
    const existing = categories.find(category => category.id === id);
    if (!existing) throw new Error('Category not found');
    if (updates.name !== undefined && (!updates.name.trim() || categories.some(c => c.id !== id && c.name === updates.name))) throw new Error('Choose a unique category name');
    if (updates.name && updates.name !== existing.name) await assertUnused([existing.name]);
    const next = categories.map(category => category.id === id ? { ...category, ...updates, id } : category);
    for (const category of next) {
      const seen = new Set<string>(); let current: Category | undefined = category;
      while (current) {
        if (seen.has(current.id)) throw new Error('Categories cannot contain a parent cycle');
        seen.add(current.id); current = next.find(c => c.id === current?.parentId);
      }
    }
    await (await import('@/utils/storage')).StorageService.saveCategories(next);
    setCategories(next);
  };
  const deleteCategory = async (id: string) => {
    const ids = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const category of categories) if (category.parentId && ids.has(category.parentId) && !ids.has(category.id)) { ids.add(category.id); changed = true; }
    }
    await assertUnused(categories.filter(c => ids.has(c.id)).map(c => c.name));
    const next = categories.filter(category => !ids.has(category.id));
    await (await import('@/utils/storage')).StorageService.saveCategories(next);
    setCategories(next);
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
