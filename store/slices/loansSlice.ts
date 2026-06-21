import { getDatabase } from '@/services/database';
import { Loan } from '@/types/database';
import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';

interface LoansState {
  items: Loan[];
  loading: boolean;
  error: string | null;
}

const initialState: LoansState = {
  items: [],
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
      state.items = [];
      state.loading = false;
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch
      .addCase(fetchLoans.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchLoans.fulfilled, (state, action: PayloadAction<Loan[]>) => {
        state.loading = false;
        state.items = action.payload;
      })
      .addCase(fetchLoans.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch loans';
      })
      // Add
      .addCase(addLoan.fulfilled, (state, action: PayloadAction<Loan>) => {
        state.items.push(action.payload);
      })
      // Update
      .addCase(updateLoan.fulfilled, (state, action: PayloadAction<Loan>) => {
        const index = state.items.findIndex(item => item.id === action.payload.id);
        if (index !== -1) {
          state.items[index] = action.payload;
        }
      })
      // Delete
      .addCase(deleteLoan.fulfilled, (state, action: PayloadAction<string>) => {
        state.items = state.items.filter(item => item.id !== action.payload);
      });
  },
});

export const { resetLoans } = loansSlice.actions;
export default loansSlice.reducer;
