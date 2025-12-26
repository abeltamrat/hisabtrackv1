import { BUNDLED_LOGOS } from '@/assets/bankLogos/et';
import { useAppSettings } from '@/contexts/AppSettingsContext';
import { BankService } from '@/services/BankService';
import LocalAssetService from '@/services/LocalAssetService';
import LocalChangeEmitter from '@/services/LocalChangeEmitter';
import { RootState } from '@/store';
import { addAccount, deleteAccount, fetchAccounts, updateAccount } from '@/store/slices/accountsSlice';
import { Bank } from '@/types/bank';
import { Account, AccountType } from '@/types/database';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Keyboard, PermissionsAndroid, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { useDispatch, useSelector } from 'react-redux';

export default function Accounts() {
  const router = useRouter();
  const dispatch = useDispatch();
  const accounts = useSelector((state: RootState) => state.accounts.items);
  const { preferLocalLogos, formatCurrency } = useAppSettings();
  const [showAddModal, setShowAddModal] = useState(false);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [accountName, setAccountName] = useState('');
  const [accountType, setAccountType] = useState<AccountType>('CASH');
  const [initialBalance, setInitialBalance] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [smsNumber, setSmsNumber] = useState('');
  const [fetchedSmsNumbers, setFetchedSmsNumbers] = useState<string[]>([]);
  const [loadingSms, setLoadingSms] = useState(false);
  const [showSmsList, setShowSmsList] = useState(false);

  // Logo suggestions
  const [accountLogo, setAccountLogo] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [imageSuggestions, setImageSuggestions] = useState<string[]>([]);
  const [imageLoading, setImageLoading] = useState(false);
  const [localLogos, setLocalLogos] = useState<Record<string, string>>({});

  // Location-aware prioritization
  const userCountry = useMemo(() => {
    try {
      if (Platform.OS === 'web') {
        const lang = (typeof navigator !== 'undefined' && (navigator as any).language) || 'en-US';
        const region = lang.split('-')[1];
        return (region || 'US').toUpperCase();
      }
      const locale = Intl.DateTimeFormat().resolvedOptions().locale || 'en-US';
      const region = locale.split('-')[1];
      return (region || 'US').toUpperCase();
    } catch {
      return 'US';
    }
  }, []);

  const popularBanks: Record<string, Array<{ name: string; domain: string }>> = {
    ET: [
      { name: 'Commercial Bank of Ethiopia', domain: 'cbe.com.et' },
      { name: 'Awash Bank', domain: 'awashbank.com' },
      { name: 'Dashen Bank', domain: 'dashenbanksc.com' },
      { name: 'Bank of Abyssinia', domain: 'bankofabyssinia.com' },
      { name: 'Nib International Bank', domain: 'nibbanksc.com' },
      { name: 'Cooperative Bank of Oromia', domain: 'coopbankoromia.com.et' },
      { name: 'Wegagen Bank', domain: 'wegagen.com' },
      { name: 'Berhan Bank', domain: 'berhanbanksc.com' },
      { name: 'Hibret Bank', domain: 'hibretbank.com.et' },
      { name: 'Zemen Bank', domain: 'zemenbank.com' },
    ],
    US: [
      { name: 'Chase Bank', domain: 'chase.com' },
      { name: 'Bank of America', domain: 'bankofamerica.com' },
      { name: 'Wells Fargo', domain: 'wellsfargo.com' },
      { name: 'Citi', domain: 'citi.com' },
      { name: 'PNC Bank', domain: 'pnc.com' },
    ],
  };

  const getLogoQueryUrl = (text: string) => {
    const abbreviations: Record<string, string> = {
      'boa': 'Bank of America',
      'citi': 'Citigroup',
      'rbc': 'Royal Bank of Canada',
      'td': 'TD Bank',
      'jpm': 'JPMorgan Chase',
      'wf': 'Wells Fargo',
      'pnc': 'PNC Financial Services',
    };
    const query = abbreviations[text.toLowerCase()] || text;
    return `https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(query)}`;
  };

  useEffect(() => {
    BankService.getAllBanks().then(setBanks);
  }, [showAddModal]);

  // Helper to resolve logo source: checks if the logo URL string matches a bundled bank
  const getAccountImageSource = (logoUrl: string | null | undefined) => {
    if (!logoUrl) return undefined;

    // Check if it matches a bundled bank URL
    const bundled = BUNDLED_LOGOS.find(b => b.url === logoUrl);
    if (bundled && bundled.src) {
      if (typeof bundled.src === 'number') return bundled.src;
      if (typeof bundled.src === 'string') return { uri: bundled.src };
      if (typeof bundled.src === 'object') {
        if (bundled.src.uri) return bundled.src;
        if (bundled.src.default) return { uri: bundled.src.default };
        return bundled.src;
      }
    }

    return { uri: logoUrl };
  };

  const searchLogos = async (text: string) => {
    setAccountName(text);
    if (text.length < 1) {
      setSuggestions([]);
      setImageSuggestions([]);
      return;
    }

    // 1. Search in our Bank Management System (Bundled + Custom)
    const lowerQuery = text.toLowerCase();
    const bankMatches = banks.filter(b =>
      b.name.toLowerCase().includes(lowerQuery) ||
      (b.country && b.country.toLowerCase().includes(lowerQuery))
    );

    const bankSuggestions = bankMatches.map(b => ({
      name: b.name,
      domain: b.website || b.country || 'Bank',
      logo: b.logo, // This is the URL string
      isBank: true,
      data: b
    }));

    // 2. Existing Online/Local Logic
    let localBanks: Array<{ name: string; domain: string }> = [];

    try {
      const url = getLogoQueryUrl(text);
      const res = await fetch(url);
      const data = await res.json();

      // Get user-uploaded local logos
      const userLocalSuggestions = Object.keys(localLogos)
        .filter(name => name.toLowerCase().includes(text.toLowerCase()))
        .map(name => ({ name, domain: name.toLowerCase().replace(/\s+/g, ''), logo: localLogos[name] }));

      // Location-aware boosting
      localBanks = (popularBanks[userCountry] || []).filter(b => b.name.toLowerCase().includes(text.toLowerCase()));
      const popularLocalSuggestions = localBanks.map(b => ({ name: b.name, domain: b.domain, logo: localLogos[b.name] }));

      const allLocalSuggestions = [...userLocalSuggestions, ...popularLocalSuggestions];
      const mergedSource = preferLocalLogos ? [...allLocalSuggestions, ...data] : [...data, ...allLocalSuggestions];

      const merged = mergedSource.reduce((acc: any[], cur: any) => {
        const key = (cur.domain || cur.name).toLowerCase();
        if (!acc.some(x => (x.domain || x.name).toLowerCase() === key)) acc.push(cur);
        return acc;
      }, []);

      const onlineHandler = merged.filter((m: any) => !bankSuggestions.some(b => b.name === m.name));

      setSuggestions([...bankSuggestions, ...onlineHandler].slice(0, 10));
    } catch (err) {
      console.error('Logo fetch error:', err);
      // Fallback to just banks
      setSuggestions(bankSuggestions);
    }

    // DuckDuckGo logic
    try {
      setImageLoading(true);
      const q = encodeURIComponent(`${text} bank logo`);
      const resp = await fetch(`https://api.duckduckgo.com/?q=${q}&format=json&no_html=1&skip_disambig=1`);
      const ddg = await resp.json();
      const topics: any[] = ddg?.RelatedTopics || [];
      const imgs: string[] = [];

      if (preferLocalLogos) {
        Object.keys(localLogos).forEach(name => {
          if (name.toLowerCase().includes(text.toLowerCase())) {
            imgs.push(localLogos[name]);
          }
        });
        for (const b of localBanks) {
          const local = localLogos[b.name];
          if (local && !imgs.includes(local)) {
            imgs.push(local);
          }
          if (imgs.length >= 8) break;
        }
      }

      for (const t of topics) {
        const iconUrl = t?.Icon?.URL;
        if (iconUrl && typeof iconUrl === 'string' && iconUrl.length > 0) {
          imgs.push(iconUrl.startsWith('http') ? iconUrl : `https://duckduckgo.com${iconUrl}`);
        }
        if (imgs.length >= 8) break;
      }

      if (imgs.length < 8) {
        try {
          const wq = encodeURIComponent(`${text} logo`);
          const wResp = await fetch(
            `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${wq}&gsrlimit=10&prop=imageinfo&iiprop=url&origin=*`
          );
          const wJson = await wResp.json();
          const pages = wJson?.query?.pages || {};
          const commons: string[] = Object.values(pages)
            .map((p: any) => p?.imageinfo?.[0]?.url)
            .filter((u: any) => typeof u === 'string');
          for (const u of commons) {
            imgs.push(u);
            if (imgs.length >= 8) break;
          }
        } catch (e) {
          console.log('Wikimedia fetch failed', e);
        }
      }
      setImageSuggestions(imgs);
      setImageLoading(false);
    } catch (err) {
      console.error('Image suggestions error:', err);
      setImageSuggestions([]);
      setImageLoading(false);
    }
  };

  const selectSuggestion = async (s: any) => {
    // 1. Bank Choice
    if (s.isBank && s.data) {
      const bank: Bank = s.data;
      setAccountName(bank.name);
      setAccountLogo(bank.logo || null);
      setAccountType('BANK');
      setSuggestions([]);
      Keyboard.dismiss();
      return;
    }

    // 2. Clearbit/Manual Choice
    setAccountName(s.name);
    if (preferLocalLogos && s && s.name) {
      const local = localLogos[s.name];
      if (local) {
        setAccountLogo(local);
        setSuggestions([]);
        Keyboard.dismiss();
        return;
      }
    }

    if (imageSuggestions && imageSuggestions.length > 0) {
      setAccountLogo(imageSuggestions[0]);
    } else {
      try {
        await searchLogos(s.name);
        if (imageSuggestions && imageSuggestions.length > 0) {
          setAccountLogo(imageSuggestions[0]);
        } else if (s.logo) {
          setAccountLogo(s.logo);
        }
      } catch (e) {
        setAccountLogo(s.logo || null);
      }
    }

    setSuggestions([]);
    Keyboard.dismiss();
  };

  useEffect(() => {
    // @ts-ignore
    dispatch(fetchAccounts());
  }, [dispatch]);

  // Load local logos and subscribe to changes
  useEffect(() => {
    let unsub: (() => void) | null = null;
    const load = async () => {
      try {
        const map = await LocalAssetService.getAllLogos();
        setLocalLogos(map || {});
      } catch (e) {
        console.error('Failed to load local logos', e);
      }
    };
    load();
    unsub = LocalChangeEmitter.subscribe(() => { load(); });
    return () => { if (unsub) unsub(); };
  }, []);

  const resetForm = () => {
    setAccountName('');
    setInitialBalance('');
    setAccountType('CASH');
    setEditingId(null);
    setAccountNumber('');
    setSmsNumber('');
    setAccountLogo(null);
    setSuggestions([]);
  };

  const handleEdit = (account: Account) => {
    setEditingId(account.id);
    setAccountName(account.name);
    setAccountType(account.type);
    setInitialBalance(account.balance.toString());
    setAccountNumber((account as any).account_number || '');
    setSmsNumber((account as any).sms_number || '');
    setAccountLogo((account as any).logo || null);
    setShowAddModal(true);
  };

  const handleDelete = (id: string, balance: number) => {
    const doDelete = async () => {
      try {
        // @ts-ignore
        await dispatch(deleteAccount(id));
        Platform.OS === 'web' ? window.alert('Account deleted') : Alert.alert('Success', 'Account deleted');
      } catch (e) {
        console.error(e);
        Platform.OS === 'web' ? window.alert('Failed to delete') : Alert.alert('Error', 'Failed to delete');
      }
    };

    if (Platform.OS === 'web') {
      if (confirm(`Delete this account? Remaining balance ($${balance}) will be recorded as an expense.`)) {
        doDelete();
      }
    } else {
      Alert.alert(
        'Delete Account',
        `Are you sure? Remaining balance ($${balance}) will be recorded as an expense.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: doDelete }
        ]
      );
    }
  };

  const handleSaveAccount = async () => {
    if (!accountName.trim()) {
      Platform.OS === 'web' ? window.alert('Please enter account name') : Alert.alert('Error', 'Please enter account name');
      return;
    }

    const balance = parseFloat(initialBalance);
    if (isNaN(balance)) {
      Platform.OS === 'web' ? window.alert('Please enter valid balance') : Alert.alert('Error', 'Please enter valid balance');
      return;
    }

    // Auto-fetch logo if not selected
    let finalLogo = accountLogo;
    if (!finalLogo && accountName.length > 2) {
      // If user prefers local logos, try to resolve from user-uploaded assets first
      if (preferLocalLogos) {
        // Check user-uploaded logos
        const userMatchKey = Object.keys(localLogos).find(k => accountName.toLowerCase().includes(k.toLowerCase()));
        if (userMatchKey) {
          finalLogo = localLogos[userMatchKey];
        } else {
          // Check hardcoded popular banks
          const localMatch = (popularBanks[userCountry] || []).find(b => accountName.toLowerCase().includes(b.name.toLowerCase()));
          if (localMatch && localLogos[localMatch.name]) finalLogo = localLogos[localMatch.name];
        }
      }

      if (!finalLogo) {
        try {
          const url = getLogoQueryUrl(accountName);
          const res = await fetch(url);
          const data = await res.json();
          if (data && data.length > 0) {
            const d0 = data[0];
            const domain = d0?.domain;
            const fallback = d0?.logo;
            finalLogo = domain ? `https://icons.duckduckgo.com/ip3/${domain}.ico` : fallback;
          }
        } catch (e) {
          console.log('Auto-fetch logo failed', e);
        }
      }
    }

    // Resolve duplicate naming rules
    const makeDisplayName = (baseName: string, accNumber?: string | undefined, excludeId?: string | null) => {
      const sameName = accounts.filter(a => a.name.trim().toLowerCase() === baseName.trim().toLowerCase() && a.id !== excludeId);
      if (sameName.length === 0) return baseName.trim();
      const last4 = (accNumber || '').replace(/\D/g, '').slice(-4);
      if (last4) return `${baseName.trim()} (${last4})`;
      // Append roman numerals II, III, IV... for duplicates without account number
      const numerals = ['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
      const idx = Math.min(sameName.length - 0, numerals.length - 1);
      return `${baseName.trim()} ${numerals[idx] || 'II'}`;
    };

    try {
      if (editingId) {
        // Update
        const existing = accounts.find(a => a.id === editingId);
        if (existing) {
          const newName = makeDisplayName(accountName, accountNumber || undefined, editingId);
          // @ts-ignore
          await dispatch(updateAccount({
            ...existing,
            name: newName,
            type: accountType,
            balance: balance, // New balance
            account_number: accountNumber || undefined,
            sms_number: smsNumber || undefined,
            logo: finalLogo || undefined,
          }));
          Platform.OS === 'web' ? window.alert('Account updated') : Alert.alert('Success', 'Account updated');
        }
      } else {
        // Create
        const newName = makeDisplayName(accountName, accountNumber || undefined, null);
        // @ts-ignore
        await dispatch(addAccount({
          name: newName,
          type: accountType,
          balance: balance,
          currency: 'USD',
          is_locked: false,
          locked_amount: 0,
          account_number: accountNumber || undefined,
          sms_number: smsNumber || undefined,
          logo: finalLogo || undefined,
        }));
        Platform.OS === 'web' ? window.alert('Account created') : Alert.alert('Success', 'Account created');
      }

      setShowAddModal(false);
      resetForm();
    } catch (error) {
      Platform.OS === 'web' ? window.alert('Failed to save account') : Alert.alert('Error', 'Failed to save account');
      console.error(error);
    }
  };

  const fetchSmsNumbers = async () => {
    if (Platform.OS !== 'android') {
      Platform.OS === 'web' ? window.alert('SMS reading is only available on Android builds.') : Alert.alert('Info', 'SMS reading is only available on Android builds.');
      return;
    }

    setLoadingSms(true);
    try {
      // Request permission
      const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_SMS, {
        title: 'SMS Access',
        message: 'This app needs access to SMS messages to detect bank numbers for auto-parsing.',
        buttonPositive: 'Allow',
        buttonNegative: 'Deny',
      });

      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        Alert.alert('Permission Denied', 'Cannot read SMS without permission.');
        setLoadingSms(false);
        return;
      }

      // Lazy import our SMS helper service
      const { getSmsNumbers } = await import('@/services/sms');
      const numbers = await getSmsNumbers();
      setFetchedSmsNumbers(numbers);
      setShowSmsList(true);
      setLoadingSms(false);
    } catch (err) {
      console.error('Error fetching SMS numbers', err);
      setLoadingSms(false);
      Alert.alert('Error', 'Failed to read SMS');
    }
  };

  const getTotalBalance = () => {
    return accounts.reduce((sum, account) => sum + account.balance, 0);
  };

  const getAccountIcon = (type: string) => {
    switch (type) {
      case 'CASH': return 'money';
      case 'BANK': return 'bank';
      case 'CARD': return 'credit-card';
      case 'SAVINGS': return 'piggy-bank';
      default: return 'wallet';
    }
  };

  const getAccountColor = (type: string) => {
    switch (type) {
      case 'CASH': return '#10b981';
      case 'BANK': return '#3b82f6';
      case 'CARD': return '#f59e0b';
      case 'SAVINGS': return '#8b5cf6';
      default: return '#64748b';
    }
  };

  const accountTypes: Array<{ value: AccountType; label: string }> = [
    { value: 'CASH', label: 'Cash' },
    { value: 'BANK', label: 'Bank Account' },
    { value: 'CARD', label: 'Credit/Debit Card' },
    { value: 'SAVINGS', label: 'Savings' },
    { value: 'MOBILE_MONEY', label: 'Mobile Money' },
  ];

  return (
    <View className="flex-1 bg-slate-50 dark:bg-background-dark">
      <StatusBar style="auto" />

      {/* Header */}
      <LinearGradient colors={['#059669', '#047857']} className="px-6 pt-6 pb-8 rounded-b-[32px]" style={{ elevation: 4 }}>
        <View className="flex-row justify-between items-center mb-6">
          <TouchableOpacity onPress={() => router.back()} className="w-10 h-10 bg-white/20 rounded-xl justify-center items-center">
            <FontAwesome name="arrow-left" size={18} color="#fff" />
          </TouchableOpacity>
          <Text className="text-white text-xl font-bold">Accounts</Text>
          <TouchableOpacity
            onPress={() => { resetForm(); setShowAddModal(true); }}
            className="w-10 h-10 bg-white/20 rounded-xl justify-center items-center"
          >
            <FontAwesome name="plus" size={18} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Total Balance */}
        <View className="bg-white/10 backdrop-blur-lg rounded-3xl p-6">
          <Text className="text-white/80 text-sm mb-2">Total Balance</Text>
          <Text className="text-white text-4xl font-bold">{formatCurrency(getTotalBalance())}</Text>
          <Text className="text-white/60 text-xs mt-2">{accounts.length} Accounts</Text>
        </View>
      </LinearGradient>

      <ScrollView className="flex-1 px-6 -mt-6" showsVerticalScrollIndicator={false}>
        {/* Accounts List */}
        {accounts.length === 0 ? (
          <View className="bg-white dark:bg-slate-800 rounded-3xl p-8 items-center shadow-lg border border-slate-100 dark:border-slate-700" style={{ elevation: 4 }}>
            <FontAwesome name="credit-card" size={48} color="#cbd5e1" />
            <Text className="text-slate-400 text-center mt-4 mb-2">No accounts yet</Text>
            <Text className="text-slate-500 text-center text-sm mb-6">
              Create your first account to start tracking your finances
            </Text>
            <TouchableOpacity
              onPress={() => { resetForm(); setShowAddModal(true); }}
              className="bg-emerald-500 px-6 py-3 rounded-xl"
            >
              <Text className="text-white font-bold">Add Account</Text>
            </TouchableOpacity>
          </View>
        ) : (
          accounts.map((account) => (
            <View key={account.id} className="mb-4">
              <TouchableOpacity
                onPress={() => router.push(`/account/${account.id}`)}
                className="bg-white dark:bg-slate-800 rounded-3xl p-6 shadow-lg border border-slate-100 dark:border-slate-700"
                style={{ elevation: 4 }}
              >
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center flex-1">
                    <View
                      className="w-14 h-14 rounded-2xl justify-center items-center mr-4 overflow-hidden"
                      style={{ backgroundColor: (account as any).logo ? '#fff' : getAccountColor(account.type) + '20' }}
                    >
                      {(account as any).logo ? (
                        <Image
                          source={getAccountImageSource((account as any).logo) as any}
                          style={{ width: 40, height: 40 }}
                          resizeMode="contain"
                        />
                      ) : (
                        <FontAwesome
                          name={getAccountIcon(account.type) as any}
                          size={24}
                          color={getAccountColor(account.type)}
                        />
                      )}
                    </View>

                    <View className="flex-1 mr-2">
                      <Text className="text-slate-900 dark:text-white font-bold text-lg" numberOfLines={1}>
                        {account.name}
                      </Text>
                      <Text className="text-slate-500 text-sm">{account.type}</Text>
                      {account.account_number ? (
                        <Text className="text-slate-400 text-xs mt-1">Acct: {(account as any).account_number}</Text>
                      ) : null}
                      {account.sms_number ? (
                        <Text className="text-slate-400 text-xs">SMS: {(account as any).sms_number}</Text>
                      ) : null}
                    </View>
                  </View>

                  <View className="items-end">
                    <View className="flex-row gap-2 mb-1">
                      <TouchableOpacity onPress={() => handleEdit(account)} className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                        <FontAwesome name="pencil" size={12} color="#3b82f6" />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => handleDelete(account.id, account.balance)} className="p-2 bg-red-50 dark:bg-red-900/20 rounded-lg">
                        <FontAwesome name="trash" size={12} color="#ef4444" />
                      </TouchableOpacity>
                    </View>
                    <Text className="text-slate-900 dark:text-white font-bold text-xl">{formatCurrency(account.balance)}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            </View>
          ))
        )}

        <View className="h-8" />
      </ScrollView>

      {/* Add/Edit Account Modal */}
      {showAddModal && (
        <View className="absolute inset-0 bg-black/50 justify-center items-center px-6">
          <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 w-full max-w-md shadow-2xl">
            <ScrollView style={{ maxHeight: 600 }} contentContainerStyle={{ paddingBottom: 16 }} showsVerticalScrollIndicator={true}>
              <View className="flex-row justify-between items-center mb-6">
                <Text className="text-slate-900 dark:text-white text-xl font-bold">
                  {editingId ? 'Edit Account' : 'New Account'}
                </Text>
                <TouchableOpacity onPress={() => setShowAddModal(false)}>
                  <FontAwesome name="times" size={24} color="#64748b" />
                </TouchableOpacity>
              </View>

              {/* Selected Bank Logo Preview */}
              {accountLogo ? (
                <View className="items-center mb-4">
                  <View className="w-16 h-16 rounded-2xl bg-white shadow justify-center items-center" style={{ elevation: 2 }}>
                    <Image source={getAccountImageSource(accountLogo) as any} className="w-14 h-14" resizeMode="contain" />
                  </View>
                  <Text className="text-slate-500 text-xs mt-2">Selected bank logo</Text>
                </View>
              ) : null}

              {/* Account Name */}
              <View className="mb-4" style={{ zIndex: 100, elevation: 10 }}>
                <Text className="text-slate-500 text-sm font-bold mb-2">Account Name</Text>
                <View className="flex-row items-center bg-slate-50 dark:bg-slate-900 rounded-xl overflow-hidden p-1">
                  {accountLogo && (
                    <View className="w-10 h-10 ml-2 rounded-lg bg-white justify-center items-center overflow-hidden">
                      <Image
                        source={getAccountImageSource(accountLogo) as any}
                        style={{ width: 32, height: 32 }}
                        resizeMode="contain"
                      />
                    </View>
                  )}
                  <TextInput
                    className="flex-1 text-slate-900 dark:text-white p-3 text-base"
                    placeholder="e.g. Chase Bank"
                    placeholderTextColor="#94a3b8"
                    value={accountName}
                    onChangeText={searchLogos}
                  />
                  {accountLogo && (
                    <TouchableOpacity onPress={() => setAccountLogo(null)} className="p-2">
                      <FontAwesome name="times-circle" size={16} color="#94a3b8" />
                    </TouchableOpacity>
                  )}
                </View>

                {/* Suggestions Dropdown with logos */}
                {suggestions.length > 0 && (
                  <View
                    className="absolute top-[80px] left-0 right-0 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-100 dark:border-slate-700 max-h-40"
                    style={{ zIndex: 200, elevation: 20 }}
                  >
                    <ScrollView keyboardShouldPersistTaps="always">
                      {suggestions.map((s, i) => (
                        <TouchableOpacity
                          key={i}
                          onPress={() => selectSuggestion(s)}
                          className="flex-row items-center p-3 border-b border-slate-50 dark:border-slate-700 last:border-0"
                        >
                          <View className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-700 mr-3 justify-center items-center overflow-hidden">
                            {s.logo ? (
                              <Image
                                source={getAccountImageSource(s.logo)}
                                style={{ width: 24, height: 24 }}
                                resizeMode="contain"
                              />
                            ) : (
                              <FontAwesome name="bank" size={14} color="#94a3b8" />
                            )}
                          </View>
                          <View>
                            <Text className="text-slate-900 dark:text-white font-medium">{s.name}</Text>
                            <Text className="text-slate-400 text-xs">{s.domain}</Text>
                          </View>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}

                {/* Image Suggestions Grid (high-res only) */}
                <View className="mt-3">
                  <Text className="text-slate-500 text-xs mb-2">Image suggestions</Text>
                  {imageLoading ? (
                    <View className="h-24 justify-center items-center">
                      <ActivityIndicator size="small" color="#059669" />
                    </View>
                  ) : imageSuggestions.length === 0 ? (
                    <Text className="text-slate-400 text-xs">No image suggestions yet</Text>
                  ) : (
                    <View className="flex-row flex-wrap -mr-2">
                      {imageSuggestions.map((url, idx) => {
                        // Pair name labels where possible
                        const label = suggestions && suggestions[idx] ? suggestions[idx].name : accountName || '';
                        return (
                          <TouchableOpacity key={idx} onPress={() => { setAccountLogo(url); }} className="w-1/3 pr-2 mb-3">
                            <View className="rounded-lg overflow-hidden bg-white" style={{ height: 80 }}>
                              <Image source={{ uri: url }} className="w-full h-full" resizeMode="cover" />
                            </View>
                            {label ? <Text className="text-slate-700 text-xs mt-1" numberOfLines={1}>{label}</Text> : null}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                </View>
              </View>

              {/* Account Type */}
              <View className="mb-4">
                <Text className="text-slate-500 text-sm font-bold mb-2">Account Type</Text>
                <View className="flex-row flex-wrap gap-2">
                  {accountTypes.map((type) => (
                    <TouchableOpacity
                      key={type.value}
                      onPress={() => setAccountType(type.value)}
                      className={`px-4 py-3 rounded-xl border-2 ${accountType === type.value
                        ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-500'
                        : 'bg-slate-50 dark:bg-slate-900 border-transparent'
                        }`}
                    >
                      <Text
                        className={`font-semibold ${accountType === type.value
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-slate-600 dark:text-slate-400'
                          }`}
                      >
                        {type.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Initial Balance */}
              <View className="mb-6">
                <Text className="text-slate-500 text-sm font-bold mb-2">
                  {editingId ? 'Current Balance' : 'Initial Balance'}
                </Text>
                <TextInput
                  className="bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white p-4 rounded-xl text-base"
                  placeholder="0.00"
                  placeholderTextColor="#94a3b8"
                  keyboardType="decimal-pad"
                  value={initialBalance}
                  onChangeText={setInitialBalance}
                />
              </View>

              {/* Account Number */}
              <View className="mb-4">
                <Text className="text-slate-500 text-sm font-bold mb-2">Account Number (optional)</Text>
                <TextInput
                  className="bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white p-4 rounded-xl text-base"
                  placeholder="e.g. 0123456789"
                  placeholderTextColor="#94a3b8"
                  value={accountNumber}
                  onChangeText={setAccountNumber}
                  keyboardType="default"
                />
              </View>

              {/* SMS Number */}
              <View className="mb-6">
                <Text className="text-slate-500 text-sm font-bold mb-2">SMS Number (optional)</Text>
                <View className="flex-row items-center">
                  <TextInput
                    className="flex-1 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white p-4 rounded-xl text-base"
                    placeholder="e.g. +1234567890"
                    placeholderTextColor="#94a3b8"
                    value={smsNumber}
                    onChangeText={(v) => { setSmsNumber(v); setShowSmsList(false); }}
                    keyboardType="phone-pad"
                  />
                  <TouchableOpacity onPress={fetchSmsNumbers} className="ml-3 px-3 py-3 bg-slate-100 dark:bg-slate-700 rounded-xl">
                    <Text className="text-slate-700 dark:text-slate-200 text-sm">{loadingSms ? 'Loading...' : 'Fetch'}</Text>
                  </TouchableOpacity>
                </View>

                {showSmsList && fetchedSmsNumbers.length > 0 && (
                  <View className="mt-3 flex-row flex-wrap">
                    {fetchedSmsNumbers.map((num) => (
                      <TouchableOpacity key={num} onPress={() => { setSmsNumber(num); setShowSmsList(false); }} className="mr-2 mb-2 px-3 py-2 bg-slate-100 dark:bg-slate-700 rounded-full">
                        <Text className="text-slate-700 dark:text-slate-200 text-sm">{num}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
                <Text className="text-xs text-slate-500 dark:text-slate-400 mt-2">Android only — Fetch will request SMS permission; you can also type the number manually.</Text>
              </View>

              {/* Buttons */}
              <View className="flex-row gap-3">
                <TouchableOpacity
                  onPress={() => setShowAddModal(false)}
                  className="flex-1 bg-slate-100 dark:bg-slate-700 h-12 rounded-xl justify-center items-center"
                >
                  <Text className="text-slate-700 dark:text-slate-300 font-bold">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleSaveAccount}
                  className="flex-1 bg-emerald-500 h-12 rounded-xl justify-center items-center"
                >
                  <Text className="text-white font-bold">
                    {editingId ? 'Save Changes' : 'Create'}
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      )}
    </View>
  );
}
