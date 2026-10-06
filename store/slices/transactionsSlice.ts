import { getDatabase } from '@/services/database';
import { Transaction } from '@/types/database';
import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';

interface TransactionsState {
  items: Transaction[];
  loading: boolean;
  requestId?: string;
  mutations: Record<string, boolean>;
  error: string | null;
}

const initialState: TransactionsState = {
  items: [],
  mutations: {},
  loading: false,
  error: null,
};

export const fetchTransactions = createAsyncThunk(
  'transactions/fetchTransactions',
  async (filters?: { account_id?: string; startDate?: number; endDate?: number }) => {
    const db = await getDatabase();
    return await db.getTransactions(filters);
  }
);

export const addTransaction = createAsyncThunk(
  'transactions/addTransaction',
  async (transaction: Omit<Transaction, 'id'>) => {
    const db = await getDatabase();
    const created = await db.createTransaction(transaction);
    // Recurring catch-up entries are generated automatically and must not teach
    // the reminder system an artificial "preferred" recording time.
    if (!transaction.description?.includes('(Recurring - catch-up)')) {
      void import('@/services/SmartReminderService').then(({ SmartReminderService }) =>
        SmartReminderService.recordTransactionHabit()
      ).catch(() => undefined);
    }
    return created;
  }
);

export const updateTransaction = createAsyncThunk(
  'transactions/updateTransaction',
  async ({ id, ...updates }: Partial<Transaction> & { id: string }) => {
    const db = await getDatabase();
    return await db.updateTransaction(id, updates);
  }
);

export const deleteTransaction = createAsyncThunk(
  'transactions/deleteTransaction',
  async (id: string) => {
    const db = await getDatabase();
    await db.deleteTransaction(id);
    return id;
  }
);

const transactionsSlice = createSlice({
  name: 'transactions',
  initialState,
  reducers: {
    resetTransactions: (state) => {
      state.requestId = undefined;
      state.mutations = {};
      state.items = [];
      state.loading = false;
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch
      .addCase(fetchTransactions.pending, (state, action) => {
        state.requestId = action.meta.requestId;
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchTransactions.fulfilled, (state, action) => {
        if (state.requestId !== action.meta.requestId) return;
        state.loading = false;
        state.items = action.payload;
      })
      .addCase(fetchTransactions.rejected, (state, action) => {
        if (state.requestId !== action.meta.requestId) return;
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch transactions';
      })
      // Add
      .addCase(addTransaction.pending, (state, action) => { state.mutations[action.meta.requestId] = true; })
      .addCase(addTransaction.rejected, (state, action) => {
        if (!state.mutations[action.meta.requestId]) return;
        delete state.mutations[action.meta.requestId]; state.error = action.error.message || 'Save failed';
      })
      .addCase(addTransaction.fulfilled, (state, action) => {
        if (!state.mutations[action.meta.requestId]) return;
        delete state.mutations[action.meta.requestId];
        if (!state.items.some(item => item.id === action.payload.id)) state.items.unshift(action.payload); // Add to top
      })
      // Update
      .addCase(updateTransaction.pending, (state, action) => { state.mutations[action.meta.requestId] = true; })
      .addCase(updateTransaction.rejected, (state, action) => {
        if (!state.mutations[action.meta.requestId]) return;
        delete state.mutations[action.meta.requestId]; state.error = action.error.message || 'Save failed';
      })
      .addCase(updateTransaction.fulfilled, (state, action) => {
        if (!state.mutations[action.meta.requestId]) return;
        delete state.mutations[action.meta.requestId];
        const index = state.items.findIndex(t => t.id === action.payload.id);
        if (index !== -1) {
          state.items[index] = action.payload;
        }
      })
      // Delete
      .addCase(deleteTransaction.pending, (state, action) => { state.mutations[action.meta.requestId] = true; })
      .addCase(deleteTransaction.rejected, (state, action) => {
        if (!state.mutations[action.meta.requestId]) return;
        delete state.mutations[action.meta.requestId]; state.error = action.error.message || 'Save failed';
      })
      .addCase(deleteTransaction.fulfilled, (state, action) => {
        if (!state.mutations[action.meta.requestId]) return;
        delete state.mutations[action.meta.requestId];
        state.items = state.items.filter(t => t.id !== action.payload);
      });
  },
});

export const { resetTransactions } = transactionsSlice.actions;
export default transactionsSlice.reducer;
