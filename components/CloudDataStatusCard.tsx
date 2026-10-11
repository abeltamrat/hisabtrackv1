import CoinLoader from '@/components/CoinLoader';
import { AuthService } from '@/services/AuthService';
import { AUXILIARY_DATASETS } from '@/services/AuxiliarySyncService';
import SyncService from '@/services/SyncService';
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

type Status = Awaited<ReturnType<typeof SyncService.getDataStatus>>;

export default function CloudDataStatusCard() {
  const [status, setStatus] = React.useState<Status | null>(null);
  const [loading, setLoading] = React.useState(false);
  const refresh = React.useCallback(async () => {
    const uid = AuthService.getCurrentUser()?.uid;
    if (!uid) return;
    setLoading(true);
    try { setStatus(await SyncService.getDataStatus(uid)); } finally { setLoading(false); }
  }, []);
  React.useEffect(() => { void refresh(); }, [refresh]);
  const names = ['accounts', 'transactions', 'budgets', 'loans'] as const;
  return <View className="bg-white dark:bg-slate-800 p-4 rounded-xl mb-4">
    <View className="flex-row items-center justify-between"><Text className="text-slate-900 dark:text-white font-bold">Cloud data status</Text><TouchableOpacity onPress={refresh} accessibilityLabel="Refresh cloud data status" className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-700">{loading ? <CoinLoader size="small"/> : <Text className="text-slate-700 dark:text-white text-xs font-bold">Refresh</Text>}</TouchableOpacity></View>
    {status ? <>{names.map(name => <View key={name} className="flex-row justify-between mt-2"><Text className="text-slate-600 dark:text-slate-300 capitalize">{name}</Text><Text className="text-slate-900 dark:text-white font-semibold">Device {status.local[name]} / Cloud {status.cloud[name]}</Text></View>)}<Text className="text-slate-500 dark:text-slate-400 text-xs mt-3">Last successful sync: {status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString() : 'Not yet'}</Text></> : <Text className="text-slate-500 dark:text-slate-400 text-xs mt-3">Sign in and refresh to compare this device with the cloud.</Text>}
    {status && AUXILIARY_DATASETS.map(name => <View key={name} className="flex-row justify-between mt-2"><Text className="text-slate-600 dark:text-slate-300">{name}</Text><Text className="text-slate-900 dark:text-white font-semibold">Device {status.auxiliaryLocal[name]} / Cloud {status.auxiliaryCloud[name] || 0}</Text></View>)}
    {status?.restoreReport && <Text className="text-slate-500 dark:text-slate-400 text-xs mt-2">Last verified dataset report: {new Date(status.restoreReport.completedAt).toLocaleString()} / {status.restoreReport.rows.length} datasets</Text>}
    {status?.currencyQuarantine && <Text className="text-amber-700 dark:text-amber-300 text-xs mt-2">Protected currency records: using {status.currencyQuarantine.primaryCurrency}; {status.currencyQuarantine.records?.length || 0} records from {status.currencyQuarantine.currencies?.filter((currency: string) => currency !== status.currencyQuarantine.primaryCurrency).join(', ')} remain preserved in cloud.</Text>}
    <Text className="text-amber-700 dark:text-amber-300 text-xs mt-2">Server backup: not configured yet. Cloud sync is not a historical backup.</Text>
  </View>;
}
