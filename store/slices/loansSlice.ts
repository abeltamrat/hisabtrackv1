import { getDatabase } from '@/services/database';
import { Loan } from '@/types/database';
import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';

interface LoansState {
  items: Loan[];
  loading: boolean;
  requestId?: string;
  mutations: Record<string, boolean>;
  error: string | null;
}

const initialState: LoansState = {
  items: [],
  mutations: {},
  loading: false,
  error: null,
};

export const fetchLoans = createAsyncThunk('loans/fetchLoans', async () => {
  const db = await getDatabase();
  return await db.getLoans();
});

export const addLoan = createAsyncThunk('loans/addLoan', async (loan: Omit<Loan, 'id'>) => {
  const db = await getDatabase();
  return await db.createLoan(loan);
});

export const updateLoan = createAsyncThunk('loans/updateLoan', async (loan: Loan) => {
  const db = await getDatabase();
  await db.updateLoan(loan);
  return loan;
});

export const deleteLoan = createAsyncThunk('loans/deleteLoan', async (id: string) => {
  const db = await getDatabase();
  await db.deleteLoan(id);

  return id;
});

const loansSlice = createSlice({
  name: 'loans',
  initialState,
  reducers: {
    resetLoans: (state) => {
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
      .addCase(fetchLoans.pending, (state, action) => {
        state.requestId = action.meta.requestId;
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchLoans.fulfilled, (state, action) => {
        if (state.requestId !== action.meta.requestId) return;
        state.loading = false;
        state.items = action.payload;
      })
      .addCase(fetchLoans.rejected, (state, action) => {
        if (state.requestId !== action.meta.requestId) return;
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch loans';
      })
      // Add
      .addCase(addLoan.pending, (state, action) => { state.mutations[action.meta.requestId] = true; })
      .addCase(addLoan.rejected, (state, action) => {
        if (!state.mutations[action.meta.requestId]) return;
        delete state.mutations[action.meta.requestId]; state.error = action.error.message || 'Save failed';
      })
      .addCase(addLoan.fulfilled, (state, action) => {
        if (!state.mutations[action.meta.requestId]) return;
        delete state.mutations[action.meta.requestId];
        if (!state.items.some(item => item.id === action.payload.id)) state.items.push(action.payload);
      })
      // Update
      .addCase(updateLoan.pending, (state, action) => { state.mutations[action.meta.requestId] = true; })
      .addCase(updateLoan.rejected, (state, action) => {
        if (!state.mutations[action.meta.requestId]) return;
        delete state.mutations[action.meta.requestId]; state.error = action.error.message || 'Save failed';
      })
      .addCase(updateLoan.fulfilled, (state, action) => {
        if (!state.mutations[action.meta.requestId]) return;
        delete state.mutations[action.meta.requestId];
        const index = state.items.findIndex(item => item.id === action.payload.id);
        if (index !== -1) {
          state.items[index] = action.payload;
        }
      })
      // Delete
      .addCase(deleteLoan.pending, (state, action) => { state.mutations[action.meta.requestId] = true; })
      .addCase(deleteLoan.rejected, (state, action) => {
        if (!state.mutations[action.meta.requestId]) return;
        delete state.mutations[action.meta.requestId]; state.error = action.error.message || 'Save failed';
      })
      .addCase(deleteLoan.fulfilled, (state, action) => {
        if (!state.mutations[action.meta.requestId]) return;
        delete state.mutations[action.meta.requestId];
        state.items = state.items.filter(item => item.id !== action.payload);
      });
  },
});

export const { resetLoans } = loansSlice.actions;
export default loansSlice.reducer;
