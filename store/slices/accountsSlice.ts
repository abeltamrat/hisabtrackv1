import { getDatabase } from '@/services/database';
import SyncService from '@/services/SyncService';
import { Account } from '@/types/database';
import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import { deleteDoc, doc } from 'firebase/firestore';
import { addTransaction } from './transactionsSlice';

interface AccountsState {
  items: Account[];
  loading: boolean;
  error: string | null;
  status: 'idle' | 'loading' | 'succeeded' | 'failed';
}

const initialState: AccountsState = {
  items: [],
  loading: false,
  error: null,
  status: 'idle',
};

export const fetchAccounts = createAsyncThunk('accounts/fetchAccounts', async () => {
  const db = await getDatabase();
  return await db.getAccounts();
});

// ... (other thunks)
export const addAccount = createAsyncThunk('accounts/addAccount', async (accountData: Omit<Account, 'id' | 'created_at'>, { dispatch }) => {
  const db = await getDatabase();
  
  const initialBalance = accountData.balance;
  
  // 1. Create account with 0 balance first so transaction sets it correctly
  const newAccount = await db.createAccount({ ...accountData, balance: 0 });
  
  // 2. Create Opening Balance transaction via Thunk (to update Transactions Slice)
  if (initialBalance !== 0) {
    const isIncome = initialBalance > 0;
    // @ts-ignore
    await dispatch(addTransaction({
      account_id: newAccount.id,
      type: isIncome ? 'INCOME' : 'EXPENSE',
      amount: Math.abs(initialBalance),
      category: 'Opening Balance',
      description: 'Initial Opening Balance',
      date: Date.now(),
    }));
    
    // Update the returned account object's balance to match the actual DB state (and intended state)
    newAccount.balance = initialBalance;
  }
  
  return newAccount;
});

export const updateAccount = createAsyncThunk('accounts/updateAccount', async (account: Account, { dispatch, getState }) => {
  const db = await getDatabase();
  const state = getState() as any;
  const oldAccount = state.accounts.items.find((a: Account) => a.id === account.id);
  
  if (oldAccount && oldAccount.balance !== account.balance) {
      const diff = account.balance - oldAccount.balance;
      const isIncome = diff > 0;
      
      // 1. Update account details but revert balance to OLD balance first to avoid double counting 
      // when transaction is added (since transaction addition also updates balance).
      await db.updateAccount({ ...account, balance: oldAccount.balance });
      
      // 2. Create Adjustment Transaction
      // @ts-ignore
      await dispatch(addTransaction({
        account_id: account.id,
        type: isIncome ? 'INCOME' : 'EXPENSE',
        amount: Math.abs(diff),
        category: 'Balance Adjustment',
        description: 'Manual Balance Adjustment',
        date: Date.now(),
      }));
      
      // After transaction, DB balance should be correct (oldBalance + diff = newBalance).
      // The returned account object already has the newBalance, so Redux will update correctly.
  } else {
     await db.updateAccount(account);
  }
  
  return account;
});

export const deleteAccount = createAsyncThunk('accounts/deleteAccount', async (id: string, { dispatch, getState }) => {
  const db = await getDatabase();
  const state = getState() as any;
  const account = state.accounts.items.find((a: Account) => a.id === id);

  if (account && account.balance > 0) {
     // Record expense for remaining balance
     // @ts-ignore
     await dispatch(addTransaction({
        account_id: id,
        type: 'EXPENSE',
        amount: account.balance,
        category: 'Account Deletion',
        description: 'Balance write-off due to deletion',
        date: Date.now(),
     }));
  }

  await db.deleteAccount(id);
  // If signed in, attempt to delete remote doc immediately so other clients update quickly
  try {
    const uid = (SyncService as any).currentUid;
    if (uid) {
      const firestore = SyncService.getFirestore();
      const ref = doc(firestore, `users/${uid}/accounts`, id);
      await deleteDoc(ref);
    }
  } catch (e) {
    console.warn('deleteAccount: failed to delete remote account immediately', e);
  }

  return id;
});

const accountsSlice = createSlice({
  name: 'accounts',
  initialState,
  reducers: {
    resetAccounts: (state) => {
      state.items = [];
      state.loading = false;
      state.error = null;
      state.status = 'idle';
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch
      .addCase(fetchAccounts.pending, (state) => {
        state.loading = true;
        state.error = null;
        state.status = 'loading';
      })
      .addCase(fetchAccounts.fulfilled, (state, action: PayloadAction<Account[]>) => {
        state.loading = false;
        state.items = action.payload;
        state.status = 'succeeded';
      })
      .addCase(fetchAccounts.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch accounts';
        state.status = 'failed';
      })
      // Add
      .addCase(addAccount.fulfilled, (state, action: PayloadAction<Account>) => {
        state.items.push(action.payload);
      })
      // Update
      .addCase(updateAccount.fulfilled, (state, action: PayloadAction<Account>) => {
        const index = state.items.findIndex((acc) => acc.id === action.payload.id);
        if (index !== -1) {
          state.items[index] = action.payload;
        }
      })
      // Delete
      .addCase(deleteAccount.fulfilled, (state, action: PayloadAction<string>) => {
        state.items = state.items.filter((acc) => acc.id !== action.payload);
      })
      // Handle Transaction Addition (Optimistic Update)
      .addCase(addTransaction.fulfilled, (state, action: any) => {
        const transaction = action.payload;
        const account = state.items.find(acc => acc.id === transaction.account_id);
        if (account) {
           if (transaction.type === 'INCOME') {
             account.balance += transaction.amount;
           } else if (transaction.type === 'EXPENSE' || transaction.type === 'TRANSFER') {
             account.balance -= transaction.amount;
           }
        }
      });
  },
});

export const { resetAccounts } = accountsSlice.actions;
export default accountsSlice.reducer;
