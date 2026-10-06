import { useTheme } from '@/contexts/ThemeContext';
import { FontAwesome } from '@expo/vector-icons';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useRouter } from 'expo-router';
import React from 'react';
import { Platform, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type TabEntry =
  | { kind: 'screen'; routeName: string; icon: string; label: string }
  | { kind: 'fab' }
  | { kind: 'link'; path: string; icon: string; label: string };

const TAB_CONFIG: TabEntry[] = [
  { kind: 'screen', routeName: 'index',        icon: 'home',      label: 'Home'     },
  { kind: 'screen', routeName: 'transactions', icon: 'exchange',  label: 'Txns'     },
  { kind: 'fab' },
  { kind: 'screen', routeName: 'reports',      icon: 'pie-chart', label: 'Reports'  },
  { kind: 'link',   path: '/settings',         icon: 'user',      label: 'Profile'  },
];

export default function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  const { actualTheme } = useTheme();
  const isDark = actualTheme === 'dark';
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const inactive = isDark ? '#475569' : '#94a3b8';
  const active   = '#6366f1';
  const bg       = isDark ? '#0f172a' : '#ffffff';
  const border   = isDark ? '#1e293b' : '#f1f5f9';

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: bg,
          borderTopColor: border,
          paddingBottom: insets.bottom > 0 ? insets.bottom : 8,
        },
      ]}
    >
      {TAB_CONFIG.map((entry, idx) => {
        /* ── Centre FAB ── */
        if (entry.kind === 'fab') {
          const fabBg = isDark ? '#6366f1' : '#1e293b';
          return (
            <View key="fab" style={styles.fabWrap}>
              <TouchableOpacity
                onPress={() => router.push('/modal' as any)}
                activeOpacity={0.8}
                style={{
                  width: 54,
                  height: 54,
                  borderRadius: 27,
                  backgroundColor: fabBg,
                  alignItems: 'center',
                  justifyContent: 'center',
                  elevation: 8,
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.3,
                  shadowRadius: 8,
                }}
              >
                <FontAwesome name="plus" size={22} color="#fff" />
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
            android_ripple={{ color: active + '30', borderless: true }}
            style={styles.tab}
          >
            <View style={[styles.iconWrap, isActive && styles.iconWrapActive]}>
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
      })}
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
