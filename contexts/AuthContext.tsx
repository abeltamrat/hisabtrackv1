import { AuthService } from '@/services/AuthService';
import RemotePushService from '@/services/RemotePushService';
import { SecureStorageService } from '@/services/SecureStorageService';
import SyncService from '@/services/SyncService';
import { AppDispatch } from '@/store';
import { resetAccounts } from '@/store/slices/accountsSlice';
import { resetBudgets } from '@/store/slices/budgetsSlice';
import { resetLoans } from '@/store/slices/loansSlice';
import { resetTransactions } from '@/store/slices/transactionsSlice';
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

  useEffect(() => {
    void SyncService.refreshLocalStore();

    const unsubscribe = AuthService.onAuthStateChanged((firebaseUser) => {
      if (firebaseUser) {
        setUser({
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName,
        });

        (async () => {
          try {
            await SyncService.pullAllForUser(firebaseUser.uid, true);
            await SyncService.pushAllForUser(firebaseUser.uid, true);
            await SyncService.refreshLocalStore();
          } catch (err) {
            console.error('Error syncing data on sign-in', err);
            try {
              await SyncService.refreshLocalStore();
            } catch (refreshError) {
              console.error('Error refreshing local data after sign-in failure', refreshError);
            }
          }

          try {
            SyncService.startAutoSync(firebaseUser.uid);
          } catch (e) {
            console.error('Failed to start auto-sync', e);
          }

          try {
            await RemotePushService.syncCurrentDevice(firebaseUser.uid);
          } catch (e) {
            console.error('Failed to register remote push device', e);
          }

          // Request key permissions after sign-in (non-blocking, delayed so UI settles first)
          setTimeout(async () => {
            try {
              const { requestKeyPermissionsIfNeeded } = await import('@/services/PermissionsService');
              await requestKeyPermissionsIfNeeded();
            } catch (e) {
              console.warn('Failed to request key permissions', e);
            }
          }, 1500);
        })();
      } else {
        setUser(null);
        try { SyncService.stopAutoSync(); } catch (e) {}
        void SyncService.refreshLocalStore();
      }
      setLoading(false);
    });

    return () => {
      unsubscribe();
      try { SyncService.stopAutoSync(); } catch (e) {}
    };
  }, []);

  const signOut = async () => {
    try {
      console.log('Starting logout process...');

      if (user?.uid) {
        try {
          await RemotePushService.unregisterCurrentDevice(user.uid);
        } catch (e) {
          console.error('Failed to unregister remote push device', e);
        }
      }

      await AuthService.signOut();
      console.log('Firebase signOut successful');
      await SecureStorageService.clearAll();
      await StorageService.clearAll();

      // Clear only Redux in-memory state — local SQLite data stays on device
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
