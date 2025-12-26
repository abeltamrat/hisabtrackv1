import { BUNDLED_LOGOS } from '@/assets/bankLogos/et';
import { useAppSettings } from '@/contexts/AppSettingsContext';
import { DraftTransactionService } from '@/services/DraftTransactionService';
import { SMSSyncService } from '@/services/SMSSyncService';
import { AppDispatch, RootState } from '@/store';
import { deleteAccount, fetchAccounts } from '@/store/slices/accountsSlice';
import { fetchTransactions } from '@/store/slices/transactionsSlice';
import { FontAwesome } from '@expo/vector-icons';
import * as Router from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, ImageBackground, Platform, RefreshControl, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { BlurView } from 'expo-blur';

import { useDispatch, useSelector } from 'react-redux';

export default function AccountDetail() {
  // Support multiple expo-router versions: prefer useLocalSearchParams, fall back to useSearchParams
  const useParamsHook = (Router as any).useLocalSearchParams ?? (Router as any).useSearchParams ?? (() => ({}));
  const { id } = useParamsHook() as { id?: string };
  const router = (Router as any).useRouter ? (Router as any).useRouter() : (Router as any).useNavigation?.() ?? ({} as any);
  const dispatch = useDispatch<AppDispatch>();
  const accountsState = useSelector((s: RootState) => s.accounts);
  const account = accountsState.items.find(a => a.id === id);
  const { formatCurrency } = useAppSettings();

  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [smsCount, setSmsCount] = useState<number | null>(null);
  const [lastSmsSync, setLastSmsSync] = useState<number | null>(null);
  const [listeningNumber, setListeningNumber] = useState<string | null>(null);
  const [unrecordedDrafts, setUnrecordedDrafts] = useState<number>(0);

  const load = useCallback(async (showLoading = true) => {
    if (!id) return;
    try {
      if (showLoading) setLoading(true);
      // dispatch typings can be complex for createAsyncThunk results — coerce safely
      // @ts-ignore
      const res = await (dispatch as any)(fetchTransactions({ account_id: id }));
      const payload = Array.isArray(res?.payload) ? res.payload : [];
      setTransactions(payload as any[]);
    } catch (e) {
      console.error('Failed to fetch transactions', e);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [dispatch, id]);

  useEffect(() => {
    load(true);
  }, [load]);

  useEffect(() => {
    // Load SMS sync metadata (counts, last sync) for this account
    const loadSmsStatus = async () => {
      if (!account) return;
      setListeningNumber(account.sms_number || null);

      if (Platform.OS === 'web') {
        // On web we don't run background SMS sync; indicate unsupported
        setSmsCount(null);
        setLastSmsSync(null);
        setUnrecordedDrafts(await DraftTransactionService.getUnrecordedCount(account.id));
        return;
      }

      try {
        if (account.sms_number) {
          const messages = await SMSSyncService.readSMSFromSender(account.sms_number);
          setSmsCount(messages.length);
        } else {
          setSmsCount(0);
        }

        const drafts = await DraftTransactionService.getByAccount(account.id);
        // Prefer persisted last successful sync timestamp when available
        const persisted = await SMSSyncService.getLastSuccessfulSync(account.id);
        if (persisted) {
          setLastSmsSync(persisted);
        } else if (drafts && drafts.length) {
          const latest = drafts.reduce((max, d) => Math.max(max, d.created_at), 0);
          setLastSmsSync(latest || null);
        } else {
          setLastSmsSync(null);
        }

        const unrec = await DraftTransactionService.getUnrecordedCount(account.id);
        setUnrecordedDrafts(unrec || 0);
      } catch (e) {
        console.error('Failed to load SMS status', e);
      }
    };

    loadSmsStatus();
  }, [account]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load(false);
    setRefreshing(false);
  }, [load]);

  const handleDeleteAccount = async () => {
    if (!id) return;
    try {
      // @ts-ignore
      await dispatch(deleteAccount(id));
      // refresh accounts list
      // @ts-ignore
      await dispatch(fetchAccounts());
      router.back();
    } catch (e) {
      console.error('Failed to delete account', e);
    }
  };

  // Helper to resolve logo source
  const getAccountImageSource = (logoUrl: string | null | undefined) => {
    if (!logoUrl) return undefined;
    const bundled = BUNDLED_LOGOS.find(b => b.url === logoUrl);
    if (bundled && bundled.src) {
      if (typeof bundled.src === 'number') return bundled.src;
      if (typeof bundled.src === 'string') return { uri: bundled.src };
      if (typeof bundled.src === 'object') {
        // @ts-ignore
        if (bundled.src.uri) return bundled.src;
        // @ts-ignore
        if (bundled.src.default) return { uri: bundled.src.default };
        return bundled.src;
      }
    }
    return { uri: logoUrl };
  };

  if (!account) {
    return (
      <View className="flex-1 bg-slate-50 dark:bg-background-dark">
        <StatusBar style="auto" />
        <View className="p-6">
          <Text className="text-slate-500">Account not found</Text>
        </View>
        {/* SMS Sync Status */}
        <View className="mb-4">
          <View className="bg-white dark:bg-slate-800 rounded-2xl p-3 shadow-sm border border-slate-100 dark:border-slate-700">
            {Platform.OS === 'web' ? (
              <Text className="text-slate-500 text-xs">SMS sync not supported on web</Text>
            ) : (
              <View>
                <Text className="text-slate-500 text-xs">SMS messages available: <Text className="font-medium text-slate-900">{smsCount !== null ? smsCount : '—'}</Text></Text>
                <Text className="text-slate-500 text-xs mt-1">Unrecorded drafts: <Text className="font-medium text-slate-900">{unrecordedDrafts}</Text></Text>
                <Text className="text-slate-500 text-xs mt-1">Last SMS sync: <Text className="font-medium text-slate-900">{lastSmsSync ? new Date(lastSmsSync).toLocaleString() : 'Never'}</Text></Text>
                <Text className="text-slate-500 text-xs mt-1">Listening: <Text className="font-medium text-slate-900">{listeningNumber || 'Not configured'}</Text></Text>
              </View>
            )}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-slate-50 dark:bg-background-dark">
      <StatusBar style="auto" />
      <View className="px-6 pt-6 pb-4 flex-row justify-between items-center">
        <TouchableOpacity onPress={() => router.back()} className="w-10 h-10 bg-white/20 rounded-xl justify-center items-center">
          <FontAwesome name="arrow-left" size={18} color="#000" />
        </TouchableOpacity>
        <Text className="font-bold text-lg">{account.name}</Text>
        <TouchableOpacity onPress={handleDeleteAccount} className="w-10 h-10 bg-red-50 rounded-xl justify-center items-center">
          <FontAwesome name="trash" size={18} color="#ef4444" />
        </TouchableOpacity>
      </View>

      <ScrollView
        className="flex-1"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Blurred Logo Background */}
        {(account as any).logo && (
          <View className="absolute top-0 left-0 right-0" style={{ height: 300, overflow: 'hidden' }}>
            <ImageBackground
              source={getAccountImageSource((account as any).logo) as any}
              style={{ width: '100%', height: '100%', opacity: 0.3 }}
              resizeMode="cover"
            >
              <BlurView intensity={80} tint="light" style={{ flex: 1 }} />
            </ImageBackground>
          </View>
        )}

        <View className="px-6">
          <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-4 shadow-lg border border-slate-100 dark:border-slate-700" style={{ elevation: 4 }}>
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center flex-1">
                <View className="w-14 h-14 rounded-2xl justify-center items-center mr-4 overflow-hidden" style={{ backgroundColor: (account as any).logo ? '#fff' : '#64748b20' }}>
                  {(account as any).logo ? (
                    <Image source={getAccountImageSource((account as any).logo) as any} className="w-full h-full" resizeMode="contain" />
                  ) : (
                    <FontAwesome name="bank" size={24} color="#3b82f6" />
                  )}
                </View>
                <View className="flex-1 mr-2">
                  <Text className="text-slate-900 dark:text-white font-bold text-lg" numberOfLines={1}>{account.name}</Text>
                  <Text className="text-slate-500 text-sm">{account.type}</Text>
                  {account.account_number ? <Text className="text-slate-400 text-xs mt-1">Acct: {(account as any).account_number}</Text> : null}
                </View>
              </View>
              <View className="items-end">
                <Text className="text-slate-900 dark:text-white font-bold text-xl">{formatCurrency(account.balance)}</Text>
              </View>
            </View>
          </View>

          <View className="mb-4">
            <Text className="text-slate-500 text-sm mb-2">Transactions</Text>
            {loading ? (
              <View className="h-24 justify-center items-center">
                <ActivityIndicator size="small" color="#059669" />
              </View>
            ) : transactions.length === 0 ? (
              <View className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-700">
                <Text className="text-slate-400 text-sm">No transactions for this account</Text>
              </View>
            ) : (
              <View className="bg-white dark:bg-slate-900 rounded-2xl p-2 border border-slate-100 dark:border-slate-700">
                {transactions.map((tx) => (
                  <TouchableOpacity
                    key={tx.id}
                    activeOpacity={0.8}
                    onPress={() => router.push(`/transaction/${tx.id}`)}
                    className="flex-row justify-between items-center py-3 px-2 border-b border-slate-100 last:border-0"
                  >
                    <View>
                      <Text className="text-slate-900 dark:text-white font-medium">{tx.description || tx.category || 'Transaction'}</Text>
                      <Text className="text-slate-400 text-xs">{new Date(tx.date).toLocaleString()}</Text>
                    </View>
                    <View className="items-end">
                      <Text className={`font-bold ${tx.type === 'INCOME' ? 'text-emerald-600' : 'text-red-500'}`}>{tx.type === 'INCOME' ? '+' : '-'}{formatCurrency(Number(tx.amount))}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        </View>

        <View style={{ height: 48 }} />
      </ScrollView>
    </View>
  );
}

export const options = {
  headerShown: false,
};
