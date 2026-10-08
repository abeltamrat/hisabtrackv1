import { useI18n } from '@/contexts/I18nContext';
import { useTheme } from '@/contexts/ThemeContext';
import { FontAwesome } from '@expo/vector-icons';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useRouter } from 'expo-router';
import React from 'react';
import { Platform, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { AURORA_ACCENT } from '@/components/aurora/palette';
import { themeTokens } from '@/constants/theme';

type TabEntry =
  | { kind: 'screen'; routeName: string; icon: string; label: string; a11yKey: string }
  | { kind: 'fab' }
  | { kind: 'link'; path: string; icon: string; label: string; a11yKey: string };

const TAB_CONFIG: TabEntry[] = [
  { kind: 'screen', routeName: 'index',        icon: 'home',      label: 'Home',    a11yKey: 'dashboard'    },
  { kind: 'screen', routeName: 'transactions', icon: 'exchange',  label: 'Txns',    a11yKey: 'transactions' },
  { kind: 'fab' },
  { kind: 'screen', routeName: 'reports',      icon: 'pie-chart', label: 'Reports', a11yKey: 'reports'      },
  { kind: 'link',   path: '/settings',         icon: 'user',      label: 'Profile', a11yKey: 'settings'     },
];

export default function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  const { actualTheme, isAurora } = useTheme();
  const { t } = useI18n();
  const isDark = actualTheme === 'dark';
  const theme = themeTokens(isDark);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const inactive = isAurora ? 'rgba(255,255,255,0.78)' : isDark ? '#475569' : '#94a3b8';
  const active   = isAurora ? '#ffffff' : '#6366f1';
  const bg       = theme.surface;
  const border   = isDark ? '#1e293b' : '#f1f5f9';

  const items = TAB_CONFIG.map((entry, idx) => {
        /* ── Centre FAB ── */
        if (entry.kind === 'fab') {
          const fabBg = isAurora ? AURORA_ACCENT : isDark ? '#6366f1' : '#1e293b';
          return (
            <View key="fab" style={styles.fabWrap}>
              <TouchableOpacity
                onPress={() => router.push('/modal' as any)}
                accessibilityRole="button"
                accessibilityLabel={t('addNew')}
                accessibilityHint="Opens the form to record a new transaction"
                activeOpacity={0.8}
                style={{
                  width: 54,
                  height: 54,
                  borderRadius: 27,
                  backgroundColor: fabBg,
                  alignItems: 'center',
                  justifyContent: 'center',
                  elevation: 8,
                  shadowColor: isAurora ? AURORA_ACCENT : '#000',
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: isAurora ? 0.7 : 0.3,
                  shadowRadius: isAurora ? 16 : 8,
                }}
              >
                <FontAwesome name="plus" size={22} color={isAurora ? '#082f49' : '#fff'} />
              </TouchableOpacity>
            </View>
          );
        }

        /* ── External link (Profile / Settings) ── */
        if (entry.kind === 'link') {
          return (
            <Pressable
              key={entry.path}
              onPress={() => router.push(entry.path as any)}
              accessibilityRole="button"
              accessibilityLabel={t(entry.a11yKey)}
              android_ripple={{ color: active + '30', borderless: true }}
              style={styles.tab}
            >
              <View style={styles.iconWrap}>
                <FontAwesome name={entry.icon as any} size={20} color={inactive} />
              </View>
              <Text style={[styles.label, { color: inactive }]}>{entry.label}</Text>
            </Pressable>
          );
        }

        /* ── Regular tab screen ── */
        const routeIdx = state.routes.findIndex(r => r.name === entry.routeName);
        const isActive = state.index === routeIdx;

        const handlePress = () => {
          if (routeIdx < 0) return;
          const event = navigation.emit({
            type: 'tabPress',
            target: state.routes[routeIdx]?.key,
            canPreventDefault: true,
          });
          if (!event.defaultPrevented) {
            navigation.navigate(entry.routeName);
          }
        };

        return (
          <Pressable
            key={entry.routeName}
            onPress={handlePress}
            accessibilityRole="tab"
            accessibilityLabel={t(entry.a11yKey)}
            // Without this the reader cannot tell which tab is current.
            accessibilityState={{ selected: isActive }}
            android_ripple={{ color: active + '30', borderless: true }}
            style={styles.tab}
          >
            <View importantForAccessibility="no-hide-descendants" style={[styles.iconWrap, isActive && (isAurora ? styles.iconWrapAurora : styles.iconWrapActive)]}>
              <FontAwesome
                name={entry.icon as any}
                size={20}
                color={isActive ? '#fff' : inactive}
              />
            </View>
            <Text style={[styles.label, { color: isActive ? active : inactive }]}>
              {entry.label}
            </Text>
          </Pressable>
        );
      });

  if (isAurora) {
    // A frosted pill floating over the aurora; it stays in the layout so no
    // screen content is ever hidden behind it.
    return (
      <View style={{ paddingHorizontal: 16, paddingBottom: (insets.bottom > 0 ? insets.bottom : 0) + 10, paddingTop: 6 }}>
        <View accessibilityRole="tablist" style={styles.pill}>
          {/* Clipped background layers; the raised add button may overflow the pill. */}
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: 34, overflow: 'hidden' }]}>
            <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
            <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(15,23,42,0.55)' }]} />
          </View>
          {items}
        </View>
      </View>
    );
  }

  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.bar,
        {
          backgroundColor: bg,
          borderTopColor: border,
          paddingBottom: insets.bottom > 0 ? insets.bottom : 8,
        },
      ]}
    >
      {items}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
    ...Platform.select({
      android: { elevation: 12 },
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
      },
    }),
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  iconWrap: {
    width: 40,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapActive: {
    backgroundColor: '#6366f1',
  },
  iconWrapAurora: {
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 68,
    borderRadius: 34,
    overflow: 'visible',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    ...Platform.select({
      android: { elevation: 10 },
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.4, shadowRadius: 20 },
    }),
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  /* FAB */
  fabWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  fab: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#6366f1',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      android: { elevation: 8 },
      ios: {
        shadowColor: '#6366f1',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.45,
        shadowRadius: 10,
      },
    }),
  },
});
