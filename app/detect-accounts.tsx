import CoinLoader from '@/components/CoinLoader';
import { BUNDLED_LOGOS } from '@/assets/bankLogos/et';
import { useAppSettings } from '@/contexts/AppSettingsContext';
import { AppDispatch, RootState } from '@/store';
import { addAccount } from '@/store/slices/accountsSlice';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from '@/components/aurora/AuroraGradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Alert } from '@/utils/alert';
import { useDispatch, useSelector } from 'react-redux';
import type { DetectedAccountCandidate } from '@/utils/smsAccountDetection';

type ScanState = { status: 'idle' } | { status: 'permission' } | { status: 'scanning' } | { status: 'done' } | { status: 'error'; message: string };

export default function DetectAccountsScreen() {
  const router = useRouter();
  const dispatch = useDispatch<AppDispatch>();
  const accounts = useSelector((state: RootState) => state.accounts.items);
  const { currency, formatCurrency } = useAppSettings();

  const [scan, setScan] = useState<ScanState>({ status: 'idle' });
  const [candidates, setCandidates] = useState<DetectedAccountCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [names, setNames] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);

  const logoFor = useCallback((bankName: string | null) => {
    if (!bankName) return null;
    return BUNDLED_LOGOS.find(l => l.name === bankName) ?? null;
  }, []);

  const suggestedName = useCallback((candidate: DetectedAccountCandidate, allForSender: DetectedAccountCandidate[]) => {
    const base = candidate.bankName ?? candidate.sender;
    return allForSender.length > 1 ? `${base} ••${candidate.accountTail}` : base;
  }, []);

  const runScan = useCallback(async (requestPermission: boolean) => {
    if (Platform.OS !== 'android') { setScan({ status: 'error', message: 'SMS scanning is only available on Android.' }); return; }
    setScan({ status: 'scanning' });
    try {
      const { SMSSyncService } = await import('@/services/SMSSyncService');
      let allowed = await SMSSyncService.hasInboxReadPermission();
      if (!allowed && requestPermission) {
        await SMSSyncService.requestPermissions();
        allowed = await SMSSyncService.hasInboxReadPermission();
      }
      if (!allowed) { setScan({ status: 'permission' }); return; }

      const found = await SMSSyncService.detectAccounts(accounts.map(a => ({ sms_number: a.sms_number, account_number: a.account_number })));
      setCandidates(found);
      const bySender = new Map<string, DetectedAccountCandidate[]>();
      for (const c of found) bySender.set(c.sender, [...(bySender.get(c.sender) ?? []), c]);
      const initialNames: Record<string, string> = {};
      const initialSelected = new Set<string>();
      for (const c of found) {
        initialNames[c.key] = suggestedName(c, bySender.get(c.sender) ?? [c]);
        if (!c.alreadyLinked) initialSelected.add(c.key);
      }
      setNames(initialNames);
      setSelected(initialSelected);
      setScan({ status: 'done' });
    } catch (error: any) {
      setScan({ status: 'error', message: error?.message || 'Could not read SMS messages.' });
    }
  }, [accounts, suggestedName]);

  // Scan once on mount only. runScan closes over `accounts` for the
  // already-linked check; re-running this effect every time `accounts`
  // changes would re-trigger a scan (and reset selections) on every
  // successful import inside handleImport, since each import updates the
  // Redux store this screen also reads from.
  useEffect(() => { void runScan(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const groups = useMemo(() => {
    const map = new Map<string, DetectedAccountCandidate[]>();
    for (const c of candidates) {
      const groupKey = c.bankName ?? c.sender;
      map.set(groupKey, [...(map.get(groupKey) ?? []), c]);
    }
    return [...map.entries()];
  }, [candidates]);

  const handleImport = async () => {
    const toImport = candidates.filter(c => selected.has(c.key));
    if (!toImport.length) return;
    setImporting(true);
    try {
      for (const candidate of toImport) {
        const result = await (dispatch as any)(addAccount({
          name: (names[candidate.key] || candidate.bankName || candidate.sender).trim(),
          type: 'BANK',
          balance: candidate.balance,
          currency: accounts[0]?.currency || currency,
          is_locked: false,
          locked_amount: 0,
          account_number: candidate.accountTail,
          sms_number: candidate.sender,
          balance_source: 'SMS',
          balance_as_of: candidate.date,
          logo: logoFor(candidate.bankName)?.url,
        }));
        if (addAccount.rejected.match(result)) throw new Error(result.error?.message || 'Failed to add account');
      }
      Alert.alert('Accounts added', `Imported ${toImport.length} account${toImport.length === 1 ? '' : 's'} from SMS.`, [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (error: any) {
      Alert.alert('Import failed', error?.message || 'Some accounts could not be added.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <View className="flex-1 bg-slate-50 dark:bg-background-dark">
      <StatusBar style="auto" />
      <LinearGradient colors={['#059669', '#047857']} className="px-6 pt-6 pb-6 rounded-b-[32px]" style={{ elevation: 4 }}>
        <View className="flex-row justify-between items-center">
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} className="w-10 h-10 bg-white/20 rounded-xl justify-center items-center">
            <FontAwesome name="arrow-left" size={18} color="#fff" />
          </TouchableOpacity>
          <Text className="text-white text-xl font-bold">Scan For Accounts</Text>
          <View className="w-10 h-10" />
        </View>
        <Text className="text-white/80 text-sm mt-3">
          Reads your SMS inbox locally to find bank and wallet accounts, and the last stated balance for each — nothing is uploaded.
        </Text>
      </LinearGradient>

      <ScrollView className="flex-1 px-6 pt-6" contentContainerStyle={{ paddingBottom: 140 }}>
        {scan.status === 'scanning' && (
          <View className="items-center justify-center py-16">
            <CoinLoader size="large" color="#059669" />
            <Text className="text-slate-500 dark:text-slate-400 text-sm mt-4">Scanning your SMS for accounts...</Text>
          </View>
        )}

        {scan.status === 'permission' && (
          <View className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-6">
            <View className="flex-row items-center mb-3">
              <FontAwesome name="warning" size={20} color="#d97706" />
              <Text className="text-amber-800 dark:text-amber-400 font-bold ml-2">SMS Access Needed</Text>
            </View>
            <Text className="text-amber-700 dark:text-amber-300 text-sm mb-4 leading-5">
              Allow SMS access to scan your inbox for bank and wallet accounts.
            </Text>
            <TouchableOpacity onPress={() => void runScan(true)} className="bg-amber-500 py-3 rounded-xl items-center">
              <Text className="text-white font-bold">Allow & Scan</Text>
            </TouchableOpacity>
          </View>
        )}

        {scan.status === 'error' && (
          <View className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-6">
            <Text className="text-red-700 dark:text-red-300 text-sm mb-4">{scan.message}</Text>
            <TouchableOpacity onPress={() => void runScan(false)} className="bg-slate-200 dark:bg-slate-700 py-3 rounded-xl items-center">
              <Text className="text-slate-700 dark:text-slate-200 font-bold">Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {scan.status === 'done' && candidates.length === 0 && (
          <View className="items-center justify-center py-16">
            <FontAwesome name="search" size={40} color="#cbd5e1" />
            <Text className="text-slate-900 dark:text-white font-bold text-base mt-4">No accounts found</Text>
            <Text className="text-slate-500 dark:text-slate-400 text-sm mt-1 text-center">
              No SMS mentioned a stated balance. You can still add an account manually.
            </Text>
          </View>
        )}

        {scan.status === 'done' && groups.map(([groupName, items]) => {
          const logo = logoFor(items[0].bankName);
          return (
            <View key={groupName} className="mb-6">
              <View className="flex-row items-center mb-3">
                {logo ? (
                  <Image source={logo.src} className="w-8 h-8 rounded-lg mr-2" resizeMode="cover" />
                ) : (
                  <View className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-slate-700 items-center justify-center mr-2">
                    <FontAwesome name="university" size={14} color="#64748b" />
                  </View>
                )}
                <Text className="text-slate-900 dark:text-white font-bold text-base">{groupName}</Text>
              </View>

              {items.map(candidate => (
                <View
                  key={candidate.key}
                  className={`flex-row items-center bg-white dark:bg-slate-800 p-4 rounded-2xl mb-2 border ${candidate.alreadyLinked ? 'border-slate-100 dark:border-slate-700 opacity-60' : 'border-slate-100 dark:border-slate-700'}`}
                >
                  <TouchableOpacity
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected.has(candidate.key), disabled: candidate.alreadyLinked }}
                    accessibilityLabel={`Account ending ${candidate.accountTail}`}
                    disabled={candidate.alreadyLinked}
                    onPress={() => toggle(candidate.key)}
                    className={`w-6 h-6 rounded-md mr-3 items-center justify-center border-2 ${selected.has(candidate.key) ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300 dark:border-slate-600'}`}
                  >
                    {selected.has(candidate.key) && <FontAwesome name="check" size={12} color="#fff" />}
                  </TouchableOpacity>

                  <View className="flex-1 mr-2">
                    {candidate.alreadyLinked ? (
                      <Text className="text-slate-500 dark:text-slate-400 text-sm font-semibold">Account ••{candidate.accountTail}</Text>
                    ) : (
                      <TextInput
                        value={names[candidate.key] ?? ''}
                        onChangeText={(value) => setNames(prev => ({ ...prev, [candidate.key]: value }))}
                        className="text-slate-900 dark:text-white text-sm font-semibold p-0"
                        accessibilityLabel="Account name"
                      />
                    )}
                    <Text className="text-slate-500 dark:text-slate-400 text-xs mt-0.5">
                      ••{candidate.accountTail} · {new Date(candidate.date).toLocaleDateString()}
                      {candidate.alreadyLinked ? ' · Already added' : ''}
                    </Text>
                  </View>

                  <Text className="text-slate-900 dark:text-white font-bold text-sm">
                    {formatCurrency(candidate.balance)}
                  </Text>
                </View>
              ))}
            </View>
          );
        })}
      </ScrollView>

      {scan.status === 'done' && candidates.some(c => !c.alreadyLinked) && (
        <View className="absolute bottom-0 left-0 right-0 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 p-4">
          <TouchableOpacity
            disabled={importing || selected.size === 0}
            onPress={handleImport}
            className={`py-4 rounded-xl items-center ${selected.size === 0 ? 'bg-slate-300 dark:bg-slate-700' : 'bg-emerald-500'}`}
          >
            {importing ? <CoinLoader size="small" color="#fff" /> : (
              <Text className="text-white font-bold">Import {selected.size} Account{selected.size === 1 ? '' : 's'}</Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}
