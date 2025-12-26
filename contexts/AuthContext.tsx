import { AuthService } from '@/services/AuthService';
import { getDatabase } from '@/services/database';
import { SecureStorageService } from '@/services/SecureStorageService';
import SyncService from '@/services/SyncService';
import { AppDispatch } from '@/store';
import { fetchAccounts, resetAccounts } from '@/store/slices/accountsSlice';
import { resetBudgets } from '@/store/slices/budgetsSlice';
import { resetLoans } from '@/store/slices/loansSlice';
import { fetchTransactions, resetTransactions } from '@/store/slices/transactionsSlice';
import { StorageService } from '@/utils/storage';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';

interface User {
  uid: string;
  email: string | null;
  displayName?: string | null;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const dispatch = useDispatch<AppDispatch>();
  const syncIntervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    // Check for stored user data on mount
    checkAuth();

    // Listen to auth state changes
    const unsubscribe = AuthService.onAuthStateChanged((firebaseUser) => {
      if (firebaseUser) {
        setUser({
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName,
        });
        // Trigger pull from Firestore and then refresh local store
        (async () => {
          try {
            await SyncService.pullAllForUser(firebaseUser.uid);
            // push local data to remote to ensure any local-only records are uploaded
            await SyncService.pushAllForUser(firebaseUser.uid);
            // refresh redux store
            dispatch(fetchAccounts());
            dispatch(fetchTransactions());
          } catch (err) {
            console.error('Error syncing data on sign-in', err);
          }
          // start real-time auto-sync (local changes push, remote changes pull)
          try {
            SyncService.startAutoSync(firebaseUser.uid);
          } catch (e) {
            console.error('Failed to start auto-sync', e);
          }
        })();
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return () => {
      unsubscribe();
      try { SyncService.stopAutoSync(); } catch (e) {}
    };
  }, []);


  const checkAuth = async () => {
    try {
      const userData = await SecureStorageService.getUserData();
      const token = await SecureStorageService.getToken();

      if (userData && token) {
        setUser(userData);
      }
    } catch (error) {
      console.error('Error checking auth:', error);
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    try {
      console.log('Starting logout process...');
      await AuthService.signOut();
      console.log('Firebase signOut successful');
      await SecureStorageService.clearAll();
      
      // Clear all local data stores to prevent leakage
      const db = await getDatabase();
      await db.clearAllData();
      await StorageService.clearAll();

      // Clear Redux state
      dispatch(resetAccounts());
      dispatch(resetTransactions());
      dispatch(resetBudgets());
      dispatch(resetLoans());

      console.log('Storage and State cleared');
      setUser(null);
      try { SyncService.stopAutoSync(); } catch (e) {}
      console.log('User state cleared - logout complete');
    } catch (error) {
      console.error('Error signing out:', error);
      throw error;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        signOut,
        isAuthenticated: user !== null,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
