import '@/config/ignoreWarnings';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import 'react-native-reanimated';
import { AppState } from 'react-native';
import "../global.css";

import { Provider } from 'react-redux';
import { store } from '../store';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary
} from 'expo-router';

export const unstable_settings = {
  // Ensure that reloading on `/modal` keeps a back button present.
  initialRouteName: '(tabs)',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return <RootLayoutNav />;
}

import AppShell from '@/components/AppShell';
import { TransactionProvider } from '@/context/TransactionContext';
import { AppSettingsProvider } from '@/contexts/AppSettingsContext';
import { AuthProvider } from '@/contexts/AuthContext';
import { I18nProvider } from '@/contexts/I18nContext';
import { ThemeProvider as CustomThemeProvider, useTheme } from '@/contexts/ThemeContext';
import { BackgroundService } from '@/services/BackgroundService';
import { NotificationService } from '@/services/NotificationService';
import SyncService from '@/services/SyncService';
import { useRouter } from 'expo-router';
import SMSAutoSync from '@/components/SMSAutoSync';
import UpdateModal from '@/components/UpdateModal';
import { UpdateInfo, UpdateService } from '@/services/UpdateService';
import OnboardingScreen from '@/components/OnboardingScreen';
import OnboardingService from '@/services/OnboardingService';
import { useState, useRef, useCallback } from 'react';
import { Text, View } from 'react-native';

// ...

function RootLayoutNav() {
  const pathname = usePathname();
  const router = useRouter();
  const isAuthPage = pathname === '/login' || pathname === '/sms-permissions';
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [showOnboarding, setShowOnboarding] = useState<boolean>(false);
  const [onboardingChecked, setOnboardingChecked] = useState<boolean>(false);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const updateStatusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastUpdateCheckRef = useRef<number>(0);

  const showUpdateStatus = useCallback((msg: string, autoClearMs = 3000) => {
    setUpdateStatus(msg);
    if (updateStatusTimer.current) clearTimeout(updateStatusTimer.current);
    if (autoClearMs > 0) {
      updateStatusTimer.current = setTimeout(() => setUpdateStatus(null), autoClearMs);
    }
  }, []);

  const runUpdateCheck = useCallback(async () => {
    const now = Date.now();
    if (now - lastUpdateCheckRef.current < 30 * 60 * 1000) return;
    lastUpdateCheckRef.current = now;
    showUpdateStatus('Checking for updates...', 0);
    try {
      const info = await UpdateService.checkForUpdate();
      if (info) {
        setUpdateInfo(info);
        setUpdateStatus(null);
        if (updateStatusTimer.current) clearTimeout(updateStatusTimer.current);
      } else {
        showUpdateStatus('App is up to date', 3000);
      }
    } catch {
      setUpdateStatus(null);
    }
  }, [showUpdateStatus]);

  // Check onboarding status on mount
  useEffect(() => {
    const checkOnboarding = async () => {
      try {
        const hasCompleted = await OnboardingService.hasCompletedOnboarding();
        setShowOnboarding(!hasCompleted && !isAuthPage);
        setOnboardingChecked(true);
      } catch (error) {
        console.error('Error checking onboarding:', error);
        setOnboardingChecked(true);
      }
    };
    checkOnboarding();
  }, [isAuthPage]);

  useEffect(() => {
    void BackgroundService.markAppActive();
    void BackgroundService.runMaintenance('launch');
    void NotificationService.syncPresentedNotifications();

    const receivedSubscription = NotificationService.addNotificationReceivedListener((notification) => {
      void NotificationService.syncReceivedNotification(notification);
    });

    const subscription = NotificationService.addNotificationResponseListener(async (response) => {
      const { actionIdentifier, notification } = response;
      const data = notification.request.content.data;

      await NotificationService.syncNotificationResponse(response);

      // Handle custom actions
      if (actionIdentifier === 'SNOOZE') {
        await NotificationService.snoozeNotification(response);
        return;
      }

      if (actionIdentifier === 'DISMISS') {
        // Just dismiss, nothing to do
        return;
      }

      if (data?.recurringId) {
        console.log('[Notification] Navigating to recurring execute:', data.recurringId);
        router.push({
          pathname: '/recurring',
          params: { executeId: data.recurringId }
        } as any);
      } else if (data?.loanId) {
        router.push(`/loan/${data.loanId}` as any);
      } else if (data?.actionType === 'view_budget') {
        router.push('/budget' as any);
      } else if (data?.actionType === 'view_loans') {
        router.push('/loans' as any);
      } else if (data?.actionType === 'view_recurring') {
        router.push('/recurring' as any);
      } else if (data?.actionType === 'view_reports') {
        router.push('/reports' as any);
      } else if (data?.actionType === 'view_drafts') {
        router.push('/draft-transactions' as any);
      } else if (data?.actionType === 'view_transactions') {
        router.push('/(tabs)' as any);
      }
    });

    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void BackgroundService.markAppActive();
        void BackgroundService.runMaintenance('foreground');
        void runUpdateCheck();
        void SyncService.triggerForegroundSync();
      }
    });

    void BackgroundService.registerTask();

    // Check Permissions on launch
    const checkPermissions = async () => {
      try {
        const AsyncStorage = require('@react-native-async-storage/async-storage').default;
        const hasChecked = await AsyncStorage.getItem('has_checked_initial_permissions');

        if (!hasChecked) {
          const { checkRequiredPermissions, requestPermission } = require('@/services/PermissionsService');
          const granted = await checkRequiredPermissions();

          if (!granted) {
            // Request only baseline permission on first launch.
            await requestPermission('NOTIFICATIONS');
          }
          await AsyncStorage.setItem('has_checked_initial_permissions', 'true');
        }
      } catch (e) {
        console.error('Permission check failed', e);
      }
    };

    checkPermissions();

    void runUpdateCheck();

    return () => {
      receivedSubscription.remove();
      subscription.remove();
      appStateSubscription.remove();
    };
  }, [runUpdateCheck]);

  const handleOnboardingComplete = async () => {
    await OnboardingService.completeOnboarding();
    setShowOnboarding(false);
  };

  // Don't render anything until onboarding check is complete
  if (!onboardingChecked) {
    return null;
  }

  // Show onboarding if needed
  if (showOnboarding && !isAuthPage) {
    return (
      <Provider store={store}>
        <CustomThemeProvider>
          <OnboardingScreen onComplete={handleOnboardingComplete} />
        </CustomThemeProvider>
      </Provider>
    );
  }

  return (
    <Provider store={store}>
      <AuthProvider>
        <CustomThemeProvider>
          <AppSettingsProvider>
            <TransactionProvider>
              <I18nProvider>
                <View style={{ flex: 1 }}>
                  <SMSAutoSync />
                  <UpdateModal
                    visible={!!updateInfo}
                    updateInfo={updateInfo}
                    onClose={() => setUpdateInfo(null)}
                  />
                  {isAuthPage ? (
                    <ThemedStack />
                  ) : (
                    <AppShell>
                      <ThemedStack />
                    </AppShell>
                  )}
                  {!!updateStatus && (
                    <View
                      style={{
                        position: 'absolute',
                        bottom: 8,
                        left: 0,
                        right: 0,
                        alignItems: 'center',
                        pointerEvents: 'none',
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 11,
                          color: 'rgba(128,128,128,0.8)',
                          backgroundColor: 'rgba(0,0,0,0.04)',
                          paddingHorizontal: 10,
                          paddingVertical: 3,
                          borderRadius: 8,
                        }}
                      >
                        {updateStatus}
                      </Text>
                    </View>
                  )}
                </View>
              </I18nProvider>
            </TransactionProvider>
          </AppSettingsProvider>
        </CustomThemeProvider>
      </AuthProvider>
    </Provider>
  );
}

function ThemedStack() {
  const { actualTheme } = useTheme();

  return (
    <ThemeProvider value={actualTheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="account" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
        <Stack.Screen name="budget-modal" options={{ presentation: 'modal' }} />
        <Stack.Screen name="accounts" options={{ headerShown: false }} />
        <Stack.Screen name="recurring" options={{ headerShown: false }} />
        <Stack.Screen name="budget" options={{ headerShown: false }} />
        <Stack.Screen name="loans" options={{ headerShown: false }} />
        <Stack.Screen name="calculator" options={{ headerShown: false }} />
        <Stack.Screen name="export" options={{ headerShown: false }} />
        <Stack.Screen name="manage-assets" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ headerShown: false }} />
        <Stack.Screen name="transaction/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="loan/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="amortization" options={{ headerShown: false }} />
        <Stack.Screen name="transfer" options={{ headerShown: false }} />

        <Stack.Screen name="goals" options={{ headerShown: false }} />
        <Stack.Screen name="help" options={{ headerShown: false }} />
        <Stack.Screen name="notifications" options={{ headerShown: false }} />
        <Stack.Screen name="categories" options={{ headerShown: false }} />
        <Stack.Screen name="cards" options={{ headerShown: false }} />
        <Stack.Screen name="draft-transactions" options={{ headerShown: false }} />
        <Stack.Screen name="aiassistant" options={{ headerShown: false }} />
        <Stack.Screen name="about" options={{ headerShown: false }} />
        <Stack.Screen name="privacy" options={{ headerShown: false }} />
        <Stack.Screen name="terms" options={{ headerShown: false }} />
      </Stack>
    </ThemeProvider>
  );
}
