import { getDatabase } from '@/services/database';
import { Budget } from '@/types/database';
import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';

interface BudgetsState {
  items: Budget[];
  loading: boolean;
  error: string | null;
}

const initialState: BudgetsState = {
  items: [],
  loading: false,
  error: null,
};

export const fetchBudgets = createAsyncThunk('budgets/fetchBudgets', async () => {
  const db = await getDatabase();
  return await db.getBudgets();
});

export const addBudget = createAsyncThunk('budgets/addBudget', async (budget: Omit<Budget, 'id'>) => {
  const db = await getDatabase();
  return await db.createBudget(budget);
});

export const updateBudget = createAsyncThunk('budgets/updateBudget', async (budget: Budget) => {
  const db = await getDatabase();
  await db.updateBudget(budget);
  return budget;
});

export const deleteBudget = createAsyncThunk('budgets/deleteBudget', async (id: string) => {
  const db = await getDatabase();
  await db.deleteBudget(id);

  return id;
});

const budgetsSlice = createSlice({
  name: 'budgets',
  initialState,
  reducers: {
    resetBudgets: (state) => {
      state.items = [];
      state.loading = false;
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch
      .addCase(fetchBudgets.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchBudgets.fulfilled, (state, action: PayloadAction<Budget[]>) => {
        state.loading = false;
        state.items = action.payload;
      })
      .addCase(fetchBudgets.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch budgets';
      })
      // Add
      .addCase(addBudget.fulfilled, (state, action: PayloadAction<Budget>) => {
        state.items.push(action.payload);
      })
      // Update
      .addCase(updateBudget.fulfilled, (state, action: PayloadAction<Budget>) => {
        const index = state.items.findIndex((b) => b.id === action.payload.id);
        if (index !== -1) {
          state.items[index] = action.payload;
        }
      })
      // Delete
      .addCase(deleteBudget.fulfilled, (state, action: PayloadAction<string>) => {
        state.items = state.items.filter((b) => b.id !== action.payload);
      });
  },
});

export const { resetBudgets } = budgetsSlice.actions;
export default budgetsSlice.reducer;
