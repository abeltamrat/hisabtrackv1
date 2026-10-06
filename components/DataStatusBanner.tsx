import { useSelector } from 'react-redux';
import type { RootState } from '@/store';
import { Text, View, TouchableOpacity } from 'react-native';
import SyncService from '@/services/SyncService';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useLedgerClock } from '@/hooks/useLedgerClock';

export default function DataStatusBanner() {
  useLedgerClock();
  const { user } = useAuth();
  const { actualTheme } = useTheme();
  const error = useSelector((s: RootState) => s.accounts.error || s.transactions.error || s.budgets.error || s.loans.error);
  const loading = useSelector((s: RootState) => s.accounts.loading || s.transactions.loading || s.budgets.loading || s.loans.loading);
  const message = error || SyncService.lastError;
  if (!message && !loading) return null;

  // These were fixed light-mode colours, so the banner appeared as a bright
  // amber or sky bar over the dark theme. Both variants keep text at or above
  // the 4.5:1 contrast ratio against their own background.
  const isDark = actualTheme === 'dark';
  const palette = message
    ? { background: isDark ? '#422006' : '#fef3c7', text: isDark ? '#fde68a' : '#78350f', action: isDark ? '#93c5fd' : '#0369a1' }
    : { background: isDark ? '#082f49' : '#e0f2fe', text: isDark ? '#bae6fd' : '#0c4a6e', action: isDark ? '#93c5fd' : '#0369a1' };

  return <View accessibilityLiveRegion="polite" style={{ padding: 8, backgroundColor: palette.background }}>
    <Text style={{ color: palette.text }}>{message ? `Data needs attention: ${message}` : 'Refreshing saved data…'}</Text>
    {message && <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel="Retry loading data"
      onPress={() => { void SyncService.syncNow(user?.uid).catch(() => undefined); }}
    ><Text style={{ color: palette.action, paddingTop: 4 }}>Retry</Text></TouchableOpacity>}
  </View>;
}
