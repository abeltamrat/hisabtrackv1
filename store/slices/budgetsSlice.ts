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
  const stored = await db.getBudgets();

  // One row per period is stored, so without this a budget stops existing the
  // moment its period ends and the screen looks as though it was deleted.
  // planRollForward is idempotent, so this is safe on every fetch.
  const { BudgetService } = await import('@/services/BudgetService');
  const missing = BudgetService.planRollForward(stored);
  if (missing.length === 0) return stored;

  const created = await Promise.all(
    missing.map(async budget => {
      try {
        await db.upsertBudget(budget);
        return budget;
      } catch (error) {
      // A failure here must not block showing the budgets that do exist.
      console.warn('[budgets] Could not carry a budget into the new period:', error);
      return null;
      }
    })
  );
  return [...stored, ...created.filter((budget): budget is Budget => budget !== null)];
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
  const budgets = await db.getBudgets();
  const selected = budgets.find(budget => budget.id === id);
  const ids = selected
    ? budgets.filter(budget => budget.category === selected.category && budget.period === selected.period).map(budget => budget.id)
    : [id];
  await Promise.all(ids.map(budgetId => db.deleteBudget(budgetId)));
  return ids;
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
        const deleted = new Set(action.payload);
        state.items = state.items.filter((b) => !deleted.has(b.id));
      });
  },
});

export const { resetBudgets } = budgetsSlice.actions;
export default budgetsSlice.reducer;
