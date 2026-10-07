import { FontAwesome } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Alert } from '@/utils/alert';
import { SMSSyncService } from '@/services/SMSSyncService';
import { useTheme } from '@/contexts/ThemeContext';

export default function SMSPermissionsScreen() {
  const router = useRouter();
  const { actualTheme } = useTheme();
  const [hasPermission, setHasPermission] = useState(false);
  const [checking, setChecking] = useState(true);
  const [requesting, setRequesting] = useState(false);

  const supported = Platform.OS === 'android';

  // Reflect the real OS permission rather than a local flag, so returning from
  // Android settings shows the true state.
  const refresh = useCallback(async () => {
    if (!supported) { setChecking(false); return; }
    setHasPermission(await SMSSyncService.hasReadSmsPermission());
    setChecking(false);
  }, [supported]);

  useEffect(() => { void refresh(); }, [refresh]);

  const requestSMSPermission = async () => {
    if (!supported) {
      Alert.alert('Not available', 'SMS reading is only available on Android devices.');
      return;
    }
    setRequesting(true);
    try {
      // The real Android permission dialog. This screen previously faked the
      // request and then reported success, so users were told SMS access had
      // been granted when nothing had actually been requested.
      const granted = await SMSSyncService.requestPermissions();
      setHasPermission(granted);
      if (granted) {
        Alert.alert('Auto-tracking enabled', 'HisabTrack can now read bank SMS to suggest transactions.', [
          { text: 'Continue', onPress: () => router.replace('/(tabs)') },
        ]);
        return;
      }
      // A second denial on Android is permanent until changed in settings.
      Alert.alert(
        'Permission not granted',
        'HisabTrack cannot read bank SMS without this permission. You can still add transactions manually, or grant it in Android settings.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open settings', onPress: () => { void Linking.openSettings().catch(() => undefined); } },
        ]
      );
    } catch (error) {
      console.error('Error requesting SMS permission:', error);
      Alert.alert('Error', 'Could not request SMS permission. Please try again.');
    } finally {
      setRequesting(false);
    }
  };

  const skipPermission = () => router.replace('/(tabs)');

  return (
    <View className="flex-1 bg-background-light dark:bg-background-dark">
      {/* Follows the theme; a fixed "dark" style was invisible in dark mode. */}
      <StatusBar style={actualTheme === 'dark' ? 'light' : 'dark'} />
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 32 }}>
        <View className="items-center mb-10">
          <View className="w-24 h-24 bg-primary-100 rounded-full justify-center items-center mb-6">
            <FontAwesome name="envelope" size={48} color="#6366f1" />
          </View>
          <Text className="text-3xl font-bold text-text-light dark:text-text-dark text-center mb-4">
            Auto-Track Transactions
          </Text>
          <Text className="text-base text-text-muted text-center">
            {supported
              ? 'Allow HisabTrack to read SMS from your banks so it can suggest transactions for you to review.'
              : 'Reading bank SMS is only available on Android. You can add transactions manually on this device.'}
          </Text>
        </View>

        <View className="bg-surface-light dark:bg-surface-dark p-6 rounded-3xl shadow-sm mb-6">
          <Benefit
            icon="check"
            title="You stay in control"
            body="Messages become draft transactions that you review and confirm. Nothing is recorded to your ledger automatically."
          />
          <Benefit
            icon="check"
            title="Smart categorization"
            body="Drafts are pre-filled with a suggested category based on the merchant name, which you can change."
          />
          {/* Honest about the optional AI path: the previous copy claimed no
              data ever leaves the device, which contradicts the privacy policy. */}
          <Benefit
            icon="lock"
            title="Processed on your device"
            body="Parsing happens locally and full message text is stored only on this device. If you later turn on AI assistance in Settings, messages the local parser cannot read are sent to the AI provider you choose. That is off by default."
            last
          />
        </View>

        {hasPermission ? (
          <View className="bg-emerald-50 dark:bg-emerald-900/20 rounded-2xl p-4 mb-4 flex-row items-center">
            <FontAwesome name="check-circle" size={18} color="#10b981" />
            <Text className="text-emerald-700 dark:text-emerald-300 font-semibold ml-3 flex-1">
              SMS access is already granted.
            </Text>
          </View>
        ) : null}

        <TouchableOpacity
          className={`h-14 rounded-xl justify-center items-center mb-4 ${supported && !hasPermission ? 'bg-primary-500' : 'bg-slate-300 dark:bg-slate-700'}`}
          onPress={requestSMSPermission}
          disabled={!supported || hasPermission || requesting || checking}
          accessibilityRole="button"
          accessibilityLabel="Enable automatic transaction tracking from SMS"
          accessibilityState={{ disabled: !supported || hasPermission || requesting, busy: requesting }}
        >
          {requesting
            ? <ActivityIndicator color="#ffffff" />
            : <Text className="text-white text-lg font-bold">
                {hasPermission ? 'Enabled' : 'Enable Auto-Tracking'}
              </Text>}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={skipPermission}
          className="items-center py-3 min-h-[44px] justify-center"
          accessibilityRole="button"
          accessibilityLabel={hasPermission ? 'Continue to the app' : 'Skip and continue without SMS access'}
        >
          <Text className="text-text-muted text-sm font-semibold">
            {hasPermission ? 'Continue' : 'Skip for now'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function Benefit({ icon, title, body, last }: { icon: string; title: string; body: string; last?: boolean }) {
  return (
    <View className={`flex-row items-start ${last ? '' : 'mb-4'}`}>
      <View className="w-8 h-8 bg-secondary-100 rounded-full justify-center items-center mr-4">
        <FontAwesome name={icon as any} size={14} color="#0d9488" />
      </View>
      <View className="flex-1">
        <Text className="text-text-light dark:text-text-dark font-bold text-base mb-1">{title}</Text>
        <Text className="text-text-muted text-sm">{body}</Text>
      </View>
    </View>
  );
}
