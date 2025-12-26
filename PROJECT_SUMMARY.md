# HisabTrack - Personal Finance Smart Web App

## 🎉 Project Overview

HisabTrack is a comprehensive personal finance management application built with React Native, Expo, and modern web technologies. It provides a seamless experience across both web and Android platforms with a beautiful, responsive UI and powerful financial tracking features.

## ✅ Completed Features

### 1. **Dashboard** 
- **Summary Cards**: Display total balance, income, and expense with beautiful gradient cards
- **Recent Transactions**: Shows the latest 5 transactions with category icons and colors
- **Quick Actions**: 8 quick access buttons for common tasks:
  - Add New Transaction
  - Transfer Money
  - Budget Management
  - Reports & Charts
  - Loans & Debts
  - Calculator
  - Settings
  - (Empty slot for future feature)

### 2. **Transaction Management**
- **Transaction List**: Filterable by type (All, Income, Expense) and category
- **Add/Edit Transaction Form**: Modal-based form with:
  - Amount input
  - Type selection (Income/Expense)
  - Category selection with icons
  - Date picker
  - Notes field
- **Redux Integration**: All transactions managed through Redux store
- **Category Support**: 12 predefined categories with custom icons and colors

### 3. **Budget Management**
- **Budget Creation**: Modal form to set monthly budgets by category
- **Progress Tracking**: Visual progress bars showing spent vs. limit
- **Budget Overview**: 
  - Total budget summary
  - Spent amount tracking
  - Remaining balance
  - Progress percentage
- **Alerts**: Warning when approaching or exceeding budget limits
- **Redux Integration**: Budget data managed through Redux

### 4. **Loans & Debts**
- **Loan Tracking**: Separate tabs for "Loans Given" (LENT) and "Debts Owed" (BORROWED)
- **Payment Progress**: Visual progress bars and payment history
- **Quick Payments**: Buttons for +$100, +$500, or mark as paid
- **Amortization Calculator**: Dedicated calculator for loan planning
  - Principal amount
  - Interest rate
  - Loan term
  - Monthly payment calculation
  - Total interest calculation
- **Full CRUD Operations**: Add, edit, delete, and update loans
- **Redux Integration**: Complete loan management through Redux

### 5. **Reports & Charts**
- **Income vs Expense Chart**: Line chart showing monthly trends
- **Category Breakdown**: Pie chart with expense distribution
- **Time Range Selector**: View data by week, month, or year
- **Summary Cards**: Quick view of total income and expense
- **Top Categories**: List of top 6 spending categories with percentages

### 6. **Calculator**
- **Basic Calculator**: Standard calculator with history
- **Operation Support**: +, -, ×, ÷, %
- **History Tracking**: Shows last 10 calculations
- **Beautiful UI**: Gradient buttons and smooth animations

### 7. **Settings & Theme**
- **Theme Toggle**: Choose between Light, Dark, or System theme
- **Persistent Settings**: Theme preference saved to AsyncStorage
- **App Information**: Version, build number, and developer info
- **Quick Actions**: Export data, backup, and clear data options

## 🏗️ Technical Architecture

### Frontend Stack
- **React Native**: Cross-platform mobile framework
- **Expo**: Development platform and tooling
- **Expo Router**: File-based routing system
- **NativeWind**: Tailwind CSS for React Native
- **TypeScript**: Type-safe development

### State Management
- **Redux Toolkit**: Centralized state management
- **Redux Thunks**: Async actions for database operations
- **React Context**: Theme management

### Database Layer
- **Platform-Specific Abstraction**:
  - **Web**: IndexedDB via `idb` library
  - **Android**: SQLite via `expo-sqlite`
- **Unified Interface**: Single `IDatabase` interface for both platforms
- **Type-Safe**: Full TypeScript support

### Data Models
```typescript
- Account: { id, name, type, balance, currency, is_locked, locked_amount, created_at }
- Transaction: { id, account_id, type, amount, category, date, description, ... }
- Budget: { id, category, limit_amount, period, start_date, end_date }
- Loan: { id, type, principal_amount, interest_rate, start_date, due_date, lender_borrower_name, status, remaining_balance }
```

### UI Components
- **Reusable Components**:
  - `SummaryCard`: Balance display with income/expense breakdown
  - `RecentTransactions`: Transaction list with category icons
  - Custom modals for forms
  - Themed buttons and inputs

### Charts & Visualization
- **react-native-chart-kit**: Line and pie charts
- **react-native-svg**: SVG support for charts
- **Custom Styling**: Themed chart configurations

## 📱 Screens & Navigation

### Tab Navigation
1. **Dashboard** (`/`)
2. **Transactions** (`/transactions`)
3. **Explore** (placeholder)

### Modal Screens
- Add Transaction (`/modal`)
- Add Budget (`/budget-modal`)

### Stack Screens
- Budget Management (`/budget`)
- Loans & Debts (`/loans`)
- Amortization Calculator (`/amortization`)
- Reports & Charts (`/reports`)
- Calculator (`/calculator`)
- Settings (`/settings`)

## 🎨 Design System

### Color Palette
- **Primary**: Blue gradient (#3b82f6 to #2563eb)
- **Secondary**: Green gradient (#10b981 to #059669)
- **Accent Colors**:
  - Purple (Budgets)
  - Red (Loans/Debts)
  - Indigo (Reports)
  - Teal (Calculator)

### Typography
- **Font Family**: System default with SpaceMono for monospace
- **Font Sizes**: Responsive scaling from xs to 5xl
- **Font Weights**: Regular, semibold, bold

### Dark Mode
- **Automatic Detection**: System preference detection
- **Manual Override**: User can choose light, dark, or system
- **Consistent Theming**: All components support dark mode

## 🔄 Redux Store Structure

```typescript
store/
├── index.ts (Store configuration)
└── slices/
    ├── accountsSlice.ts
    ├── transactionsSlice.ts
    ├── budgetsSlice.ts
    └── loansSlice.ts
```

### Async Thunks
- `fetchAccounts`, `addAccount`, `updateAccount`, `deleteAccount`
- `fetchTransactions`, `addTransaction`
- `fetchBudgets`, `addBudget`
- `fetchLoans`, `addLoan`, `updateLoan`, `deleteLoan`

## 📊 Mock Data

### Categories (12 total)
- **Income**: Salary, Freelance, Investments, Other Income
- **Expense**: Food & Dining, Transportation, Shopping, Bills & Utilities, Entertainment, Healthcare, Education, Other

Each category includes:
- Unique ID
- Name
- Type (INCOME/EXPENSE)
- Icon (FontAwesome)
- Color (hex code)

## 🚀 Getting Started

### Prerequisites
```bash
Node.js >= 18
npm or yarn
Expo CLI
```

### Installation
```bash
# Install dependencies
npm install

# Start development server
npm start

# Run on web
npm run web

# Run on Android
npm run android
```

### Key Dependencies
```json
{
  "@react-native-async-storage/async-storage": "^1.23.1",
  "@reduxjs/toolkit": "^2.2.1",
  "expo": "~52.0.11",
  "expo-router": "~4.0.9",
  "expo-sqlite": "~15.0.3",
  "idb": "^8.0.1",
  "nativewind": "^4.1.23",
  "react-native-chart-kit": "^6.12.0",
  "react-native-svg": "^15.8.0"
}
```

## 📝 Next Steps (Remaining Tasks)

### Authentication & Security
- [ ] Setup Firebase project
- [ ] Implement Phone Auth
- [ ] Create Login/OTP Screens
- [ ] Implement Secure Storage

### SMS Automation (Android Only)
- [ ] SMS Reader permissions
- [ ] SMS Parsing Logic
- [ ] Background Task for monitoring
- [ ] Transaction prompt UI

### Backend & Sync
- [ ] Setup Node.js/Supabase Backend
- [ ] Implement Backup API
- [ ] Push Notifications (FCM)

### Final Polish
- [ ] Export to Excel/PDF/CSV
- [ ] End-to-End Testing
- [ ] Performance optimization
- [ ] Accessibility improvements

## 🎯 Key Achievements

1. ✅ **Cross-Platform Database**: Unified interface for SQLite (Android) and IndexedDB (Web)
2. ✅ **Redux Integration**: Complete state management for all features
3. ✅ **Beautiful UI**: Modern, responsive design with dark mode support
4. ✅ **Type Safety**: Full TypeScript implementation
5. ✅ **Modular Architecture**: Reusable components and clean code structure
6. ✅ **Chart Visualization**: Interactive charts for financial insights
7. ✅ **Theme System**: Persistent theme preferences with system detection

## 📄 License

This project is part of a personal finance management system.

## 👨‍💻 Developer

Built with ❤️ using React Native, Expo, and modern web technologies.
