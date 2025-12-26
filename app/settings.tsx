import { useAppSettings } from '@/contexts/AppSettingsContext';
import { useAuth } from '@/contexts/AuthContext';
import { useI18n } from '@/contexts/I18nContext';
import { useTheme } from '@/contexts/ThemeContext';
import { BackupData, BackupService } from '@/services/BackupService';
import { ExportService } from '@/services/ExportService';
import SyncService from '@/services/SyncService';
import { getDatabase } from '@/services/database';
import { RootState } from '@/store';
import { fetchAccounts } from '@/store/slices/accountsSlice';
import { fetchBudgets } from '@/store/slices/budgetsSlice';
import { fetchLoans } from '@/store/slices/loansSlice';
import { fetchTransactions } from '@/store/slices/transactionsSlice';
import { FontAwesome } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Modal, Platform, ScrollView, Switch, Text, TouchableOpacity, View } from 'react-native';

import { useDispatch, useSelector } from 'react-redux';

export default function SettingsScreen() {
  const router = useRouter();
  const dispatch = useDispatch();
  const { theme, setTheme, actualTheme } = useTheme();
  const { t } = useI18n();
  const { user, signOut } = useAuth();
  const [exporting, setExporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { items: transactions } = useSelector((state: RootState) => state.transactions);
  const { items: budgets } = useSelector((state: RootState) => state.budgets);
  const { items: loans } = useSelector((state: RootState) => state.loans);
  const { items: accounts } = useSelector((state: RootState) => state.accounts);

  useEffect(() => {
    // @ts-ignore
    dispatch(fetchTransactions());
    // @ts-ignore
    dispatch(fetchBudgets());
    // @ts-ignore
    dispatch(fetchLoans());
    // @ts-ignore
    dispatch(fetchAccounts());
  }, [dispatch]);

  const handleExportTransactions = async (format: 'excel' | 'csv') => {
    try {
      setExporting(true);
      if (format === 'excel') {
        ExportService.exportTransactionsToExcel(transactions);
      } else {
        ExportService.exportTransactionsToCSV(transactions);
      }
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
      ExportService.exportAllData(transactions, budgets, loans, accounts);
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
      ExportService.generateSummaryReport(transactions);
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
      BackupService.exportBackup(accounts, transactions, budgets, loans);
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
            try {
              const db = await getDatabase();

              // Restore all data
              for (const account of backup.accounts) {
                try {
                  await db.createAccount(account);
                } catch (e) {
                  // Account might already exist
                  console.log('Account exists:', account.id);
                }
              }

              for (const transaction of backup.transactions) {
                try {
                  await db.createTransaction(transaction);
                } catch (e) {
                  console.log('Transaction exists:', transaction.id);
                }
              }

              for (const budget of backup.budgets) {
                try {
                  await db.createBudget(budget);
                } catch (e) {
                  console.log('Budget exists:', budget.id);
                }
              }

              for (const loan of backup.loans) {
                try {
                  await db.createLoan(loan);
                } catch (e) {
                  console.log('Loan exists:', loan.id);
                }
              }

              // Refresh all data
              // @ts-ignore
              dispatch(fetchAccounts());
              // @ts-ignore
              dispatch(fetchTransactions());
              // @ts-ignore
              dispatch(fetchBudgets());
              // @ts-ignore
              dispatch(fetchLoans());

              Alert.alert('Success', 'Backup restored successfully!');
            } catch (error) {
              Alert.alert('Error', 'Failed to restore backup');
              console.error(error);
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

        setExporting(true);
        const backup = await BackupService.readBackupFileFromUri(result.assets[0].uri);

        if (!backup) {
          Alert.alert('Error', 'Invalid backup file');
          return;
        }

        await processBackup(backup);
      } catch (error) {
        Alert.alert('Error', 'Failed to pick backup file');
        console.error(error);
      } finally {
        setExporting(false);
      }
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setExporting(true);
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
      setExporting(false);
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

  const handleSyncNow = async () => {
    if (!user || !user.uid) {
      Alert.alert('Not signed in', 'Please sign in to sync your data.');
      return;
    }
    try {
      setExporting(true);
      await SyncService.pullAllForUser(user.uid);
      await SyncService.pushAllForUser(user.uid);

      // refresh redux state
      // @ts-ignore
      dispatch(fetchAccounts());
      // @ts-ignore
      dispatch(fetchTransactions());
      // @ts-ignore
      dispatch(fetchBudgets());
      // @ts-ignore
      dispatch(fetchLoans());

      Alert.alert('Sync Complete', 'Your data has been synchronized.');
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const { currency, language, fontSize, setCurrency, setLanguage, setFontSize, preferLocalLogos, setPreferLocalLogos } = useAppSettings();
  const [showCurrencyModal, setShowCurrencyModal] = useState(false);

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
  ];
  const fontSizeOptions = ['Small', 'Medium', 'Large'];

  const themeOptions: Array<{ value: 'light' | 'dark' | 'system'; label: string; icon: string }> = [
    { value: 'light', label: 'Light', icon: 'sun-o' },
    { value: 'dark', label: 'Dark', icon: 'moon-o' },
    { value: 'system', label: 'System', icon: 'mobile' },
  ];

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
          <TouchableOpacity onPress={() => router.back()} className="w-10 h-10 bg-white/20 rounded-xl justify-center items-center">
            <FontAwesome name="arrow-left" size={18} color="#fff" />
          </TouchableOpacity>
          <Text className="text-white text-xl font-bold">{t('settings')}</Text>
          <View className="w-10 h-10" />
        </View>
      </LinearGradient>

      <ScrollView className="flex-1 px-6 -mt-6" showsVerticalScrollIndicator={false}>
        {/* Theme Section */}
        <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-slate-100 dark:border-slate-700" style={{ elevation: 4 }}>
          <View className="flex-row items-center mb-4">
            <View className="w-12 h-12 bg-indigo-100 dark:bg-indigo-900/30 rounded-2xl justify-center items-center mr-4">
              <FontAwesome name="paint-brush" size={20} color="#6366f1" />
            </View>
            <View className="flex-1">
              <Text className="text-slate-900 dark:text-white font-bold text-lg">Appearance</Text>
              <Text className="text-slate-500 text-sm">Choose your theme</Text>
            </View>
          </View>

          <View className="space-y-3">
            {themeOptions.map((option) => (
              <TouchableOpacity
                key={option.value}
                onPress={() => setTheme(option.value)}
                className={`flex-row items-center p-4 rounded-2xl border-2 ${theme === option.value
                  ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-500'
                  : 'bg-slate-50 dark:bg-slate-900 border-transparent'
                  }`}
              >
                <View
                  className={`w-10 h-10 rounded-xl justify-center items-center mr-4 ${theme === option.value ? 'bg-indigo-500' : 'bg-slate-200 dark:bg-slate-700'
                    }`}
                >
                  <FontAwesome
                    name={option.icon as any}
                    size={18}
                    color={theme === option.value ? '#fff' : '#64748b'}
                  />
                </View>
                <Text
                  className={`flex-1 font-bold ${theme === option.value
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
        <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-slate-100 dark:border-slate-700" style={{ elevation: 4 }}>
          <View className="flex-row items-center mb-4">
            <View className="w-12 h-12 bg-teal-100 dark:bg-teal-900/30 rounded-2xl justify-center items-center mr-4">
              <FontAwesome name="cogs" size={20} color="#14b8a6" />
            </View>
            <View className="flex-1">
              <Text className="text-slate-900 dark:text-white font-bold text-lg">{t('settings')}</Text>
              <Text className="text-slate-500 text-sm">Customize your app experience</Text>
            </View>
          </View>

          <View className="space-y-4">
            {/* Currency */}
            <View>
              <Text className="text-slate-700 dark:text-slate-300 font-bold mb-2">{t('currency') || 'App Currency'}</Text>
              <TouchableOpacity
                onPress={() => setShowCurrencyModal(true)}
                className="bg-slate-50 dark:bg-slate-900 p-4 rounded-xl border-2 border-slate-200 dark:border-slate-700"
              >
                <View className="flex-row justify-between items-center">
                  <Text className="text-slate-900 dark:text-white font-semibold">
                    {currency} ({currencyOptions.find(c => c.code === currency)?.name})
                  </Text>
                  <FontAwesome name="chevron-down" size={16} color="#64748b" />
                </View>
              </TouchableOpacity>
            </View>

            {/* Language */}
            <View>
              <Text className="text-slate-700 dark:text-slate-300 font-bold mb-2">{t('language') || 'Language'}</Text>
              <View className="flex-row flex-wrap">
                {languageOptions.map((opt) => (
                  <TouchableOpacity
                    key={opt.code}
                    onPress={() => setLanguage(opt.code as any)}
                    className={`mr-2 mb-2 px-4 py-2 rounded-xl border-2 ${language === opt.code
                      ? 'bg-teal-50 dark:bg-teal-900/20 border-teal-500'
                      : 'bg-slate-50 dark:bg-slate-900 border-transparent'
                      }`}
                  >
                    <Text className={`font-bold ${language === opt.code
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
              <Text className="text-slate-700 dark:text-slate-300 font-bold mb-2">{t('fontSize') || 'Font Size'}</Text>
              <View className="flex-row">
                {fontSizeOptions.map((size) => (
                  <TouchableOpacity
                    key={size}
                    onPress={() => setFontSize(size as AppFontSize)}
                    className={`mr-2 px-4 py-2 rounded-xl border-2 ${fontSize === size
                      ? 'bg-teal-50 dark:bg-teal-900/20 border-teal-500'
                      : 'bg-slate-50 dark:bg-slate-900 border-transparent'
                      }`}
                  >
                    <Text className={`font-bold ${fontSize === size
                      ? 'text-teal-600 dark:text-teal-400'
                      : 'text-slate-700 dark:text-slate-300'
                      }`}>
                      {size}
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
              onPress={() => handleExportTransactions('csv')}
              disabled={exporting}
              className="flex-row items-center p-4 bg-slate-50 dark:bg-slate-900 rounded-2xl"
            >
              <View className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-xl justify-center items-center mr-4">
                <FontAwesome name="file-text-o" size={18} color="#3b82f6" />
              </View>
              <Text className="flex-1 text-slate-700 dark:text-slate-300 font-semibold">
                Export Transactions (CSV)
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
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
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
                Sync Now
              </Text>
              <FontAwesome name="chevron-right" size={16} color="#6366f1" />
            </TouchableOpacity>
          </View>
        </View>

        {/* App Info */}
        {/* App Permissions */}
        <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg border border-slate-100 dark:border-slate-700" style={{ elevation: 4 }}>
          <View className="flex-row items-center mb-4">
            <View className="w-12 h-12 bg-yellow-100 dark:bg-yellow-900/30 rounded-2xl justify-center items-center mr-4">
              <FontAwesome name="lock" size={20} color="#f59e0b" />
            </View>
            <View className="flex-1">
              <Text className="text-slate-900 dark:text-white font-bold text-lg">App Permissions</Text>
              <Text className="text-slate-500 text-sm">Grant required permissions for full app functionality</Text>
            </View>
          </View>

          <View className="space-y-3">
            {permissionItems.map((p) => {
              const status = permStatuses[p.id] || 'unknown';
              const webNotApp = Platform.OS === 'web' && (p.id === 'READ_SMS' || p.id === 'SEND_SMS');
              return (
                <View key={p.id} className="flex-row justify-between items-center p-4 bg-slate-50 dark:bg-slate-900 rounded-2xl">
                  <View style={{ flex: 1 }}>
                    <Text className="font-semibold text-slate-800 dark:text-slate-200">{p.label}</Text>
                    {p.desc && <Text className="text-slate-500 text-sm mt-1">{p.desc}</Text>}
                  </View>
                  <View style={{ alignItems: 'flex-end', marginLeft: 12 }}>
                    <Text className="text-slate-500 text-sm mb-2">{status}</Text>
                    {webNotApp ? (
                      <Text className="text-xs text-slate-400">Not available on web</Text>
                    ) : (
                      <TouchableOpacity onPress={() => handleRequest(p.id)} className="bg-indigo-50 dark:bg-indigo-900/20 px-3 py-2 rounded-xl">
                        <Text className="text-indigo-600 dark:text-indigo-400 font-bold">Grant</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        </View>
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
              <Text className="text-slate-900 dark:text-white font-bold">1.0.0</Text>
            </View>
            <View className="flex-row justify-between items-center py-3 border-b border-slate-100 dark:border-slate-700">
              <Text className="text-slate-500">Build</Text>
              <Text className="text-slate-900 dark:text-white font-bold">100</Text>
            </View>
            <View className="flex-row justify-between items-center py-3">
              <Text className="text-slate-500">Developer</Text>
              <Text className="text-slate-900 dark:text-white font-bold">HisabTrack</Text>
            </View>
          </View>
        </View>

        {/* Sign Out Button */}
        {user && (
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
        )}
      </ScrollView>

      {/* Currency Selection Modal */}
      <Modal
        visible={showCurrencyModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCurrencyModal(false)}
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
      </Modal>
    </View>
  );
}
