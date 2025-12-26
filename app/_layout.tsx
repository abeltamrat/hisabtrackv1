import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import 'react-native-reanimated';
import "../global.css";

import { Provider } from 'react-redux';
import { store } from '../store';

// Suppress specific Expo Go notification errors
const originalConsoleError = console.error;
console.error = (...args) => {
  if (typeof args[0] === 'string' && args[0].includes('expo-notifications: Android Push notifications')) {
    return;
  }
  originalConsoleError(...args);
};

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

// ...

function RootLayoutNav() {
  const pathname = usePathname();
  const isAuthPage = pathname === '/login' || pathname === '/sms-permissions';

  return (
    <Provider store={store}>
      <AuthProvider>
        <CustomThemeProvider>
          <AppSettingsProvider>
            <TransactionProvider>
              <I18nProvider>
                {isAuthPage ? (
                  <ThemedStack />
                ) : (
                  <AppShell>
                    <ThemedStack />
                  </AppShell>
                )}
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
        <Stack.Screen name="account/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
        <Stack.Screen name="budget-modal" options={{ presentation: 'modal' }} />
        <Stack.Screen name="accounts" options={{ headerShown: false }} />
        <Stack.Screen name="recurring" options={{ headerShown: false }} />
        <Stack.Screen name="budget" options={{ headerShown: false }} />
        <Stack.Screen name="loans" options={{ headerShown: false }} />
        <Stack.Screen name="calculator" options={{ headerShown: false }} />
        <Stack.Screen name="manage-assets" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ headerShown: false }} />
        <Stack.Screen name="transaction/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="loan/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="amortization" options={{ headerShown: false }} />
        <Stack.Screen name="transfer" options={{ headerShown: false }} />
        <Stack.Screen name="reports" options={{ headerShown: false }} />
        <Stack.Screen name="goals" options={{ headerShown: false }} />
        <Stack.Screen name="help" options={{ headerShown: false }} />
        <Stack.Screen name="notifications" options={{ headerShown: false }} />
        <Stack.Screen name="categories" options={{ headerShown: false }} />
        <Stack.Screen name="cards" options={{ headerShown: false }} />
        <Stack.Screen name="draft-transactions" options={{ headerShown: false }} />
      </Stack>
    </ThemeProvider>
  );
}
