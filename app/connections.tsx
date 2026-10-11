import CoinLoader from '@/components/CoinLoader';
import LocalChangeEmitter from '@/services/LocalChangeEmitter';
import MelaService, { type MelaConnection } from '@/services/MelaService';
import CatalogShareService, { type ShareSettings } from '@/services/CatalogShareService';
import FundSyncService from '@/services/FundSyncService';
import { useAuth } from '@/contexts/AuthContext';
import { Alert } from '@/utils/alert';
import { FontAwesome } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

export default function ConnectionsScreen() {
  const router = useRouter();
  const [connection, setConnection] = useState<MelaConnection | null>(null);
  const [projectCount, setProjectCount] = useState(0);
  const [itemCount, setItemCount] = useState(0);
  const [supplierCount, setSupplierCount] = useState(0);
  const [company, setCompany] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'connect' | 'sync' | 'share' | null>(null);
  const { user } = useAuth();
  const [share, setShare] = useState<ShareSettings>({ enabled: false, allowedUids: [] });
  const [funds, setFunds] = useState(FundSyncService.getSnapshot().funds);
  useEffect(() => FundSyncService.subscribe(snapshot => setFunds(snapshot.funds)), []);
  useEffect(() => { void CatalogShareService.getSettings().then(setShare); }, []);
  // Assistants = people holding one of my active funds.
  const assistants = Array.from(new Map(funds
    .filter(f => f.ownerUid === user?.uid && f.custodianUid && f.status === 'ACTIVE')
    .map(f => [f.custodianUid as string, { uid: f.custodianUid as string, name: f.custodianName || 'Assistant', fund: f.name }])).values());
  const ownerName = funds.find(f => f.ownerUid === user?.uid)?.ownerName;
  const saveShare = async (next: ShareSettings) => {
    setShare(next); setBusy('share'); setError('');
    try { await CatalogShareService.setSettings(next, ownerName); } catch (e: any) { setError(e?.message || 'Could not update sharing.'); } finally { setBusy(null); }
  };
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [current, projects, items, suppliers] = await Promise.all([MelaService.getConnection(), MelaService.getProjects(), MelaService.getItems(), MelaService.getSuppliers()]);
    setConnection(current); setProjectCount(projects.length); setItemCount(items.length); setSupplierCount(suppliers.length);
    if (current && !company) setCompany(current.company);
  }, [company]);
  useEffect(() => { void load(); const unsubscribe = LocalChangeEmitter.subscribe(() => { void load(); }); return () => { unsubscribe(); }; }, [load]);

  const connect = async () => {
    if (!company.trim() || !identifier.trim() || !password) { setError('Enter your Mela company, email or phone, and password.'); return; }
    setBusy('connect'); setError('');
    try {
      await MelaService.connect(company, identifier, password);
      setPassword('');
    } catch (e: any) {
      setError(e?.message || 'Could not connect to Mela.');
    } finally { setBusy(null); }
  };

  const sync = async () => {
    setBusy('sync'); setError('');
    try { await MelaService.syncProjects(); } catch (e: any) { setError(e?.message || 'Sync failed.'); } finally { setBusy(null); }
  };

  const disconnect = () => Alert.alert('Disconnect Mela?', 'Imported projects are removed from this device. Transactions keep the project names they were saved with.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Disconnect', style: 'destructive', onPress: () => { void MelaService.disconnect(); } },
  ]);

  const showForm = !connection || connection.needsReconnect;

  return (
    <View className="flex-1 bg-slate-50 dark:bg-background-dark">
      <Stack.Screen options={{ headerShown: false }} />
      <View className="px-5 pt-5 pb-4 flex-row items-center">
        <TouchableOpacity accessibilityLabel="Go back" onPress={() => router.back()} className="w-11 h-11 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 items-center justify-center"><FontAwesome name="arrow-left" size={16} color="#64748b" /></TouchableOpacity>
        <View className="flex-1 ml-4"><Text className="text-xl font-extrabold text-slate-900 dark:text-white">Connections</Text><Text className="text-xs text-slate-500 dark:text-slate-400">Bring data in from systems you already use</Text></View>
      </View>

      <ScrollView className="flex-1 px-5" contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <View className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl p-5">
          <View className="flex-row items-center">
            <View className="w-12 h-12 rounded-2xl bg-indigo-100 dark:bg-indigo-950 items-center justify-center mr-3"><FontAwesome name="building" size={20} color="#6366f1" /></View>
            <View className="flex-1">
              <Text className="text-base font-extrabold text-slate-900 dark:text-white">Mela ERP</Text>
              <Text className="text-xs text-slate-500 dark:text-slate-400">Import projects, items and suppliers to tag purchases. Read-only — nothing is sent to Mela.</Text>
            </View>
          </View>

          {connection && (
            <View className="mt-4 rounded-2xl bg-slate-50 dark:bg-slate-900 p-4">
              <View className="flex-row items-center mb-1">
                <View className={`w-2 h-2 rounded-full mr-2 ${connection.needsReconnect ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                <Text className="text-sm font-bold text-slate-900 dark:text-white">{connection.needsReconnect ? 'Sign in again' : 'Connected'}</Text>
              </View>
              <Text className="text-xs text-slate-600 dark:text-slate-300">{connection.userName} · {connection.company}</Text>
              <Text className="text-xs text-slate-600 dark:text-slate-300 mt-1">{projectCount} project{projectCount === 1 ? '' : 's'} · {itemCount} item{itemCount === 1 ? '' : 's'} · {supplierCount} supplier{supplierCount === 1 ? '' : 's'}</Text>
              <Text className="text-xs text-slate-600 dark:text-slate-300 mt-1">Last synced {connection.lastSyncAt ? new Date(connection.lastSyncAt).toLocaleString() : 'never'}</Text>
              {!!connection.lastError && <Text className="text-xs text-amber-700 dark:text-amber-300 mt-2">{connection.lastError}</Text>}
              {!connection.needsReconnect && (
                <View className="flex-row mt-4 gap-2">
                  <TouchableOpacity onPress={() => router.push('/projects' as any)} className="flex-1 py-3 rounded-xl bg-indigo-600 items-center"><Text className="text-white text-sm font-bold">Projects</Text></TouchableOpacity>
                  <TouchableOpacity disabled={busy === 'sync'} onPress={sync} className="flex-1 py-3 rounded-xl bg-slate-200 dark:bg-slate-700 items-center">{busy === 'sync' ? <CoinLoader size="small" color="#6366f1" /> : <Text className="text-slate-700 dark:text-slate-200 text-sm font-bold">Sync now</Text>}</TouchableOpacity>
                </View>
              )}
              <TouchableOpacity onPress={disconnect} className="mt-3 py-2 items-center"><Text className="text-red-600 dark:text-red-400 text-sm font-bold">Disconnect</Text></TouchableOpacity>
            </View>
          )}

          {showForm && (
            <View className="mt-4">
              <Text className="text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">Company</Text>
              <TextInput value={company} onChangeText={setCompany} placeholder="e.g. kingswood" placeholderTextColor="#94a3b8" autoCapitalize="none" autoCorrect={false} className="bg-slate-100 dark:bg-slate-900 rounded-2xl px-4 py-3 text-slate-900 dark:text-white" />
              <Text className="text-xs font-bold text-slate-600 dark:text-slate-300 mt-3 mb-1">Email or phone</Text>
              <TextInput value={identifier} onChangeText={setIdentifier} placeholder="name@company.com" placeholderTextColor="#94a3b8" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" className="bg-slate-100 dark:bg-slate-900 rounded-2xl px-4 py-3 text-slate-900 dark:text-white" />
              <Text className="text-xs font-bold text-slate-600 dark:text-slate-300 mt-3 mb-1">Password</Text>
              <TextInput value={password} onChangeText={setPassword} placeholder="Mela password" placeholderTextColor="#94a3b8" secureTextEntry autoCapitalize="none" autoCorrect={false} className="bg-slate-100 dark:bg-slate-900 rounded-2xl px-4 py-3 text-slate-900 dark:text-white" />
              <Text className="text-[11px] text-slate-500 dark:text-slate-400 mt-2">Your password is used once to sign in and is not stored. Changing it in Mela disconnects this app.</Text>
              <TouchableOpacity disabled={busy === 'connect'} onPress={connect} className="mt-4 py-4 rounded-2xl bg-indigo-600 items-center">
                {busy === 'connect' ? <CoinLoader size="small" color="#fff" /> : <Text className="text-white font-extrabold">{connection?.needsReconnect ? 'Sign in again' : 'Connect'}</Text>}
              </TouchableOpacity>
            </View>
          )}

          {!!error && <Text accessibilityRole="alert" className="text-red-600 dark:text-red-400 text-sm mt-3">{error}</Text>}
        </View>

        {connection && !connection.needsReconnect && (
          <View className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl p-5 mt-4">
            <View className="flex-row items-center">
              <View className="flex-1 mr-3">
                <Text className="text-base font-extrabold text-slate-900 dark:text-white">Share with assistants</Text>
                <Text className="text-xs text-slate-500 dark:text-slate-400 mt-1">People holding your funds can tag payments with your Mela projects, items and suppliers, and see your prices for Mela items. They never get your Mela login.</Text>
              </View>
              <TouchableOpacity accessibilityRole="switch" accessibilityState={{ checked: share.enabled, busy: busy === 'share' }} disabled={busy === 'share'}
                onPress={() => saveShare({ ...share, enabled: !share.enabled })}
                className={`w-14 h-8 rounded-full p-1 ${share.enabled ? 'bg-indigo-600 items-end' : 'bg-slate-300 dark:bg-slate-600 items-start'}`}>
                <View className="w-6 h-6 rounded-full bg-white" />
              </TouchableOpacity>
            </View>
            {share.enabled && (
              <View className="mt-4">
                {assistants.length === 0 && <Text className="text-xs text-slate-500 dark:text-slate-400">No one holds one of your funds yet. Create a fund and invite your assistant from Funds.</Text>}
                {assistants.map(a => {
                  const allowed = share.allowedUids.includes(a.uid);
                  return (
                    <TouchableOpacity key={a.uid} accessibilityRole="checkbox" accessibilityState={{ checked: allowed }} disabled={busy === 'share'}
                      onPress={() => saveShare({ ...share, allowedUids: allowed ? share.allowedUids.filter(uid => uid !== a.uid) : [...share.allowedUids, a.uid] })}
                      className="flex-row items-center py-3 border-b border-slate-100 dark:border-slate-700">
                      <FontAwesome name={allowed ? 'check-square' : 'square-o'} size={18} color={allowed ? '#6366f1' : '#94a3b8'} />
                      <View className="ml-3 flex-1"><Text className="text-sm font-bold text-slate-900 dark:text-white">{a.name}</Text><Text className="text-[11px] text-slate-500 dark:text-slate-400">Holds {a.fund}</Text></View>
                    </TouchableOpacity>
                  );
                })}
                {busy === 'share' && <Text className="text-xs text-slate-500 dark:text-slate-400 mt-2">Updating…</Text>}
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
