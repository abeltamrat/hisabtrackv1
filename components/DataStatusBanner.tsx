import { useSelector } from 'react-redux';
import type { RootState } from '@/store';
import { Text, View, TouchableOpacity } from 'react-native';
import SyncService from '@/services/SyncService';
import { useAuth } from '@/contexts/AuthContext';
import { useLedgerClock } from '@/hooks/useLedgerClock';
export default function DataStatusBanner() {
  useLedgerClock();
  const { user } = useAuth();
  const error = useSelector((s: RootState) => s.accounts.error || s.transactions.error || s.budgets.error || s.loans.error);
  const loading = useSelector((s: RootState) => s.accounts.loading || s.transactions.loading || s.budgets.loading || s.loans.loading);
  const message = error || SyncService.lastError;
  if (!message && !loading) return null;
  return <View accessibilityLiveRegion="polite" style={{ padding: 8, backgroundColor: message ? '#fef3c7' : '#e0f2fe' }}>
    <Text style={{ color: '#334155' }}>{message ? `Data needs attention: ${message}` : 'Refreshing saved data…'}</Text>
    {message && <TouchableOpacity accessibilityRole="button" onPress={() => { void SyncService.syncNow(user?.uid).catch(() => undefined); }}><Text style={{ color: '#0369a1', paddingTop: 4 }}>Retry</Text></TouchableOpacity>}
  </View>;
}
