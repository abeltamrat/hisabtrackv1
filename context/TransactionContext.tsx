import { CATEGORIES, TRANSACTIONS as MOCK_TRANSACTIONS } from '@/constants/MockData';
import React, { createContext, useContext, useState } from 'react';

export type TransactionType = 'income' | 'expense';

export interface Transaction {
  id: string;
  amount: number;
  type: TransactionType;
  categoryId: string;
  date: string;
  note: string;
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  type: TransactionType;
  parentId?: string;
}

interface TransactionContextType {
  transactions: Transaction[];
  categories: Category[];
  addTransaction: (transaction: Omit<Transaction, 'id'>) => void;
  deleteTransaction: (id: string) => void;
  addCategory: (category: Omit<Category, 'id'>) => Promise<void>;
  updateCategory: (id: string, updates: Partial<Category>) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  refreshCategories: () => Promise<void>;
  isLoading: boolean;
}

const TransactionContext = createContext<TransactionContextType | undefined>(undefined);

export function TransactionProvider({ children }: { children: React.ReactNode }) {
  const [transactions, setTransactions] = useState<Transaction[]>([...MOCK_TRANSACTIONS]);
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

  const addTransaction = (transaction: Omit<Transaction, 'id'>) => {
    const newTransaction = {
      ...transaction,
      id: Math.random().toString(36).substr(2, 9),
    };
    setTransactions((prev) => [newTransaction, ...prev]);
  };

  // Load real transactions from the database if available (fallback to mocks)
  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { getDatabase } = await import('@/services/database');
        const db = await getDatabase();
        const rows = await db.getTransactions();
        if (mounted && Array.isArray(rows) && rows.length > 0) {
          // Transform database transactions to context format
          const transformedTransactions: Transaction[] = rows.map(dbTx => ({
            id: dbTx.id,
            amount: dbTx.amount,
            type: dbTx.type.toLowerCase() as TransactionType,
            categoryId: dbTx.category,
            date: new Date(dbTx.date).toISOString().split('T')[0], // Convert timestamp to date string
            note: dbTx.description || '',
          }));
          setTransactions(transformedTransactions);
        }
      } catch (e) {
        // If database isn't available or fails, keep using mock transactions
      }
    })();
    return () => { mounted = false; };
  }, []);

  const deleteTransaction = (id: string) => {
    setTransactions((prev) => prev.filter((t) => t.id !== id));
  };

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
    const updatedCategories = categories.map(cat => 
      cat.id === id ? { ...cat, ...updates } : cat
    );
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

  const deleteCategory = async (id: string) => {
    const updatedCategories = categories.filter(cat => cat.id !== id && cat.parentId !== id);
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

  return (
    <TransactionContext.Provider
      value={{
        transactions,
        categories,
        addTransaction,
        deleteTransaction,
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
