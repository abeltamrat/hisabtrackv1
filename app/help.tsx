import { useTheme } from '@/contexts/ThemeContext';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';


interface HelpSection {
  id: string;
  title: string;
  icon: string;
  color: string;
  description: string;
  features: string[];
  howToUse: string[];
}

const helpSections: HelpSection[] = [
  {
    id: 'dashboard',
    title: 'Dashboard',
    icon: 'dashboard',
    color: '#6366f1',
    description: 'Your financial overview at a glance. The Dashboard is your home screen showing your current balance, income, expenses, and recent transactions.',
    features: [
      'Total Balance display with percentage change',
      'Income and Expense summary cards',
      'Recent transactions list (last 5)',
      'Quick action buttons for common tasks',
      'Pull-to-refresh for latest data sync',
    ],
    howToUse: [
      'View your total balance at the top of the screen',
      'Check income vs expenses in the summary cards',
      'Tap any recent transaction to view details',
      'Use quick action buttons to add transactions, view budgets, etc.',
      'Pull down to refresh and sync your data',
    ],
  },
  {
    id: 'transactions',
    title: 'Transactions',
    icon: 'list',
    color: '#8b5cf6',
    description: 'Manage all your financial transactions in one place. Track income, expenses, and transfers with detailed categorization.',
    features: [
      'View all transactions with filters',
      'Add new income or expense transactions',
      'Edit or delete existing transactions',
      'Filter by type, category, or date range',
      'Search transactions by description',
      'Categorize transactions for better tracking',
    ],
    howToUse: [
      'Tap the "+" button to add a new transaction',
      'Select transaction type (Income/Expense)',
      'Enter amount, category, and description',
      'Choose the account for the transaction',
      'Add optional notes or reference numbers',
      'Swipe left on any transaction to delete',
    ],
  },
  {
    id: 'reports',
    title: 'Reports & Analytics',
    icon: 'bar-chart',
    color: '#ec4899',
    description: 'Visualize your financial data with beautiful charts and detailed analytics. Understand your spending patterns and trends.',
    features: [
      'Interactive pie charts for category breakdown',
      'Monthly spending trends with line charts',
      'Income vs Expense comparison',
      'Category-wise spending analysis',
      'Time period filters (Week/Month/Year)',
      'Export reports as PDF or CSV',
    ],
    howToUse: [
      'Select a time period from the filter buttons',
      'View pie chart to see category distribution',
      'Scroll down for detailed breakdowns',
      'Tap on chart segments for more details',
      'Use export button to save reports',
    ],
  },
  {
    id: 'budget',
    title: 'Budget Management',
    icon: 'pie-chart',
    color: '#a855f7',
    description: 'Set spending limits for different categories and track your progress. Stay on top of your financial goals.',
    features: [
      'Create budgets for specific categories',
      'Set monthly or weekly budget periods',
      'Visual progress bars showing spending',
      'Alerts when approaching budget limits',
      'Budget vs actual spending comparison',
      'Edit or delete budgets anytime',
    ],
    howToUse: [
      'Tap "Add Budget" to create a new budget',
      'Select a category (Food, Transport, etc.)',
      'Set your budget limit amount',
      'Choose period (Monthly/Weekly)',
      'Monitor progress with visual indicators',
      'Receive notifications when nearing limits',
    ],
  },
  {
    id: 'cards',
    title: 'Cards & Accounts',
    icon: 'credit-card',
    color: '#f59e0b',
    description: 'Manage all your financial accounts including bank accounts, credit cards, mobile money, and cash.',
    features: [
      'Add multiple accounts (Bank, Card, Cash, etc.)',
      'Track balance for each account',
      'Lock/unlock accounts to prevent accidental changes',
      'Set locked amounts for savings goals',
      'View transaction history per account',
      'Color-coded account types',
    ],
    howToUse: [
      'Tap "+" to add a new account',
      'Select account type (Bank/Card/Cash/Mobile Money)',
      'Enter account name and initial balance',
      'Optionally add account number',
      'Lock account to prevent modifications',
      'Set locked amount for savings',
    ],
  },
  {
    id: 'transfer',
    title: 'Transfer Money',
    icon: 'exchange',
    color: '#3b82f6',
    description: 'Move money between your accounts seamlessly. Track internal transfers without affecting your total balance.',
    features: [
      'Transfer between any two accounts',
      'Automatic balance updates',
      'Transfer history tracking',
      'Add notes to transfers',
      'Date and time stamping',
      'Instant account synchronization',
    ],
    howToUse: [
      'Select "From" account',
      'Select "To" account',
      'Enter transfer amount',
      'Add optional description',
      'Confirm transfer',
      'Both account balances update automatically',
    ],
  },
  {
    id: 'categories',
    title: 'Manage Categories',
    icon: 'tags',
    color: '#10b981',
    description: 'Organize your transactions with custom categories. Create, edit, and manage categories for better financial tracking.',
    features: [
      'Pre-defined common categories',
      'Create custom categories',
      'Assign colors and icons',
      'Edit category names and details',
      'Delete unused categories',
      'Separate income and expense categories',
    ],
    howToUse: [
      'View all existing categories',
      'Tap "Add Category" for new ones',
      'Choose category type (Income/Expense)',
      'Enter category name',
      'Select icon and color',
      'Save and use in transactions',
    ],
  },
  {
    id: 'loans',
    title: 'Loans & Debts',
    icon: 'money',
    color: '#ef4444',
    description: 'Track money you\'ve borrowed or lent. Manage loan details, payment schedules, and outstanding balances.',
    features: [
      'Record borrowed and lent money',
      'Track principal amount and interest',
      'Set due dates and payment schedules',
      'Mark partial or full payments',
      'View active, paid, and defaulted loans',
      'Calculate interest automatically',
      'Payment reminders and notifications',
    ],
    howToUse: [
      'Tap "Add Loan" to create new entry',
      'Select type (Borrowed/Lent)',
      'Enter lender/borrower name',
      'Set principal amount and interest rate',
      'Choose start and due dates',
      'Make payments using "+" button',
      'Mark as paid when complete',
    ],
  },
  {
    id: 'recurring',
    title: 'Recurring Payments',
    icon: 'refresh',
    color: '#14b8a6',
    description: 'Automate tracking of regular payments like subscriptions, rent, and bills. Never miss a recurring expense.',
    features: [
      'Set up recurring income or expenses',
      'Multiple frequencies (Daily/Weekly/Monthly/Yearly)',
      'Automatic transaction creation',
      'Payment reminders',
      'Pause or resume recurring payments',
      'View upcoming payment calendar',
      'Track subscription costs',
    ],
    howToUse: [
      'Tap "+" to add recurring payment',
      'Enter payment name and amount',
      'Select frequency (Monthly, Weekly, etc.)',
      'Set start date and optional end date',
      'Choose affected account',
      'Enable reminders if needed',
      'Execute manually or wait for auto-creation',
    ],
  },
  {
    id: 'goals',
    title: 'Financial Goals',
    icon: 'star',
    color: '#eab308',
    description: 'Set and track your savings goals. Whether it\'s a vacation, emergency fund, or new gadget - stay motivated!',
    features: [
      'Create multiple savings goals',
      'Set target amounts and deadlines',
      'Track progress with visual indicators',
      'Add contributions anytime',
      'Calculate required monthly savings',
      'Goal completion celebrations',
      'Priority-based goal management',
    ],
    howToUse: [
      'Tap "Add Goal" to create new goal',
      'Enter goal name and target amount',
      'Set target date (optional)',
      'Add initial contribution if any',
      'Track progress on main screen',
      'Add money using "+" button',
      'Mark as complete when achieved',
    ],
  },
  {
    id: 'calculator',
    title: 'Calculator',
    icon: 'calculator',
    color: '#f97316',
    description: 'Quick financial calculator for everyday math. Perfect for calculating totals, percentages, and conversions.',
    features: [
      'Basic arithmetic operations',
      'Percentage calculations',
      'Memory functions',
      'Clear and backspace',
      'Large, easy-to-tap buttons',
      'Instant results',
    ],
    howToUse: [
      'Tap numbers to enter values',
      'Use operation buttons (+, -, ×, ÷)',
      'Press "=" to get result',
      'Use "C" to clear',
      'Use "%" for percentage calculations',
      'Results can be copied',
    ],
  },
  {
    id: 'notifications',
    title: 'Notifications',
    icon: 'bell',
    color: '#8b5cf6',
    description: 'Stay informed with AI-powered financial insights, payment reminders, and budget alerts.',
    features: [
      'Smart spending alerts',
      'Budget limit warnings',
      'Loan payment reminders',
      'Recurring bill notifications',
      'Financial tips and advice',
      'Mark as read/unread',
      'Clear all notifications',
    ],
    howToUse: [
      'Tap notification to view details',
      'Tap action to navigate to relevant screen',
      'Swipe to delete individual notifications',
      'Use "Mark All Read" for bulk action',
      'Pull down to refresh',
      'Enable push notifications in settings',
    ],
  },
  {
    id: 'settings',
    title: 'Settings',
    icon: 'cog',
    color: '#64748b',
    description: 'Customize your HisabTrack experience. Manage preferences, security, and app behavior.',
    features: [
      'Profile management',
      'Currency selection',
      'Language preferences',
      'Theme (Light/Dark/Auto)',
      'Font size adjustment',
      'Security settings',
      'Data backup and restore',
      'Export data',
    ],
    howToUse: [
      'Access from dashboard or drawer menu',
      'Update profile information',
      'Change currency and language',
      'Toggle dark mode',
      'Adjust font size for readability',
      'Enable biometric security',
      'Backup data to cloud',
      'Export data as CSV/PDF',
    ],
  },
];

export default function HelpScreen() {
  const router = useRouter();
  const { actualTheme } = useTheme();
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const toggleSection = (id: string) => {
    setExpandedSection(expandedSection === id ? null : id);
  };

  return (
    <View className="flex-1 bg-slate-50 dark:bg-background-dark">
      <StatusBar style="auto" />

      {/* Header */}
      <LinearGradient
        colors={actualTheme === 'dark' ? ['#334155', '#1e293b'] : ['#10b981', '#059669']}
        className="px-6 pt-6 pb-8 rounded-b-[32px]"
        style={{ elevation: 4 }}
      >
        <View className="flex-row items-center justify-between mb-4">
          <TouchableOpacity
            onPress={() => router.back()}
            className="w-10 h-10 bg-white/20 rounded-xl justify-center items-center"
          >
            <FontAwesome name="arrow-left" size={18} color="#fff" />
          </TouchableOpacity>

          <Text className="text-white text-2xl font-bold flex-1 text-center">
            Help & Support
          </Text>

          <View className="w-10" />
        </View>

        <View className="bg-white/10 backdrop-blur-lg rounded-2xl p-4 mt-2">
          <Text className="text-white/90 text-sm text-center">
            📚 Complete guide to using HisabTrack
          </Text>
          <Text className="text-white/70 text-xs text-center mt-1">
            Tap any section below to learn more
          </Text>
        </View>
      </LinearGradient>

      {/* Help Sections */}
      <ScrollView className="flex-1 px-6 mt-4" showsVerticalScrollIndicator={false}>
        {helpSections.map((section) => (
          <View
            key={section.id}
            className="mb-3 bg-white dark:bg-slate-800 rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-700"
            style={{ elevation: 2 }}
          >
            {/* Section Header */}
            <TouchableOpacity
              onPress={() => toggleSection(section.id)}
              className="p-4 flex-row items-center"
            >
              <View
                className="w-12 h-12 rounded-xl justify-center items-center mr-3"
                style={{ backgroundColor: section.color + '20' }}
              >
                <FontAwesome name={section.icon as any} size={20} color={section.color} />
              </View>

              <View className="flex-1">
                <Text className="text-slate-900 dark:text-white font-bold text-lg">
                  {section.title}
                </Text>
                <Text className="text-slate-500 dark:text-slate-400 text-xs mt-0.5">
                  {expandedSection === section.id ? 'Tap to collapse' : 'Tap to expand'}
                </Text>
              </View>

              <FontAwesome
                name={expandedSection === section.id ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={actualTheme === 'dark' ? '#94a3b8' : '#64748b'}
              />
            </TouchableOpacity>

            {/* Expanded Content */}
            {expandedSection === section.id && (
              <View className="px-4 pb-4 border-t border-slate-100 dark:border-slate-700 pt-4">
                {/* Description */}
                <View className="mb-4">
                  <Text className="text-slate-600 dark:text-slate-300 text-sm leading-5">
                    {section.description}
                  </Text>
                </View>

                {/* Features */}
                <View className="mb-4">
                  <View className="flex-row items-center mb-2">
                    <FontAwesome name="star" size={14} color={section.color} />
                    <Text className="text-slate-900 dark:text-white font-bold text-sm ml-2">
                      Key Features
                    </Text>
                  </View>
                  {section.features.map((feature, index) => (
                    <View key={index} className="flex-row items-start mb-2 ml-1">
                      <Text className="text-slate-400 mr-2">•</Text>
                      <Text className="text-slate-600 dark:text-slate-300 text-sm flex-1">
                        {feature}
                      </Text>
                    </View>
                  ))}
                </View>

                {/* How to Use */}
                <View>
                  <View className="flex-row items-center mb-2">
                    <FontAwesome name="question-circle" size={14} color={section.color} />
                    <Text className="text-slate-900 dark:text-white font-bold text-sm ml-2">
                      How to Use
                    </Text>
                  </View>
                  {section.howToUse.map((step, index) => (
                    <View key={index} className="flex-row items-start mb-2 ml-1">
                      <View
                        className="w-5 h-5 rounded-full justify-center items-center mr-2 mt-0.5"
                        style={{ backgroundColor: section.color + '20' }}
                      >
                        <Text
                          className="text-xs font-bold"
                          style={{ color: section.color }}
                        >
                          {index + 1}
                        </Text>
                      </View>
                      <Text className="text-slate-600 dark:text-slate-300 text-sm flex-1">
                        {step}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </View>
        ))}

        {/* Additional Help Section */}
        <View className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-slate-800 dark:to-slate-700 rounded-2xl p-6 mb-6 border border-blue-100 dark:border-slate-600">
          <View className="items-center mb-4">
            <View className="w-16 h-16 bg-blue-500 rounded-full justify-center items-center mb-3">
              <FontAwesome name="life-ring" size={32} color="#fff" />
            </View>
            <Text className="text-slate-900 dark:text-white font-bold text-lg text-center">
              Need More Help?
            </Text>
          </View>

          <View className="space-y-3">
            <View className="flex-row items-center bg-white dark:bg-slate-800 p-3 rounded-xl">
              <FontAwesome name="envelope" size={16} color="#3b82f6" />
              <Text className="text-slate-600 dark:text-slate-300 text-sm ml-3 flex-1">
                Email: support@hisabtrack.com
              </Text>
            </View>

            <View className="flex-row items-center bg-white dark:bg-slate-800 p-3 rounded-xl">
              <FontAwesome name="globe" size={16} color="#10b981" />
              <Text className="text-slate-600 dark:text-slate-300 text-sm ml-3 flex-1">
                Visit: www.hisabtrack.com/help
              </Text>
            </View>

            <View className="flex-row items-center bg-white dark:bg-slate-800 p-3 rounded-xl">
              <FontAwesome name="book" size={16} color="#f59e0b" />
              <Text className="text-slate-600 dark:text-slate-300 text-sm ml-3 flex-1">
                Documentation & FAQs available online
              </Text>
            </View>
          </View>
        </View>

        <View className="h-8" />
      </ScrollView>
    </View>
  );
}
