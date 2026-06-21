import { APP_FONT_SIZE_OPTIONS, type AppFontSize, useAppSettings } from '@/contexts/AppSettingsContext';
import { useAuth } from '@/contexts/AuthContext';
import { useI18n } from '@/contexts/I18nContext';
import { useTheme } from '@/contexts/ThemeContext';
import { BackupData, BackupService } from '@/services/BackupService';
import { useTransactions } from '@/context/TransactionContext';
import AccountResetService from '@/services/AccountResetService';
import { BackgroundService, type BackgroundStatusSnapshot } from '@/services/BackgroundService';
import { ExportService } from '@/services/ExportService';
import RemotePushService, { type RemotePushStatusSnapshot } from '@/services/RemotePushService';
import SyncService from '@/services/SyncService';
import { getDatabase } from '@/services/database';
import { AppDispatch, RootState } from '@/store';
import { fetchAccounts } from '@/store/slices/accountsSlice';
import { fetchBudgets } from '@/store/slices/budgetsSlice';
import { fetchLoans } from '@/store/slices/loansSlice';
import { fetchTransactions } from '@/store/slices/transactionsSlice';
import { FontAwesome } from '@expo/vector-icons';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as DocumentPicker from 'expo-document-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Modal, Platform, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { useDispatch, useSelector } from 'react-redux';

export default function SettingsScreen() {
  const router = useRouter();
  const dispatch = useDispatch<AppDispatch>();
  const { theme, setTheme, actualTheme } = useTheme();
  const { t } = useI18n();
  const { user, signOut } = useAuth();
  const { refreshCategories } = useTransactions();
  const [exporting, setExporting] = useState(false);
  const [backgroundStatus, setBackgroundStatus] = useState<BackgroundStatusSnapshot | null>(null);
  const [backgroundStatusLoading, setBackgroundStatusLoading] = useState(false);
  const [runningMaintenance, setRunningMaintenance] = useState(false);
  const [remotePushStatus, setRemotePushStatus] = useState<RemotePushStatusSnapshot | null>(null);
  const [remotePushLoading, setRemotePushLoading] = useState(false);
  const [registeringRemotePush, setRegisteringRemotePush] = useState(false);
  const [sendingRemoteTestPush, setSendingRemoteTestPush] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetPassword, setResetPassword] = useState('');
  const [isResettingAccount, setIsResettingAccount] = useState(false);
  const [resetAccountError, setResetAccountError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { items: transactions } = useSelector((state: RootState) => state.transactions);
  const { items: budgets } = useSelector((state: RootState) => state.budgets);
  const { items: loans } = useSelector((state: RootState) => state.loans);
  const { items: accounts } = useSelector((state: RootState) => state.accounts);
  const appVersion = Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '1.0.0';
  const appBuild = Application.nativeBuildVersion
    ?? (Platform.OS === 'android'
      ? String(Constants.expoConfig?.android?.versionCode ?? 'web')
      : Platform.OS === 'ios'
        ? String(Constants.expoConfig?.ios?.buildNumber ?? 'web')
        : 'web');

  useEffect(() => {
    dispatch(fetchTransactions());
    dispatch(fetchBudgets());
    dispatch(fetchLoans());
    dispatch(fetchAccounts());
  }, [dispatch]);

  const handleExportTransactions = async (format: 'excel' | 'pdf') => {
    try {
      setExporting(true);
      await ExportService.exportReport({
        data: transactions,
        accounts,
        title: 'Transaction History',
        type: 'transactions',
        format,
        timeRange: 'Monthly',
        summary: {
          balance: transactions.filter(t => t.type === 'INCOME').reduce((s, t) => s + t.amount, 0) -
            transactions.filter(t => t.type === 'EXPENSE').reduce((s, t) => s + t.amount, 0)
        }
      });
      Alert.alert('Success', `Transactions exported to ${format.toUpperCase()} successfully!`);
    } catch (error) {
      Alert.alert('Error', 'Failed to export transactions');
      console.error(error);
    } finally {
      setExporting(false);
    }
  };

  const handleExportAllData = async () => {
    try {
      setExporting(true);
      await ExportService.exportReport({
        data: transactions,
        loans,
        accounts,
        budgets,
        title: 'Complete Financial Backup',
        type: 'all_data',
        format: 'excel',
        timeRange: 'All Time'
      });
      Alert.alert('Success', 'All data exported successfully!');
    } catch (error) {
      Alert.alert('Error', 'Failed to export data');
      console.error(error);
    } finally {
      setExporting(false);
    }
  };

  const handleExportSummary = async () => {
    try {
      setExporting(true);
      const income = transactions.filter(t => t.type === 'INCOME').reduce((s, t) => s + t.amount, 0);
      const expense = transactions.filter(t => t.type === 'EXPENSE').reduce((s, t) => s + t.amount, 0);

      await ExportService.exportReport({
        data: transactions,
        accounts,
        title: 'Financial Summary Report',
        type: 'summary',
        format: 'pdf',
        timeRange: 'Monthly',
        summary: {
          income,
          expense,
          savingsRate: income > 0 ? ((income - expense) / income) * 100 : 0
        }
      });
      Alert.alert('Success', 'Summary report generated successfully!');
    } catch (error) {
      Alert.alert('Error', 'Failed to generate summary');
      console.error(error);
    } finally {
      setExporting(false);
    }
  };

  const handleCreateBackup = async () => {
    try {
      setExporting(true);
      await BackupService.exportBackup(accounts, transactions, budgets, loans);
      Alert.alert('Success', 'Backup created successfully!');
    } catch (error) {
      Alert.alert('Error', 'Failed to create backup');
      console.error(error);
    } finally {
      setExporting(false);
    }
  };

  const processBackup = async (backup: BackupData) => {
    const stats = BackupService.getBackupStats(backup);
    const summary = BackupService.createBackupSummary(backup);

    Alert.alert(
      'Restore Backup?',
      `${summary}\n\nThis will add all data from the backup to your current data. Continue?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore',
          onPress: async () => {
            setExporting(true);
            try {
              const db = await getDatabase();
              const affectedAccountIds = new Set<string>();

              // Restore all data
              for (const account of backup.accounts) {
                await db.upsertAccount(account);
              }

              for (const transaction of backup.transactions) {
                await db.upsertTransaction(transaction);
                affectedAccountIds.add(transaction.account_id);
                if (transaction.to_account_id) {
                  affectedAccountIds.add(transaction.to_account_id);
                }
              }

              for (const budget of backup.budgets) {
                await db.upsertBudget(budget);
              }

              for (const loan of backup.loans) {
                await db.upsertLoan(loan);
              }

              // 1. Restore categories
              if (backup.categories && Array.isArray(backup.categories)) {
                try {
                  const { StorageService } = await import('@/utils/storage');
                  const existingCats = await StorageService.loadCategories();
                  const mergedCats = [...existingCats];
                  for (const cat of backup.categories) {
                    if (!mergedCats.some(c => c.id === cat.id)) {
                      mergedCats.push(cat);
                    }
                  }
                  await StorageService.saveCategories(mergedCats);
                  await refreshCategories();
                } catch (e) {
                  console.warn('[settings] Failed to restore categories:', e);
                }
              }

              // 2. Restore recurring transactions
              if (backup.recurringTransactions && Array.isArray(backup.recurringTransactions)) {
                try {
                  const { Platform } = await import('react-native');
                  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
                  let existingRecurring: any[] = [];
                  if (Platform.OS === 'web') {
                    const stored = localStorage.getItem('recurring_transactions');
                    if (stored) existingRecurring = JSON.parse(stored);
                  } else {
                    const stored = await AsyncStorage.getItem('@hisabtrack_recurring_transactions');
                    if (stored) existingRecurring = JSON.parse(stored);
                  }

                  const mergedRecurring = [...existingRecurring];
                  for (const rt of backup.recurringTransactions) {
                    if (!mergedRecurring.some(r => r.id === rt.id)) {
                      mergedRecurring.push(rt);
                    }
                  }

                  const serialized = JSON.stringify(mergedRecurring);
                  if (Platform.OS === 'web') {
                    localStorage.setItem('recurring_transactions', serialized);
                  } else {
                    await AsyncStorage.setItem('@hisabtrack_recurring_transactions', serialized);
                  }
                } catch (e) {
                  console.warn('[settings] Failed to restore recurring transactions:', e);
                }
              }

              // 3. Restore app settings
              if (backup.settings) {
                try {
                  const { Platform } = await import('react-native');
                  if (Platform.OS === 'web') {
                    localStorage.setItem('app_settings', JSON.stringify(backup.settings));
                  } else {
                    const { SecureStorageService } = await import('@/services/SecureStorageService');
                    const existing = await SecureStorageService.getUserData();
                    const next = { ...(existing || {}), appSettings: backup.settings };
                    await SecureStorageService.saveUserData(next);
                  }
                  // Emit change to reload context
                  const LocalChangeEmitter = (await import('@/services/LocalChangeEmitter')).default;
                  LocalChangeEmitter.emit();
                } catch (e) {
                  console.warn('[settings] Failed to restore settings:', e);
                }
              }

              // 4. Restore SMS learning rules
              if (backup.smsLearningRules) {
                try {
                  const { SMSLearningService } = await import('@/services/SMSLearningService');
                  const existingRules = await SMSLearningService.getAllRules();
                  const mergedRules = { ...existingRules, ...backup.smsLearningRules };
                  await SMSLearningService.saveAllRules(mergedRules);
                } catch (e) {
                  console.warn('[settings] Failed to restore SMS learning rules:', e);
                }
              }

              await Promise.all(
                [...affectedAccountIds].map((accountId) => db.recalculateAccountBalance(accountId))
              );

              // Refresh all data
              dispatch(fetchAccounts());
              dispatch(fetchTransactions());
              dispatch(fetchBudgets());
              dispatch(fetchLoans());

              Alert.alert('Success', 'Backup restored successfully!');
            } catch (error) {
              Alert.alert('Error', 'Failed to restore backup');
              console.error(error);
            } finally {
              setExporting(false);
            }
          },
        },
      ]
    );
  };

  const handleRestoreBackup = async () => {
    if (Platform.OS === 'web') {
      if (fileInputRef.current) {
        fileInputRef.current.click();
      }
    } else {
      try {
        const result = await DocumentPicker.getDocumentAsync({
          type: 'application/json',
          copyToCacheDirectory: true,
        });

        if (result.canceled) return;

        const backup = await BackupService.readBackupFileFromUri(result.assets[0].uri);

        if (!backup) {
          Alert.alert('Error', 'Invalid backup file');
          return;
        }

        await processBackup(backup);
      } catch (error) {
        Alert.alert('Error', 'Failed to pick backup file');
        console.error(error);
      }
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const backup = await BackupService.readBackupFile(file);

      if (!backup) {
        Alert.alert('Error', 'Invalid backup file');
        return;
      }

      await processBackup(backup);
    } catch (error) {
      Alert.alert('Error', 'Failed to read backup file');
      console.error(error);
    } finally {
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleSignOut = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            try {
              await signOut();
              router.replace('/(auth)/login');
            } catch (error) {
              Alert.alert('Error', 'Failed to sign out');
            }
          },
        },
      ]
    );
  };

  const handleResetAccountPrompt = () => {
    if (!user) {
      Alert.alert('Not signed in', 'Sign in first to reset this account.');
      return;
    }

    Alert.alert(
      'Reset Account',
      'This permanently deletes all your data from this device and your online account. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => {
            setResetPassword('');
            setResetAccountError(null);
            setShowResetModal(true);
          },
        },
      ]
    );
  };

  const handleConfirmResetAccount = async () => {
    if (!resetPassword.trim()) {
      setResetAccountError('Password is required.');
      return;
    }

    setIsResettingAccount(true);
    setResetAccountError(null);

    try {
      await AccountResetService.resetWithPassword(resetPassword);
      setShowResetModal(false);
      setResetPassword('');

      try {
        await signOut();
      } catch (error) {
        console.warn('Sign-out after reset failed, continuing to login screen', error);
      }

      router.replace('/(auth)/login');
    } catch (error) {
      setResetAccountError(AccountResetService.getResetErrorMessage(error));
    } finally {
      setIsResettingAccount(false);
    }
  };

  const handleSyncNow = async () => {
    try {
      setExporting(true);
      const result = await SyncService.syncNow(user?.uid);
      Alert.alert(
        result.cloudSynced ? 'Sync Complete' : 'Refresh Complete',
        result.cloudSynced
          ? 'Your local and online data have been synchronized.'
          : 'Your local data has been refreshed. Sign in to sync online.'
      );
    } catch (e) {
      console.error('Sync failed', e);
      Alert.alert('Sync Failed', 'An error occurred while syncing.');
    } finally {
      setExporting(false);
    }
  };

  // --- Permissions Section ---
  type PermItem = { id: import('@/services/PermissionsService').PermissionId; label: string; desc?: string };

  const permissionItems: PermItem[] = [
    { id: 'READ_SMS', label: 'Read SMS', desc: 'Allow reading incoming SMS (Android only)' },
    { id: 'SEND_SMS', label: 'Send SMS', desc: 'Allow sending SMS from the app (Android only)' },
    { id: 'NOTIFICATIONS', label: 'Notifications', desc: 'Allow push & local notifications' },
    { id: 'FILES', label: 'Files (Read/Write)', desc: 'Access device storage to read/write files' },
    { id: 'CALENDAR', label: 'Calendar', desc: 'Access calendar events' },
    { id: 'LOCATION', label: 'Location', desc: 'Access device location' },
    { id: 'CAMERA', label: 'Camera', desc: 'Take photos or scan documents' },
    { id: 'CONTACTS', label: 'Contacts', desc: 'Access contacts for quick selection' },
  ];

  const [permStatuses, setPermStatuses] = useState<Record<string, string>>({});

  const loadPermissions = async () => {
    const { checkPermission } = await import('@/services/PermissionsService');
    const next: Record<string, string> = {};
    await Promise.all(permissionItems.map(async (p) => {
      try {
        const s = await checkPermission(p.id as any);
        next[p.id] = s;
      } catch (e) {
        next[p.id] = 'unknown';
      }
    }));
    setPermStatuses(next);
  };

  useEffect(() => {
    loadPermissions();
    void refreshBackgroundStatus();
    void refreshRemotePushStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refreshRemotePushStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  const handleRequest = async (id: string) => {
    const { requestPermission } = await import('@/services/PermissionsService');
    try {
      const result = await requestPermission(id as any);
      setPermStatuses((prev) => ({ ...prev, [id]: result }));

      if (result === 'granted') {
        Alert.alert('Permission granted');
        return;
      }

      if (result === 'denied') {
        Alert.alert(
          'Permission denied',
          'Permission was denied. You can enable it from the system settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open settings', onPress: () => Linking.openSettings() },
          ]
        );
        return;
      }

      // prompt or unknown — direct user to settings as a fallback
      Alert.alert(
        'Enable Permission',
        'Please enable this permission from your device settings to continue.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open settings', onPress: () => Linking.openSettings() },
        ]
      );
    } catch (e) {
      console.error('Permission request failed', e);
      Alert.alert('Error', 'Failed to request permission');
    }
  };

  const {
    currency,
    language,
    fontSize,
    setCurrency,
    setLanguage,
    setFontSize,
    preferLocalLogos,
    setPreferLocalLogos,
    geminiApiKey,
    setGeminiApiKey,
    groqApiKey,
    setGroqApiKey,
    openRouterApiKey,
    setOpenRouterApiKey,
    puterJsEnabled,
    setPuterJsEnabled,
    backgroundReminders,
    setBackgroundProcessingEnabled,
    setBackgroundSmsSyncEnabled,
    setPendingDraftAlertsEnabled,
    setInactivityAlertsEnabled,
    setReconciliationAlertsEnabled,
    assistantOverlay,
    setAssistantEnabled,
    setAssistantTipsEnabled,
    setAssistantDashboardEnabled,
    setAssistantTransactionsEnabled,
    setAssistantReportsEnabled,
  } = useAppSettings();
  const [showCurrencyModal, setShowCurrencyModal] = useState(false);

  const handleBackgroundProcessingToggle = async (enabled: boolean) => {
    setBackgroundProcessingEnabled(enabled);
    if (Platform.OS === 'web') return;

    if (enabled) {
      await BackgroundService.registerTask(true);
    } else {
      await BackgroundService.unregisterTask();
    }

    await refreshBackgroundStatus();
  };

  const refreshBackgroundStatus = async () => {
    setBackgroundStatusLoading(true);
    try {
      const snapshot = await BackgroundService.getStatusSnapshot();
      setBackgroundStatus(snapshot);
    } catch (error) {
      console.error('Failed to refresh background status', error);
    } finally {
      setBackgroundStatusLoading(false);
    }
  };

  const refreshRemotePushStatus = async () => {
    if (!user?.uid) {
      setRemotePushStatus(null);
      return;
    }

    setRemotePushLoading(true);
    try {
      const snapshot = await RemotePushService.getStatusSnapshot(user.uid);
      setRemotePushStatus(snapshot);
    } catch (error) {
      console.error('Failed to refresh remote push status', error);
    } finally {
      setRemotePushLoading(false);
    }
  };

  const handleRegisterRemotePush = async () => {
    if (!user?.uid) {
      Alert.alert('Not signed in', 'Sign in first to register this device for remote push.');
      return;
    }

    if (Platform.OS === 'web') {
      Alert.alert('Not available on web', 'Remote push registration requires a native device build.');
      return;
    }

    setRegisteringRemotePush(true);
    try {
      const result = await RemotePushService.syncCurrentDevice(user.uid);
      await refreshRemotePushStatus();

      if (result.status === 'registered') {
        Alert.alert('Push device registered', 'This device can now receive server-delivered push notifications.');
      } else if (result.status === 'denied') {
        Alert.alert('Permission required', 'Notification permission was denied. Enable notifications and try again.');
      } else if (result.status === 'unsupported') {
        Alert.alert('Unsupported environment', result.lastError || 'Remote push needs a physical development or production build.');
      } else {
        Alert.alert('Registration failed', result.lastError || 'Unable to register this device for remote push.');
      }
    } catch (error) {
      console.error('Remote push registration failed', error);
      Alert.alert('Registration failed', 'Unable to register this device for remote push.');
    } finally {
      setRegisteringRemotePush(false);
    }
  };

  const handleSendRemotePushTest = async () => {
    if (!user?.uid) {
      Alert.alert('Not signed in', 'Sign in first to send a remote push test.');
      return;
    }

    if (Platform.OS === 'web') {
      Alert.alert('Not available on web', 'Remote push delivery is only available on native builds.');
      return;
    }

    setSendingRemoteTestPush(true);
    try {
      await RemotePushService.sendTestPush(user.uid);
      Alert.alert('Test queued', 'The backend queue received your test push. It should arrive once the Cloud Function is deployed and Expo credentials are configured.');
    } catch (error) {
      console.error('Failed to queue remote push test', error);
      Alert.alert('Queue failed', 'Unable to queue the remote push test.');
    } finally {
      setSendingRemoteTestPush(false);
    }
  };

  const handleRunMaintenanceNow = async () => {
    if (Platform.OS === 'web') {
      Alert.alert('Not available on web', 'Background maintenance only runs on Android and iOS builds.');
      return;
    }

    setRunningMaintenance(true);
    try {
      await BackgroundService.runMaintenanceNow();
      await refreshBackgroundStatus();
      Alert.alert('Maintenance complete', 'Background checks were run successfully.');
    } catch (error) {
      console.error('Manual maintenance failed', error);
      Alert.alert('Maintenance failed', 'Unable to run background checks right now.');
    } finally {
      setRunningMaintenance(false);
    }
  };

  const handleMarkReviewedNow = async () => {
    if (Platform.OS === 'web') {
      Alert.alert('Not available on web', 'Reconciliation tracking is only used by native background maintenance.');
      return;
    }

    await BackgroundService.markReconciliationReview();
    await refreshBackgroundStatus();
    Alert.alert('Review updated', 'The reconciliation reminder timer has been reset.');
  };

  const formatBackgroundTime = (timestamp?: number) => {
    if (!timestamp) return 'Never';
    return new Date(timestamp).toLocaleString();
  };

  const currencyOptions = [
    { code: 'USD', name: 'United States Dollar' },
    { code: 'EUR', name: 'Euro' },
    { code: 'GBP', name: 'British Pound Sterling' },
    { code: 'JPY', name: 'Japanese Yen' },
    { code: 'CAD', name: 'Canadian Dollar' },
    { code: 'AUD', name: 'Australian Dollar' },
    { code: 'CHF', name: 'Swiss Franc' },
    { code: 'CNY', name: 'Chinese Yuan' },
    { code: 'SEK', name: 'Swedish Krona' },
    { code: 'NZD', name: 'New Zealand Dollar' },
    { code: 'MXN', name: 'Mexican Peso' },
    { code: 'SGD', name: 'Singapore Dollar' },
    { code: 'HKD', name: 'Hong Kong Dollar' },
    { code: 'NOK', name: 'Norwegian Krone' },
    { code: 'KRW', name: 'South Korean Won' },
    { code: 'TRY', name: 'Turkish Lira' },
    { code: 'RUB', name: 'Russian Ruble' },
    { code: 'INR', name: 'Indian Rupee' },
    { code: 'BRL', name: 'Brazilian Real' },
    { code: 'ZAR', name: 'South African Rand' },
    { code: 'AED', name: 'UAE Dirham' },
    { code: 'AFN', name: 'Afghan Afghani' },
    { code: 'ALL', name: 'Albanian Lek' },
    { code: 'AMD', name: 'Armenian Dram' },
    { code: 'ANG', name: 'Netherlands Antillean Guilder' },
    { code: 'AOA', name: 'Angolan Kwanza' },
    { code: 'ARS', name: 'Argentine Peso' },
    { code: 'AWG', name: 'Aruban Florin' },
    { code: 'AZN', name: 'Azerbaijani Manat' },
    { code: 'BAM', name: 'Bosnia-Herzegovina Convertible Mark' },
    { code: 'BBD', name: 'Barbadian Dollar' },
    { code: 'BDT', name: 'Bangladeshi Taka' },
    { code: 'BGN', name: 'Bulgarian Lev' },
    { code: 'BHD', name: 'Bahraini Dinar' },
    { code: 'BIF', name: 'Burundian Franc' },
    { code: 'BMD', name: 'Bermudian Dollar' },
    { code: 'BND', name: 'Brunei Dollar' },
    { code: 'BOB', name: 'Bolivian Boliviano' },
    { code: 'BSD', name: 'Bahamian Dollar' },
    { code: 'BTN', name: 'Bhutanese Ngultrum' },
    { code: 'BWP', name: 'Botswanan Pula' },
    { code: 'BYN', name: 'Belarusian Ruble' },
    { code: 'BZD', name: 'Belize Dollar' },
    { code: 'CDF', name: 'Congolese Franc' },
    { code: 'CLP', name: 'Chilean Peso' },
    { code: 'COP', name: 'Colombian Peso' },
    { code: 'CRC', name: 'Costa Rican Colón' },
    { code: 'CUC', name: 'Cuban Convertible Peso' },
    { code: 'CUP', name: 'Cuban Peso' },
    { code: 'CVE', name: 'Cape Verdean Escudo' },
    { code: 'CZK', name: 'Czech Koruna' },
    { code: 'DJF', name: 'Djiboutian Franc' },
    { code: 'DKK', name: 'Danish Krone' },
    { code: 'DOP', name: 'Dominican Peso' },
    { code: 'DZD', name: 'Algerian Dinar' },
    { code: 'EGP', name: 'Egyptian Pound' },
    { code: 'ERN', name: 'Eritrean Nakfa' },
    { code: 'ETB', name: 'Ethiopian Birr' },
    { code: 'FJD', name: 'Fijian Dollar' },
    { code: 'FKP', name: 'Falkland Islands Pound' },
    { code: 'GEL', name: 'Georgian Lari' },
    { code: 'GHS', name: 'Ghanaian Cedi' },
    { code: 'GIP', name: 'Gibraltar Pound' },
    { code: 'GMD', name: 'Gambian Dalasi' },
    { code: 'GNF', name: 'Guinean Franc' },
    { code: 'GTQ', name: 'Guatemalan Quetzal' },
    { code: 'GYD', name: 'Guyanaese Dollar' },
    { code: 'HNL', name: 'Honduran Lempira' },
    { code: 'HRK', name: 'Croatian Kuna' },
    { code: 'HTG', name: 'Haitian Gourde' },
    { code: 'HUF', name: 'Hungarian Forint' },
    { code: 'IDR', name: 'Indonesian Rupiah' },
    { code: 'ILS', name: 'Israeli New Shekel' },
    { code: 'IQD', name: 'Iraqi Dinar' },
    { code: 'IRR', name: 'Iranian Rial' },
    { code: 'ISK', name: 'Icelandic Króna' },
    { code: 'JMD', name: 'Jamaican Dollar' },
    { code: 'JOD', name: 'Jordanian Dinar' },
    { code: 'KES', name: 'Kenyan Shilling' },
    { code: 'KGS', name: 'Kyrgystani Som' },
    { code: 'KHR', name: 'Cambodian Riel' },
    { code: 'KMF', name: 'Comorian Franc' },
    { code: 'KPW', name: 'North Korean Won' },
    { code: 'KWD', name: 'Kuwaiti Dinar' },
    { code: 'KYD', name: 'Cayman Islands Dollar' },
    { code: 'KZT', name: 'Kazakhstani Tenge' },
    { code: 'LAK', name: 'Laotian Kip' },
    { code: 'LBP', name: 'Lebanese Pound' },
    { code: 'LKR', name: 'Sri Lankan Rupee' },
    { code: 'LRD', name: 'Liberian Dollar' },
    { code: 'LSL', name: 'Lesotho Loti' },
    { code: 'LYD', name: 'Libyan Dinar' },
    { code: 'MAD', name: 'Moroccan Dirham' },
    { code: 'MDL', name: 'Moldovan Leu' },
    { code: 'MGA', name: 'Malagasy Ariary' },
    { code: 'MKD', name: 'Macedonian Denar' },
    { code: 'MMK', name: 'Myanmar Kyat' },
    { code: 'MNT', name: 'Mongolian Tugrik' },
    { code: 'MOP', name: 'Macanese Pataca' },
    { code: 'MRU', name: 'Mauritanian Ouguiya' },
    { code: 'MUR', name: 'Mauritian Rupee' },
    { code: 'MVR', name: 'Maldivian Rufiyaa' },
    { code: 'MWK', name: 'Malawian Kwacha' },
    { code: 'MYR', name: 'Malaysian Ringgit' },
    { code: 'MZN', name: 'Mozambican Metical' },
    { code: 'NAD', name: 'Namibian Dollar' },
    { code: 'NGN', name: 'Nigerian Naira' },
    { code: 'NIO', name: 'Nicaraguan Córdoba' },
    { code: 'NPR', name: 'Nepalese Rupee' },
    { code: 'OMR', name: 'Omani Rial' },
    { code: 'PAB', name: 'Panamanian Balboa' },
    { code: 'PEN', name: 'Peruvian Nuevo Sol' },
    { code: 'PGK', name: 'Papua New Guinean Kina' },
    { code: 'PHP', name: 'Philippine Peso' },
    { code: 'PKR', name: 'Pakistani Rupee' },
    { code: 'PLN', name: 'Polish Złoty' },
    { code: 'PYG', name: 'Paraguayan Guarani' },
    { code: 'QAR', name: 'Qatari Rial' },
    { code: 'RON', name: 'Romanian Leu' },
    { code: 'RSD', name: 'Serbian Dinar' },
    { code: 'RWF', name: 'Rwandan Franc' },
    { code: 'SAR', name: 'Saudi Riyal' },
    { code: 'SBD', name: 'Solomon Islands Dollar' },
    { code: 'SCR', name: 'Seychellois Rupee' },
    { code: 'SDG', name: 'Sudanese Pound' },
    { code: 'SHP', name: 'Saint Helena Pound' },
    { code: 'SLL', name: 'Sierra Leonean Leone' },
    { code: 'SOS', name: 'Somali Shilling' },
    { code: 'SRD', name: 'Surinamese Dollar' },
    { code: 'SSP', name: 'South Sudanese Pound' },
    { code: 'STN', name: 'São Tomé and Príncipe Dobra' },
    { code: 'SVC', name: 'Salvadoran Colón' },
    { code: 'SYP', name: 'Syrian Pound' },
    { code: 'SZL', name: 'Swazi Lilangeni' },
    { code: 'THB', name: 'Thai Baht' },
    { code: 'TJS', name: 'Tajikistani Somoni' },
    { code: 'TMT', name: 'Turkmenistani Manat' },
    { code: 'TND', name: 'Tunisian Dinar' },
    { code: 'TOP', name: 'Tongan Paʻanga' },
    { code: 'TTD', name: 'Trinidad and Tobago Dollar' },
    { code: 'TWD', name: 'New Taiwan Dollar' },
    { code: 'TZS', name: 'Tanzanian Shilling' },
    { code: 'UAH', name: 'Ukrainian Hryvnia' },
    { code: 'UGX', name: 'Ugandan Shilling' },
    { code: 'UYU', name: 'Uruguayan Peso' },
    { code: 'UZS', name: 'Uzbekistan Som' },
    { code: 'VES', name: 'Venezuelan Bolívar' },
    { code: 'VND', name: 'Vietnamese Dong' },
    { code: 'VUV', name: 'Vanuatu Vatu' },
    { code: 'WST', name: 'Samoan Tala' },
    { code: 'XAF', name: 'CFA Franc BEAC' },
    { code: 'XCD', name: 'East Caribbean Dollar' },
    { code: 'XDR', name: 'Special Drawing Rights' },
    { code: 'XOF', name: 'CFA Franc BCEAO' },
    { code: 'XPF', name: 'CFP Franc' },
    { code: 'YER', name: 'Yemeni Rial' },
    { code: 'ZMW', name: 'Zambian Kwacha' },
    { code: 'ZWL', name: 'Zimbabwean Dollar' }
  ];
  const languageOptions = [
    { code: 'en', label: 'English' },
    { code: 'es', label: 'Spanish' },
    { code: 'am', label: 'Amharic (አማርኛ)' },
    { code: 'om', label: 'Oromifa (Afaan Oromoo)' },
    { code: 'ti', label: 'Tigrinya (ትግርኛ)' },
  ];
  const fontSizeOptions: Array<{ value: AppFontSize; label: string }> = APP_FONT_SIZE_OPTIONS.map((value) => ({
    value,
    label: value === 'V.Small' ? 'v.small' : value.toLowerCase(),
  }));

  const themeOptions: Array<{ value: 'light' | 'dark' | 'system'; label: string; icon: string }> = [
    { value: 'light', label: 'Light', icon: 'sun-o' },
    { value: 'dark', label: 'Dark', icon: 'moon-o' },
    { value: 'system', label: 'System', icon: 'mobile' },
  ];
  const isVerySmallFont = fontSize === 'V.Small';
  const headerTitleClass = fontSize === 'V.Small' ? 'text-lg' : fontSize === 'Large' ? 'text-2xl' : 'text-xl';
  const sectionTitleClass = fontSize === 'V.Small' ? 'text-base' : fontSize === 'Large' ? 'text-xl' : 'text-lg';
  const sectionSubtitleClass = fontSize === 'V.Small' ? 'text-xs' : 'text-sm';
  const fieldLabelClass = fontSize === 'V.Small' ? 'text-xs' : 'text-sm';
  const selectorPillClass = isVerySmallFont ? 'mr-2 mb-2 px-3 py-1.5 rounded-xl border-2' : 'mr-2 mb-2 px-4 py-2 rounded-xl border-2';
  const selectorTextClass = fontSize === 'V.Small' ? 'text-xs' : fontSize === 'Large' ? 'text-base' : 'text-sm';
  const sectionCardClass = isVerySmallFont ? 'bg-white dark:bg-slate-800 rounded-3xl p-4 mb-6 shadow-lg border border-slate-100 dark:border-slate-700' : 'bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-slate-100 dark:border-slate-700';

  return (
    <View className="flex-1 bg-slate-50 dark:bg-background-dark">
      <StatusBar style="auto" />

      {/* Header */}
      <LinearGradient
        colors={actualTheme === 'dark' ? ['#334155', '#1e293b'] : ['#cbd5e1', '#94a3b8']}
        className="px-6 pt-6 pb-8 rounded-b-[32px]"
        style={{ elevation: 4 }}
      >
        <View className="flex-row justify-between items-center">
          <TouchableOpacity onPress={() => router.back()} className={`${isVerySmallFont ? 'w-9 h-9' : 'w-10 h-10'} bg-white/20 rounded-xl justify-center items-center`}>
            <FontAwesome name="arrow-left" size={isVerySmallFont ? 16 : 18} color="#fff" />
          </TouchableOpacity>
          <Text className={`text-white ${headerTitleClass} font-bold`}>{t('settings')}</Text>
          <View className={`${isVerySmallFont ? 'w-9 h-9' : 'w-10 h-10'}`} />
        </View>
      </LinearGradient>

      <ScrollView className="flex-1 px-6 -mt-6" showsVerticalScrollIndicator={false}>
        {/* Theme Section */}
        <View className={sectionCardClass} style={{ elevation: 4 }}>
          <View className="flex-row items-center mb-4">
            <View className={`${isVerySmallFont ? 'w-10 h-10 mr-3 rounded-xl' : 'w-12 h-12 mr-4 rounded-2xl'} bg-indigo-100 dark:bg-indigo-900/30 justify-center items-center`}>
              <FontAwesome name="paint-brush" size={isVerySmallFont ? 18 : 20} color="#6366f1" />
            </View>
            <View className="flex-1">
              <Text className={`text-slate-900 dark:text-white font-bold ${sectionTitleClass}`}>Appearance</Text>
              <Text className={`text-slate-500 ${sectionSubtitleClass}`}>Choose your theme</Text>
            </View>
          </View>

          <View className="space-y-3">
            {themeOptions.map((option) => (
              <TouchableOpacity
                key={option.value}
                onPress={() => setTheme(option.value)}
                className={`flex-row items-center ${isVerySmallFont ? 'p-3 rounded-xl' : 'p-4 rounded-2xl'} border-2 ${theme === option.value
                  ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-500'
                  : 'bg-slate-50 dark:bg-slate-900 border-transparent'
                  }`}
              >
                <View
                  className={`${isVerySmallFont ? 'w-9 h-9 mr-3' : 'w-10 h-10 mr-4'} rounded-xl justify-center items-center ${theme === option.value ? 'bg-indigo-500' : 'bg-slate-200 dark:bg-slate-700'
                    }`}
                >
                  <FontAwesome
                    name={option.icon as any}
                    size={isVerySmallFont ? 16 : 18}
                    color={theme === option.value ? '#fff' : '#64748b'}
                  />
                </View>
                <Text
                  className={`flex-1 font-bold ${selectorTextClass} ${theme === option.value
                    ? 'text-indigo-600 dark:text-indigo-400'
                    : 'text-slate-700 dark:text-slate-300'
                    }`}
                >
                  {option.label}
                </Text>
                {theme === option.value && (
                  <FontAwesome name="check-circle" size={20} color="#6366f1" />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* App Preferences Section */}
        <View className={sectionCardClass} style={{ elevation: 4 }}>
          <View className="flex-row items-center mb-4">
            <View className={`${isVerySmallFont ? 'w-10 h-10 mr-3 rounded-xl' : 'w-12 h-12 mr-4 rounded-2xl'} bg-teal-100 dark:bg-teal-900/30 justify-center items-center`}>
              <FontAwesome name="cogs" size={isVerySmallFont ? 18 : 20} color="#14b8a6" />
            </View>
            <View className="flex-1">
              <Text className={`text-slate-900 dark:text-white font-bold ${sectionTitleClass}`}>{t('settings')}</Text>
              <Text className={`text-slate-500 ${sectionSubtitleClass}`}>Customize your app experience</Text>
            </View>
          </View>

          <View className="space-y-4">
            {/* Currency */}
            <View>
              <Text className={`text-slate-700 dark:text-slate-300 font-bold mb-2 ${fieldLabelClass}`}>{t('currency') || 'App Currency'}</Text>
              <TouchableOpacity
                onPress={() => setShowCurrencyModal(true)}
                className={`bg-slate-50 dark:bg-slate-900 ${isVerySmallFont ? 'p-3' : 'p-4'} rounded-xl border-2 border-slate-200 dark:border-slate-700`}
              >
                <View className="flex-row justify-between items-center">
                  <Text className={`text-slate-900 dark:text-white font-semibold ${selectorTextClass}`}>
                    {currency} ({currencyOptions.find(c => c.code === currency)?.name})
                  </Text>
                  <FontAwesome name="chevron-down" size={isVerySmallFont ? 14 : 16} color="#64748b" />
                </View>
              </TouchableOpacity>
            </View>

            {/* Language */}
            <View>
              <Text className={`text-slate-700 dark:text-slate-300 font-bold mb-2 ${fieldLabelClass}`}>{t('language') || 'Language'}</Text>
              <View className="flex-row flex-wrap">
                {languageOptions.map((opt) => (
                  <TouchableOpacity
                    key={opt.code}
                    onPress={() => setLanguage(opt.code as any)}
                    className={`${selectorPillClass} ${language === opt.code
                      ? 'bg-teal-50 dark:bg-teal-900/20 border-teal-500'
                      : 'bg-slate-50 dark:bg-slate-900 border-transparent'
                      }`}
                  >
                    <Text className={`font-bold ${selectorTextClass} ${language === opt.code
                      ? 'text-teal-600 dark:text-teal-400'
                      : 'text-slate-700 dark:text-slate-300'
                      }`}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Font Size */}
            <View>
              <Text className={`text-slate-700 dark:text-slate-300 font-bold mb-2 ${fieldLabelClass}`}>{t('fontSize') || 'Font Size'}</Text>
              <View className="flex-row flex-wrap">
                {fontSizeOptions.map((size) => (
                  <TouchableOpacity
                    key={size.value}
                    onPress={() => setFontSize(size.value)}
                    className={`${selectorPillClass} ${fontSize === size.value
                      ? 'bg-teal-50 dark:bg-teal-900/20 border-teal-500'
                      : 'bg-slate-50 dark:bg-slate-900 border-transparent'
                      }`}
                  >
                    <Text className={`font-bold ${selectorTextClass} ${fontSize === size.value
                      ? 'text-teal-600 dark:text-teal-400'
                      : 'text-slate-700 dark:text-slate-300'
                      }`}>
                      {size.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            {/* Local Logos Preference */}
            <View>
              <Text className="text-slate-700 dark:text-slate-300 font-bold mb-2">Prefer Local Logos</Text>
              <View className="flex-row items-center justify-between bg-slate-50 dark:bg-slate-900 p-4 rounded-xl border-2 border-slate-200 dark:border-slate-700">
                <View style={{ flex: 1 }}>
                  <Text className="text-slate-900 dark:text-white font-semibold">Use local bank logos when available</Text>
                  <Text className="text-slate-500 text-sm">Prioritize bundled logos over remote lookups</Text>
                </View>
                <View style={{ marginLeft: 12 }}>
                  <Switch value={!!preferLocalLogos} onValueChange={(v) => setPreferLocalLogos(v)} />
                </View>
              </View>
              <View className="mt-3">
                <TouchableOpacity onPress={() => router.push('/manage-assets')} className="flex-row items-center p-3 bg-slate-50 dark:bg-slate-900 rounded-xl">
                  <View className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/30 rounded-xl justify-center items-center mr-4">
                    <FontAwesome name="folder" size={18} color="#6366f1" />
                  </View>
                  <Text className="font-bold text-slate-700 dark:text-slate-300">Manage Local Assets</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>

        {/* AI Configuration Section */}
        <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-slate-100 dark:border-slate-700" style={{ elevation: 4 }}>
          <View className="flex-row items-center mb-4">
            <View className="w-12 h-12 bg-indigo-100 dark:bg-indigo-900/30 rounded-2xl justify-center items-center mr-4">
              <FontAwesome name="magic" size={20} color="#6366f1" />
            </View>
            <View className="flex-1">
              <Text className="text-slate-900 dark:text-white font-bold text-lg">AI Assistant</Text>
              <Text className="text-slate-500 text-sm">Configure AI features</Text>
            </View>
          </View>

          <View className="space-y-4">
            <View>
              <View className="flex-row justify-between items-center mb-2">
                <Text className="text-slate-700 dark:text-slate-300 font-bold">Gemini API Key</Text>
                <TouchableOpacity onPress={() => Linking.openURL('https://aistudio.google.com/app/apikey')}>
                  <Text className="text-indigo-500 text-xs font-bold">Get Key</Text>
                </TouchableOpacity>
              </View>
              <TextInput
                value={geminiApiKey}
                onChangeText={setGeminiApiKey}
                placeholder="Enter your Gemini API key"
                placeholderTextColor="#94a3b8"
                secureTextEntry
                className="bg-slate-50 dark:bg-slate-900 p-4 rounded-xl border-2 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
              />
              <Text className="text-slate-400 text-[10px] mt-2 leading-4">
                Your API key is stored securely on your device. It is used to power the AI Financial Assistant features.
              </Text>
            </View>

            <View>
              <View className="flex-row justify-between items-center mb-2">
                <Text className="text-slate-700 dark:text-slate-300 font-bold">Groq API Key</Text>
                <TouchableOpacity onPress={() => Linking.openURL('https://console.groq.com/keys')}>
                  <Text className="text-indigo-500 text-xs font-bold">Get Key</Text>
                </TouchableOpacity>
              </View>
              <TextInput
                value={groqApiKey}
                onChangeText={setGroqApiKey}
                placeholder="Enter your Groq API key"
                placeholderTextColor="#94a3b8"
                secureTextEntry
                className="bg-slate-50 dark:bg-slate-900 p-4 rounded-xl border-2 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
              />
            </View>

            <View>
              <View className="flex-row justify-between items-center mb-2">
                <Text className="text-slate-700 dark:text-slate-300 font-bold">OpenRouter API Key</Text>
                <TouchableOpacity onPress={() => Linking.openURL('https://openrouter.ai/keys')}>
                  <Text className="text-indigo-500 text-xs font-bold">Get Key</Text>
                </TouchableOpacity>
              </View>
              <TextInput
                value={openRouterApiKey}
                onChangeText={setOpenRouterApiKey}
                placeholder="Enter your OpenRouter API key"
                placeholderTextColor="#94a3b8"
                secureTextEntry
                className="bg-slate-50 dark:bg-slate-900 p-4 rounded-xl border-2 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
              />
              <Text className="text-slate-400 text-[10px] mt-2 leading-4">
                Add at least one key or enable Puter.js on web. The app will automatically fail over across configured providers.
              </Text>
            </View>

            <View className="bg-slate-50 dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-700">
              <View className="flex-row items-center justify-between">
                <View className="flex-1 pr-3">
                  <Text className="text-slate-900 dark:text-white font-semibold">Use Puter.js on Web</Text>
                  <Text className="text-slate-500 text-xs mt-1">
                    Free web AI fallback without storing another API key (requires internet and browser support).
                  </Text>
                </View>
                <Switch value={!!puterJsEnabled} onValueChange={setPuterJsEnabled} />
              </View>
              <TouchableOpacity className="mt-3" onPress={() => Linking.openURL('https://puter.com')}>
                <Text className="text-indigo-500 text-xs font-bold">Learn about Puter.js</Text>
              </TouchableOpacity>
            </View>

            <View className="bg-slate-50 dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-700">
              <View className="flex-row items-center justify-between">
                <View className="flex-1 pr-3">
                  <Text className="text-slate-900 dark:text-white font-semibold">Floating Assistant</Text>
                  <Text className="text-slate-500 text-xs mt-1">
                    Show the free local assistant button and chat overlay in the app.
                  </Text>
                </View>
                <Switch value={assistantOverlay.enabled} onValueChange={setAssistantEnabled} />
              </View>

              <View className={`mt-4 space-y-3 ${assistantOverlay.enabled ? '' : 'opacity-50'}`}>
                <View className="flex-row items-center justify-between">
                  <View className="flex-1 pr-3">
                    <Text className="text-slate-800 dark:text-slate-200 font-medium">Bottom Tips</Text>
                    <Text className="text-slate-500 text-xs">Show proactive AI tip messages at the bottom.</Text>
                  </View>
                  <Switch
                    value={assistantOverlay.tipsEnabled}
                    onValueChange={setAssistantTipsEnabled}
                    disabled={!assistantOverlay.enabled}
                  />
                </View>

                <View className="h-px bg-slate-200 dark:bg-slate-700" />

                <Text className="text-slate-700 dark:text-slate-300 text-xs font-bold uppercase tracking-wide">
                  Show On Screens
                </Text>

                <View className="flex-row items-center justify-between">
                  <Text className="text-slate-800 dark:text-slate-200">Dashboard</Text>
                  <Switch
                    value={assistantOverlay.showOnDashboard}
                    onValueChange={setAssistantDashboardEnabled}
                    disabled={!assistantOverlay.enabled}
                  />
                </View>
                <View className="flex-row items-center justify-between">
                  <Text className="text-slate-800 dark:text-slate-200">Transactions</Text>
                  <Switch
                    value={assistantOverlay.showOnTransactions}
                    onValueChange={setAssistantTransactionsEnabled}
                    disabled={!assistantOverlay.enabled}
                  />
                </View>
                <View className="flex-row items-center justify-between">
                  <Text className="text-slate-800 dark:text-slate-200">Reports</Text>
                  <Switch
                    value={assistantOverlay.showOnReports}
                    onValueChange={setAssistantReportsEnabled}
                    disabled={!assistantOverlay.enabled}
                  />
                </View>
              </View>
            </View>
          </View>
        </View>

        <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-slate-100 dark:border-slate-700" style={{ elevation: 4 }}>
          <View className="flex-row items-center mb-4">
            <View className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/30 rounded-2xl justify-center items-center mr-4">
              <FontAwesome name="paper-plane" size={20} color="#10b981" />
            </View>
            <View className="flex-1">
              <Text className="text-slate-900 dark:text-white font-bold text-lg">Remote Push</Text>
              <Text className="text-slate-500 text-sm">Register this device and test the backend delivery pipeline</Text>
            </View>
          </View>

          <View className="space-y-3">
            <View className="bg-slate-50 dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-700">
              <View className="flex-row items-center justify-between mb-3">
                <Text className="text-slate-900 dark:text-white font-semibold">Device Status</Text>
                <TouchableOpacity onPress={() => { void refreshRemotePushStatus(); }} disabled={remotePushLoading}>
                  <Text className="text-emerald-600 dark:text-emerald-400 text-xs font-bold">
                    {remotePushLoading ? 'Refreshing...' : 'Refresh'}
                  </Text>
                </TouchableOpacity>
              </View>

              <View className="space-y-2">
                <View className="flex-row justify-between items-center">
                  <Text className="text-slate-500 text-sm">Signed in</Text>
                  <Text className="text-slate-900 dark:text-white font-semibold">{user?.uid ? 'Yes' : 'No'}</Text>
                </View>
                <View className="flex-row justify-between items-center">
                  <Text className="text-slate-500 text-sm">Supported</Text>
                  <Text className="text-slate-900 dark:text-white font-semibold">{remotePushStatus?.supported ? 'Yes' : 'No'}</Text>
                </View>
                <View className="flex-row justify-between items-center">
                  <Text className="text-slate-500 text-sm">Device doc</Text>
                  <Text className="text-slate-900 dark:text-white font-semibold">{remotePushStatus?.documentExists ? 'Registered' : 'Not registered'}</Text>
                </View>
                <View className="flex-row justify-between items-center">
                  <Text className="text-slate-500 text-sm">Notifications</Text>
                  <Text className="text-slate-900 dark:text-white font-semibold">{remotePushStatus?.notificationsEnabled ? 'Granted' : 'Not granted'}</Text>
                </View>
                <View className="flex-row justify-between items-center">
                  <Text className="text-slate-500 text-sm">Device active</Text>
                  <Text className="text-slate-900 dark:text-white font-semibold">{remotePushStatus?.isActive ? 'Yes' : 'No'}</Text>
                </View>
                <View className="flex-row justify-between items-center">
                  <Text className="text-slate-500 text-sm">Project ID</Text>
                  <Text className="text-slate-900 dark:text-white text-xs font-semibold">
                    {remotePushStatus?.projectId || 'Missing'}
                  </Text>
                </View>
                <View className="flex-row justify-between items-center">
                  <Text className="text-slate-500 text-sm">Push token</Text>
                  <Text className="text-slate-900 dark:text-white text-xs font-semibold">
                    {remotePushStatus?.expoPushTokenPreview || 'Unavailable'}
                  </Text>
                </View>
                <View className="flex-row justify-between items-center">
                  <Text className="text-slate-500 text-sm">Last sync</Text>
                  <Text className="text-slate-900 dark:text-white text-xs font-semibold">
                    {formatBackgroundTime(remotePushStatus?.updatedAt ?? undefined)}
                  </Text>
                </View>
                {remotePushStatus?.lastError ? (
                  <View className="bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 rounded-xl p-3 mt-2">
                    <Text className="text-red-600 dark:text-red-300 text-xs leading-5">
                      {remotePushStatus.lastError}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>

            <View className="flex-row">
              <TouchableOpacity
                onPress={() => { void handleRegisterRemotePush(); }}
                disabled={registeringRemotePush || !user?.uid}
                className={`flex-1 mr-2 p-4 rounded-2xl ${registeringRemotePush || !user?.uid ? 'bg-slate-200 dark:bg-slate-700' : 'bg-emerald-600'}`}
              >
                <Text className={`text-center font-bold ${registeringRemotePush || !user?.uid ? 'text-slate-500 dark:text-slate-400' : 'text-white'}`}>
                  {registeringRemotePush ? 'Registering...' : 'Register Device'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => { void handleSendRemotePushTest(); }}
                disabled={sendingRemoteTestPush || !user?.uid}
                className={`flex-1 ml-2 p-4 rounded-2xl ${sendingRemoteTestPush || !user?.uid ? 'bg-slate-200 dark:bg-slate-700' : 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800'}`}
              >
                <Text className={`text-center font-bold ${sendingRemoteTestPush || !user?.uid ? 'text-slate-500 dark:text-slate-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                  {sendingRemoteTestPush ? 'Queueing...' : 'Send Test Push'}
                </Text>
              </TouchableOpacity>
            </View>

            <View className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800 rounded-2xl p-4">
              <Text className="text-emerald-700 dark:text-emerald-300 text-xs leading-5">
                Server-delivered push requires Expo credentials in EAS and a deployed Cloud Function backend. The test button only queues the job; delivery starts once the backend is deployed.
              </Text>
            </View>
          </View>
        </View>

        <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-slate-100 dark:border-slate-700" style={{ elevation: 4 }}>
          <View className="flex-row items-center mb-4">
            <View className="w-12 h-12 bg-sky-100 dark:bg-sky-900/30 rounded-2xl justify-center items-center mr-4">
              <FontAwesome name="bell" size={20} color="#0ea5e9" />
            </View>
            <View className="flex-1">
              <Text className="text-slate-900 dark:text-white font-bold text-lg">Background Alerts</Text>
              <Text className="text-slate-500 text-sm">Low-power reminders for drafts, inactivity, and review routines</Text>
            </View>
          </View>

          <View className="space-y-3">
            <View className="flex-row items-center justify-between p-4 bg-slate-50 dark:bg-slate-900 rounded-2xl border-2 border-slate-200 dark:border-slate-700">
              <View style={{ flex: 1 }}>
                <Text className="text-slate-900 dark:text-white font-semibold">Enable background maintenance</Text>
                <Text className="text-slate-500 text-sm">Lets the OS wake the app occasionally for lightweight checks and local reminders.</Text>
              </View>
              <View style={{ marginLeft: 12 }}>
                <Switch
                  value={backgroundReminders.backgroundProcessingEnabled}
                  onValueChange={(value) => { void handleBackgroundProcessingToggle(value); }}
                />
              </View>
            </View>

            <View className={`space-y-3 ${backgroundReminders.backgroundProcessingEnabled ? '' : 'opacity-50'}`}>
              <View className="flex-row items-center justify-between p-4 bg-slate-50 dark:bg-slate-900 rounded-2xl">
                <View style={{ flex: 1 }}>
                  <Text className="text-slate-900 dark:text-white font-semibold">Alert on new SMS drafts</Text>
                  <Text className="text-slate-500 text-sm">Android only. Detects fresh bank SMS transactions that still need review.</Text>
                </View>
                <View style={{ marginLeft: 12 }}>
                  <Switch
                    value={backgroundReminders.backgroundSmsSyncEnabled}
                    onValueChange={setBackgroundSmsSyncEnabled}
                    disabled={!backgroundReminders.backgroundProcessingEnabled}
                  />
                </View>
              </View>

              <View className="flex-row items-center justify-between p-4 bg-slate-50 dark:bg-slate-900 rounded-2xl">
                <View style={{ flex: 1 }}>
                  <Text className="text-slate-900 dark:text-white font-semibold">Pending draft reminders</Text>
                  <Text className="text-slate-500 text-sm">Nudges you when SMS transactions stay unrecorded for too long.</Text>
                </View>
                <View style={{ marginLeft: 12 }}>
                  <Switch
                    value={backgroundReminders.pendingDraftAlertsEnabled}
                    onValueChange={setPendingDraftAlertsEnabled}
                    disabled={!backgroundReminders.backgroundProcessingEnabled}
                  />
                </View>
              </View>

              <View className="flex-row items-center justify-between p-4 bg-slate-50 dark:bg-slate-900 rounded-2xl">
                <View style={{ flex: 1 }}>
                  <Text className="text-slate-900 dark:text-white font-semibold">Inactivity nudges</Text>
                  <Text className="text-slate-500 text-sm">Sends a low-frequency reminder after long gaps without opening the app.</Text>
                </View>
                <View style={{ marginLeft: 12 }}>
                  <Switch
                    value={backgroundReminders.inactivityAlertsEnabled}
                    onValueChange={setInactivityAlertsEnabled}
                    disabled={!backgroundReminders.backgroundProcessingEnabled}
                  />
                </View>
              </View>

              <View className="flex-row items-center justify-between p-4 bg-slate-50 dark:bg-slate-900 rounded-2xl">
                <View style={{ flex: 1 }}>
                  <Text className="text-slate-900 dark:text-white font-semibold">Reconciliation reminders</Text>
                  <Text className="text-slate-500 text-sm">Prompts you to review drafts and balances if you have not reconciled recently.</Text>
                </View>
                <View style={{ marginLeft: 12 }}>
                  <Switch
                    value={backgroundReminders.reconciliationAlertsEnabled}
                    onValueChange={setReconciliationAlertsEnabled}
                    disabled={!backgroundReminders.backgroundProcessingEnabled}
                  />
                </View>
              </View>
            </View>

            <View className="bg-sky-50 dark:bg-sky-900/20 border border-sky-100 dark:border-sky-800 rounded-2xl p-4">
              <Text className="text-sky-700 dark:text-sky-300 text-xs leading-5">
                Battery note: the app does not run continuously in the background. Loan and recurring due reminders still use exact scheduled notifications, while these checks run in batched OS windows to save power.
              </Text>
            </View>

            <View className="bg-slate-50 dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-700">
              <View className="flex-row items-center justify-between mb-3">
                <Text className="text-slate-900 dark:text-white font-semibold">Runtime Status</Text>
                <TouchableOpacity onPress={() => { void refreshBackgroundStatus(); }} disabled={backgroundStatusLoading}>
                  <Text className="text-sky-600 dark:text-sky-400 text-xs font-bold">
                    {backgroundStatusLoading ? 'Refreshing...' : 'Refresh'}
                  </Text>
                </TouchableOpacity>
              </View>

              <View className="space-y-2">
                <View className="flex-row justify-between items-center">
                  <Text className="text-slate-500 text-sm">Background API</Text>
                  <Text className="text-slate-900 dark:text-white font-semibold capitalize">
                    {backgroundStatus?.taskStatus || (backgroundStatusLoading ? 'Loading...' : 'Unknown')}
                  </Text>
                </View>
                <View className="flex-row justify-between items-center">
                  <Text className="text-slate-500 text-sm">Task registered</Text>
                  <Text className="text-slate-900 dark:text-white font-semibold">
                    {backgroundStatus?.taskRegistered ? 'Yes' : 'No'}
                  </Text>
                </View>
                <View className="flex-row justify-between items-center">
                  <Text className="text-slate-500 text-sm">Notifications</Text>
                  <Text className="text-slate-900 dark:text-white font-semibold">
                    {backgroundStatus?.notificationsEnabled ? 'Granted' : 'Not granted'}
                  </Text>
                </View>
                <View className="flex-row justify-between items-center">
                  <Text className="text-slate-500 text-sm">Last app active</Text>
                  <Text className="text-slate-900 dark:text-white text-xs font-semibold">
                    {formatBackgroundTime(backgroundStatus?.state.lastAppActiveAt)}
                  </Text>
                </View>
                <View className="flex-row justify-between items-center">
                  <Text className="text-slate-500 text-sm">Last foreground check</Text>
                  <Text className="text-slate-900 dark:text-white text-xs font-semibold">
                    {formatBackgroundTime(backgroundStatus?.state.lastForegroundCheckAt)}
                  </Text>
                </View>
                <View className="flex-row justify-between items-center">
                  <Text className="text-slate-500 text-sm">Last background check</Text>
                  <Text className="text-slate-900 dark:text-white text-xs font-semibold">
                    {formatBackgroundTime(backgroundStatus?.state.lastBackgroundCheckAt)}
                  </Text>
                </View>
                <View className="flex-row justify-between items-center">
                  <Text className="text-slate-500 text-sm">Last SMS scan</Text>
                  <Text className="text-slate-900 dark:text-white text-xs font-semibold">
                    {formatBackgroundTime(backgroundStatus?.state.lastSmsSyncAt)}
                  </Text>
                </View>
                <View className="flex-row justify-between items-center">
                  <Text className="text-slate-500 text-sm">Last reconciliation review</Text>
                  <Text className="text-slate-900 dark:text-white text-xs font-semibold">
                    {formatBackgroundTime(backgroundStatus?.state.lastReconciliationAt)}
                  </Text>
                </View>
              </View>
            </View>

            <View className="flex-row">
              <TouchableOpacity
                onPress={() => { void handleRunMaintenanceNow(); }}
                disabled={runningMaintenance || !backgroundReminders.backgroundProcessingEnabled}
                className={`flex-1 mr-2 p-4 rounded-2xl ${runningMaintenance || !backgroundReminders.backgroundProcessingEnabled ? 'bg-slate-200 dark:bg-slate-700' : 'bg-sky-600'}`}
              >
                <Text className={`text-center font-bold ${runningMaintenance || !backgroundReminders.backgroundProcessingEnabled ? 'text-slate-500 dark:text-slate-400' : 'text-white'}`}>
                  {runningMaintenance ? 'Running...' : 'Run Check Now'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => { void handleMarkReviewedNow(); }}
                className="flex-1 ml-2 p-4 rounded-2xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800"
              >
                <Text className="text-center text-indigo-600 dark:text-indigo-400 font-bold">
                  Mark Reviewed
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Permissions Section */}
        <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-slate-100 dark:border-slate-700" style={{ elevation: 4 }}>
          <View className="flex-row items-center mb-4">
            <View className="w-12 h-12 bg-orange-100 dark:bg-orange-900/30 rounded-2xl justify-center items-center mr-4">
              <FontAwesome name="shield" size={20} color="#f97316" />
            </View>
            <View className="flex-1">
              <Text className="text-slate-900 dark:text-white font-bold text-lg">Permissions & Access</Text>
              <Text className="text-slate-500 text-sm">Manage app permissions</Text>
            </View>
          </View>

          <View className="space-y-3">
            {permissionItems.map((item) => {
              const status = permStatuses[item.id] || 'unknown';
              const isGranted = status === 'granted';
              return (
                <View key={item.id} className="flex-row items-center justify-between p-3 bg-slate-50 dark:bg-slate-900 rounded-2xl border-2 border-transparent">
                  <View className="flex-1 mr-2">
                    <Text className="text-slate-900 dark:text-white font-bold text-sm">{item.label}</Text>
                    {item.desc && <Text className="text-slate-400 text-xs">{item.desc}</Text>}
                  </View>
                  <TouchableOpacity
                    onPress={() => handleRequest(item.id as any)}
                    disabled={isGranted}
                    className={`px-3 py-1.5 rounded-lg border ${isGranted
                      ? 'bg-green-100 dark:bg-green-900/30 border-green-200 dark:border-green-800'
                      : 'bg-slate-200 dark:bg-slate-700 border-slate-300 dark:border-slate-600'
                      }`}
                  >
                    <Text className={`text-xs font-bold ${isGranted ? 'text-green-700 dark:text-green-400' : 'text-slate-600 dark:text-slate-400'}`}>
                      {isGranted ? 'Granted' : 'Enable'}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        </View>

        {/* Export Data Section */}
        <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-slate-100 dark:border-slate-700" style={{ elevation: 4 }}>
          <View className="flex-row items-center mb-4">
            <View className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-2xl justify-center items-center mr-4">
              <FontAwesome name="download" size={20} color="#10b981" />
            </View>
            <View className="flex-1">
              <Text className="text-slate-900 dark:text-white font-bold text-lg">Export Data</Text>
              <Text className="text-slate-500 text-sm">Download your financial data</Text>
            </View>
          </View>

          <View className="space-y-3">
            <TouchableOpacity
              onPress={() => handleExportTransactions('excel')}
              disabled={exporting}
              className="flex-row items-center p-4 bg-slate-50 dark:bg-slate-900 rounded-2xl"
            >
              <View className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-xl justify-center items-center mr-4">
                <FontAwesome name="file-excel-o" size={18} color="#10b981" />
              </View>
              <Text className="flex-1 text-slate-700 dark:text-slate-300 font-semibold">
                Export Transactions (Excel)
              </Text>
              <FontAwesome name="chevron-right" size={16} color="#94a3b8" />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => handleExportTransactions('pdf')}
              disabled={exporting}
              className="flex-row items-center p-4 bg-slate-50 dark:bg-slate-900 rounded-2xl"
            >
              <View className="w-10 h-10 bg-red-100 dark:bg-red-900/30 rounded-xl justify-center items-center mr-4">
                <FontAwesome name="file-pdf-o" size={18} color="#ef4444" />
              </View>
              <Text className="flex-1 text-slate-700 dark:text-slate-300 font-semibold">
                Export Transactions (PDF)
              </Text>
              <FontAwesome name="chevron-right" size={16} color="#94a3b8" />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleExportSummary}
              disabled={exporting}
              className="flex-row items-center p-4 bg-slate-50 dark:bg-slate-900 rounded-2xl"
            >
              <View className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-xl justify-center items-center mr-4">
                <FontAwesome name="bar-chart" size={18} color="#9333ea" />
              </View>
              <Text className="flex-1 text-slate-700 dark:text-slate-300 font-semibold">
                Generate Summary Report
              </Text>
              <FontAwesome name="chevron-right" size={16} color="#94a3b8" />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleExportAllData}
              disabled={exporting}
              className="flex-row items-center p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-2xl border-2 border-indigo-500"
            >
              <View className="w-10 h-10 bg-indigo-500 rounded-xl justify-center items-center mr-4">
                <FontAwesome name="database" size={18} color="#fff" />
              </View>
              <Text className="flex-1 text-indigo-600 dark:text-indigo-400 font-bold">
                Export All Data
              </Text>
              <FontAwesome name="chevron-right" size={16} color="#6366f1" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Backup & Restore Section */}
        <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-slate-100 dark:border-slate-700" style={{ elevation: 4 }}>
          <View className="flex-row items-center mb-4">
            <View className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-2xl justify-center items-center mr-4">
              <FontAwesome name="cloud" size={20} color="#3b82f6" />
            </View>
            <View className="flex-1">
              <Text className="text-slate-900 dark:text-white font-bold text-lg">Backup & Restore</Text>
              <Text className="text-slate-500 text-sm">Backup and restore your data</Text>
            </View>
          </View>

          {/* Hidden file input for restore */}
          {Platform.OS === 'web' && (
            <label
              htmlFor="restore-backup"
              className="hidden"
              aria-hidden="true"
            >
              <input
                ref={fileInputRef}
                id="restore-backup"
                type="file"
                accept=".json"
                onChange={handleFileSelect}
                title="Restore backup file"
                placeholder="Restore Backup"
              />
            </label>
          )}

          <View className="space-y-3">
            <TouchableOpacity
              onPress={handleCreateBackup}
              disabled={exporting}
              className="flex-row items-center p-4 bg-blue-50 dark:bg-blue-900/20 rounded-2xl border-2 border-blue-500"
            >
              <View className="w-10 h-10 bg-blue-500 rounded-xl justify-center items-center mr-4">
                <FontAwesome name="download" size={18} color="#fff" />
              </View>
              <Text className="flex-1 text-blue-600 dark:text-blue-400 font-bold">
                Create Backup
              </Text>
              <FontAwesome name="chevron-right" size={16} color="#3b82f6" />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleRestoreBackup}
              disabled={exporting}
              className="flex-row items-center p-4 bg-slate-50 dark:bg-slate-900 rounded-2xl"
            >
              <View className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-xl justify-center items-center mr-4">
                <FontAwesome name="upload" size={18} color="#10b981" />
              </View>
              <Text className="flex-1 text-slate-700 dark:text-slate-300 font-semibold">
                Restore from Backup
              </Text>
              <FontAwesome name="chevron-right" size={16} color="#94a3b8" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSyncNow}
              disabled={exporting}
              className="flex-row items-center p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-2xl border-2 border-indigo-500 mt-2"
            >
              <View className="w-10 h-10 bg-indigo-500 rounded-xl justify-center items-center mr-4">
                <FontAwesome name="refresh" size={18} color="#fff" />
              </View>
              <Text className="flex-1 text-indigo-600 dark:text-indigo-400 font-bold">
                {user?.uid ? 'Sync Local + Cloud' : 'Refresh Local Data'}
              </Text>
              <FontAwesome name="chevron-right" size={16} color="#6366f1" />
            </TouchableOpacity>
          </View>
        </View>

        {/* App Info */}
        <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-8 shadow-lg border border-slate-100 dark:border-slate-700" style={{ elevation: 4 }}>
          <View className="flex-row items-center mb-4">
            <View className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-2xl justify-center items-center mr-4">
              <FontAwesome name="info-circle" size={20} color="#3b82f6" />
            </View>
            <View className="flex-1">
              <Text className="text-slate-900 dark:text-white font-bold text-lg">App Information</Text>
            </View>
          </View>

          <View className="space-y-3">
            <View className="flex-row justify-between items-center py-3 border-b border-slate-100 dark:border-slate-700">
              <Text className="text-slate-500">Version</Text>
              <Text className="text-slate-900 dark:text-white font-bold">{appVersion}</Text>
            </View>
            <View className="flex-row justify-between items-center py-3 border-b border-slate-100 dark:border-slate-700">
              <Text className="text-slate-500">Build</Text>
              <Text className="text-slate-900 dark:text-white font-bold">{appBuild}</Text>
            </View>
            <View className="flex-row justify-between items-center py-3">
              <Text className="text-slate-500">Developer</Text>
              <Text className="text-slate-900 dark:text-white font-bold">HisabTrack</Text>
            </View>
          </View>
        </View>

        {/* Danger Zone */}
        {user ? (
          <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-red-200 dark:border-red-800" style={{ elevation: 4 }}>
            <View className="flex-row items-center mb-4">
              <View className="w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-2xl justify-center items-center mr-4">
                <FontAwesome name="warning" size={20} color="#ef4444" />
              </View>
              <View className="flex-1">
                <Text className="text-slate-900 dark:text-white font-bold text-lg">Danger Zone</Text>
                <Text className="text-slate-500 text-sm">Permanent account actions</Text>
              </View>
            </View>

            <View className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-4 mb-3">
              <Text className="text-red-700 dark:text-red-300 text-sm leading-5">
                Reset Account permanently deletes all local and cloud financial records for this account.
              </Text>
            </View>

            <TouchableOpacity
              onPress={handleResetAccountPrompt}
              disabled={isResettingAccount}
              className={`flex-row items-center p-4 rounded-2xl border-2 ${isResettingAccount ? 'bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600' : 'bg-red-50 dark:bg-red-900/20 border-red-500'}`}
            >
              <View className={`w-10 h-10 rounded-xl justify-center items-center mr-4 ${isResettingAccount ? 'bg-slate-200 dark:bg-slate-600' : 'bg-red-500'}`}>
                <FontAwesome name="trash" size={18} color={isResettingAccount ? '#64748b' : '#fff'} />
              </View>
              <Text className={`flex-1 font-bold ${isResettingAccount ? 'text-slate-500 dark:text-slate-400' : 'text-red-600 dark:text-red-400'}`}>
                {isResettingAccount ? 'Resetting...' : 'Reset Account'}
              </Text>
              <FontAwesome name="chevron-right" size={16} color={isResettingAccount ? '#94a3b8' : '#ef4444'} />
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Sign Out Button */}
        {
          user && (
            <TouchableOpacity
              onPress={handleSignOut}
              className="bg-red-50 dark:bg-red-900/20 rounded-3xl p-6 mb-8 border-2 border-red-500"
            >
              <View className="flex-row items-center justify-center">
                <FontAwesome name="sign-out" size={20} color="#ef4444" />
                <Text className="text-red-600 dark:text-red-400 font-bold text-lg ml-3">
                  Sign Out
                </Text>
              </View>
            </TouchableOpacity>
          )
        }
      </ScrollView >

      <Modal
        visible={showResetModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!isResettingAccount) {
            setShowResetModal(false);
          }
        }}
      >
        <View className="flex-1 bg-black/50 justify-center items-center px-6">
          <View className="bg-white dark:bg-slate-800 w-full rounded-3xl p-6 shadow-xl">
            <View className="items-center mb-4">
              <View className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full justify-center items-center mb-4">
                <FontAwesome name="lock" size={30} color="#ef4444" />
              </View>
              <Text className="text-slate-900 dark:text-white text-xl font-bold text-center">
                Confirm Account Reset
              </Text>
              <Text className="text-slate-500 text-sm text-center mt-2">
                Enter your account password to permanently delete your local and online financial data.
              </Text>
            </View>

            <View className="mb-6">
              <Text className="text-slate-700 dark:text-slate-300 font-bold mb-2">Password</Text>
              <TextInput
                className="bg-slate-50 dark:bg-slate-900 px-4 py-4 rounded-xl border-2 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                placeholder="Enter your password"
                placeholderTextColor="#94a3b8"
                secureTextEntry
                value={resetPassword}
                onChangeText={setResetPassword}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
              />
              {resetAccountError ? (
                <Text className="text-red-500 text-xs mt-2 font-medium">{resetAccountError}</Text>
              ) : null}
            </View>

            <View className="flex-row gap-3">
              <TouchableOpacity
                disabled={isResettingAccount}
                onPress={() => setShowResetModal(false)}
                className="flex-1 bg-slate-100 dark:bg-slate-700 h-14 rounded-xl justify-center items-center"
              >
                <Text className="text-slate-600 dark:text-slate-300 font-bold">Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                disabled={isResettingAccount || !resetPassword.trim()}
                onPress={() => { void handleConfirmResetAccount(); }}
                className={`flex-1 h-14 rounded-xl justify-center items-center ${isResettingAccount || !resetPassword.trim() ? 'bg-red-300 dark:bg-red-900/50' : 'bg-red-500'}`}
              >
                {isResettingAccount ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text className="text-white font-bold">Delete Permanently</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Currency Selection Modal */}
      < Modal
        visible={showCurrencyModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCurrencyModal(false)
        }
      >
        <View className="flex-1 bg-black/50 justify-center items-center px-6">
          <View className="bg-white dark:bg-slate-900 rounded-3xl p-6 w-full max-w-sm max-h-[70%]">
            <View className="flex-row justify-between items-center mb-4">
              <Text className="text-slate-900 dark:text-white text-xl font-bold">{t('currency') || 'Select Currency'}</Text>
              <TouchableOpacity onPress={() => setShowCurrencyModal(false)}>
                <FontAwesome name="times" size={24} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {currencyOptions.map((currOption) => (
                <TouchableOpacity
                  key={currOption.code}
                  onPress={() => {
                    setCurrency(currOption.code);
                    setShowCurrencyModal(false);
                  }}
                  className={`py-3 px-4 rounded-xl mb-2 ${currency === currOption.code
                    ? 'bg-teal-50 dark:bg-teal-900/20'
                    : 'bg-slate-50 dark:bg-slate-900'
                    }`}
                >
                  <View className="flex-row justify-between items-center">
                    <Text className={`font-semibold ${currency === currOption.code
                      ? 'text-teal-600 dark:text-teal-400'
                      : 'text-slate-700 dark:text-slate-300'
                      }`}>
                      {currOption.code} ({currOption.name})
                    </Text>
                    {currency === currOption.code && (
                      <FontAwesome name="check" size={16} color="#14b8a6" />
                    )}
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal >
    </View >
  );
}
