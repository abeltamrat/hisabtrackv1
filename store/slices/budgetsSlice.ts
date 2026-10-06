import { getDatabase } from '@/services/database';
import { Budget } from '@/types/database';
import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';

interface BudgetsState {
  items: Budget[];
  loading: boolean;
  requestId?: string;
  mutations: Record<string, boolean>;
  error: string | null;
}

const initialState: BudgetsState = {
  items: [],
  mutations: {},
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
      .addCase(fetchBudgets.pending, (state, action) => {
        state.requestId = action.meta.requestId;
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchBudgets.fulfilled, (state, action) => {
        if (state.requestId !== action.meta.requestId) return;
        state.loading = false;
        state.items = action.payload;
      })
      .addCase(fetchBudgets.rejected, (state, action) => {
        if (state.requestId !== action.meta.requestId) return;
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch budgets';
      })
      // Add
      .addCase(addBudget.pending, (state, action) => { state.mutations[action.meta.requestId] = true; })
      .addCase(addBudget.rejected, (state, action) => {
        if (!state.mutations[action.meta.requestId]) return;
        delete state.mutations[action.meta.requestId]; state.error = action.error.message || 'Save failed';
      })
      .addCase(addBudget.fulfilled, (state, action) => {
        if (!state.mutations[action.meta.requestId]) return;
        delete state.mutations[action.meta.requestId];
        if (!state.items.some(item => item.id === action.payload.id)) state.items.push(action.payload);
      })
      // Update
      .addCase(updateBudget.pending, (state, action) => { state.mutations[action.meta.requestId] = true; })
      .addCase(updateBudget.rejected, (state, action) => {
        if (!state.mutations[action.meta.requestId]) return;
        delete state.mutations[action.meta.requestId]; state.error = action.error.message || 'Save failed';
      })
      .addCase(updateBudget.fulfilled, (state, action) => {
        if (!state.mutations[action.meta.requestId]) return;
        delete state.mutations[action.meta.requestId];
        const index = state.items.findIndex((b) => b.id === action.payload.id);
        if (index !== -1) {
          state.items[index] = action.payload;
        }
      })
      // Delete
      .addCase(deleteBudget.pending, (state, action) => { state.mutations[action.meta.requestId] = true; })
      .addCase(deleteBudget.rejected, (state, action) => {
        if (!state.mutations[action.meta.requestId]) return;
        delete state.mutations[action.meta.requestId]; state.error = action.error.message || 'Save failed';
      })
      .addCase(deleteBudget.fulfilled, (state, action) => {
        if (!state.mutations[action.meta.requestId]) return;
        delete state.mutations[action.meta.requestId];
        state.items = state.items.filter((b) => b.id !== action.payload);
      });
  },
});

export const { resetBudgets } = budgetsSlice.actions;
export default budgetsSlice.reducer;
