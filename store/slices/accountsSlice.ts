import { getDatabase } from '@/services/database';
import { Account } from '@/types/database';
import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import { addTransaction } from './transactionsSlice';

interface AccountsState {
  items: Account[];
  loading: boolean;
  requestId?: string;
  mutations: Record<string, boolean>;
  error: string | null;
  status: 'idle' | 'loading' | 'succeeded' | 'failed';
}

const initialState: AccountsState = {
  items: [],
  mutations: {},
  loading: false,
  error: null,
  status: 'idle',
};

export const fetchAccounts = createAsyncThunk('accounts/fetchAccounts', async () => {
  const db = await getDatabase();
  return await db.getAccounts();
});

// ... (other thunks)
export const addAccount = createAsyncThunk('accounts/addAccount', async (input: Omit<Account, 'id' | 'created_at'>) => {
  return (await getDatabase()).createAccount(input);
});
export const updateAccount = createAsyncThunk('accounts/updateAccount', async (account: Account) => {
  await (await getDatabase()).updateAccount(account); return account;
});
export const deleteAccount = createAsyncThunk('accounts/deleteAccount', async (id: string) => {
  await (await getDatabase()).deleteAccount(id); return id;
});

const accountsSlice = createSlice({
  name: 'accounts',
  initialState,
  reducers: {
    resetAccounts: (state) => {
      state.requestId = undefined;
      state.mutations = {};
      state.items = [];
      state.loading = false;
      state.error = null;
      state.status = 'idle';
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch
      .addCase(fetchAccounts.pending, (state, action) => {
        state.requestId = action.meta.requestId;
        state.loading = true;
        state.error = null;
        state.status = 'loading';
      })
      .addCase(fetchAccounts.fulfilled, (state, action) => {
        if (state.requestId !== action.meta.requestId) return;
        state.loading = false;
        state.items = action.payload;
        state.status = 'succeeded';
      })
      .addCase(fetchAccounts.rejected, (state, action) => {
        if (state.requestId !== action.meta.requestId) return;
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch accounts';
        state.status = 'failed';
      })
      // Add
      .addCase(addAccount.pending, (state, action) => { state.mutations[action.meta.requestId] = true; })
      .addCase(addAccount.rejected, (state, action) => {
        if (!state.mutations[action.meta.requestId]) return;
        delete state.mutations[action.meta.requestId]; state.error = action.error.message || 'Save failed';
      })
      .addCase(addAccount.fulfilled, (state, action) => {
        if (!state.mutations[action.meta.requestId]) return;
        delete state.mutations[action.meta.requestId];
        if (!state.items.some(item => item.id === action.payload.id)) state.items.push(action.payload);
      })
      // Update
      .addCase(updateAccount.pending, (state, action) => { state.mutations[action.meta.requestId] = true; })
      .addCase(updateAccount.rejected, (state, action) => {
        if (!state.mutations[action.meta.requestId]) return;
        delete state.mutations[action.meta.requestId]; state.error = action.error.message || 'Save failed';
      })
      .addCase(updateAccount.fulfilled, (state, action) => {
        if (!state.mutations[action.meta.requestId]) return;
        delete state.mutations[action.meta.requestId];
        const index = state.items.findIndex((acc) => acc.id === action.payload.id);
        if (index !== -1) {
          state.items[index] = action.payload;
        }
      })
      // Delete
      .addCase(deleteAccount.pending, (state, action) => { state.mutations[action.meta.requestId] = true; })
      .addCase(deleteAccount.rejected, (state, action) => {
        if (!state.mutations[action.meta.requestId]) return;
        delete state.mutations[action.meta.requestId]; state.error = action.error.message || 'Save failed';
      })
      .addCase(deleteAccount.fulfilled, (state, action) => {
        if (!state.mutations[action.meta.requestId]) return;
        delete state.mutations[action.meta.requestId];
        state.items = state.items.filter((acc) => acc.id !== action.payload);
      })
    // Handle Transaction Addition (Optimistic Update)
    // Handle Transaction Addition (Optimistic Update) - REMOVED to avoid race condition with SyncService
    // .addCase(addTransaction.fulfilled, (state, action: any) => {
    //   const transaction = action.payload;
    //   const account = state.items.find(acc => acc.id === transaction.account_id);
    //   if (account) {
    //      if (transaction.type === 'INCOME') {
    //        account.balance += transaction.amount;
    //      } else if (transaction.type === 'EXPENSE' || transaction.type === 'TRANSFER') {
    //        account.balance -= transaction.amount;
    //      }
    //   }
    // });
  },
});

export const { resetAccounts } = accountsSlice.actions;
export default accountsSlice.reducer;
