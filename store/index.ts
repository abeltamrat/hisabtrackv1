import { configureStore } from '@reduxjs/toolkit';
import accountsReducer from './slices/accountsSlice';
import budgetsReducer from './slices/budgetsSlice';
import loansReducer from './slices/loansSlice';
import transactionsReducer from './slices/transactionsSlice';

export const store = configureStore({
  reducer: {
    accounts: accountsReducer,
    transactions: transactionsReducer,
    budgets: budgetsReducer,
    loans: loansReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
