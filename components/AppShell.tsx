import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { AppNotification, AppNotificationService } from '@/services/AppNotificationService';
import LocalChangeEmitter from '@/services/LocalChangeEmitter';
import NativeErrorReporter from '@/services/NativeErrorReporter';
import RemotePushService from '@/services/RemotePushService';
import SyncService from '@/services/SyncService';
import { FontAwesome } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DrawerMenu from './DrawerMenu';
import FinanceAssistantOverlay from './FinanceAssistantOverlay';

const HEADER_HEIGHT = 56;

interface AppShellProps {
  children: React.ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  const [drawerVisible, setDrawerVisible] = React.useState(false);
  const router = useRouter();
  const { user } = useAuth();
  const { actualTheme } = useTheme();

  const [disabledUntil, setDisabledUntil] = useState<number>(SyncService.disableAutoSyncUntil || 0);

  // Notification State
  const [unreadCount, setUnreadCount] = useState(0);
  const [aiUnreadCount, setAiUnreadCount] = useState(0);
  const [regularUnreadCount, setRegularUnreadCount] = useState(0);
  const [recentNotifications, setRecentNotifications] = useState<AppNotification[]>([]);
  const [showPreview, setShowPreview] = useState(false);

  const loadNotifications = async () => {
    const totalCount = await AppNotificationService.getUnreadCount();
    const aiCount = await AppNotificationService.getAIUnreadCount();
    const regularCount = await AppNotificationService.getRegularUnreadCount();
    setUnreadCount(totalCount);
    setAiUnreadCount(aiCount);
    setRegularUnreadCount(regularCount);
    const all = await AppNotificationService.getNotifications();
    setRecentNotifications(all.slice(0, 3));
  };

  useEffect(() => {
    const iv = setInterval(() => {
      setDisabledUntil(SyncService.disableAutoSyncUntil || 0);
    }, 2000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (!user?.uid) return;

    void RemotePushService.markCurrentDeviceSeen(user.uid);

    const interval = setInterval(() => {
      void RemotePushService.markCurrentDeviceSeen(user.uid);
    }, 15 * 60 * 1000);

    return () => clearInterval(interval);
  }, [user?.uid]);

  useEffect(() => {
    loadNotifications();
    const unsub = LocalChangeEmitter.subscribe(() => {
      loadNotifications();
    });
    return () => {
      if (unsub) unsub();
    };
  }, []);

  const retrySync = async () => {
    NativeErrorReporter.reset();
    SyncService.disableAutoSyncUntil = 0;
    SyncService.consecutiveNativeErrors = 0;
    SyncService.stopAutoSync(); // clear currentUid so startAutoSync sets up fresh subscriptions
    if (user?.uid) {
      try {
        await SyncService.syncNow(user.uid);
      } catch (e) {
        console.error('retrySync: syncNow failed', e);
      }
      try {
        SyncService.startAutoSync(user.uid);
      } catch (e) {
        console.error('retrySync: startAutoSync failed', e);
      }
    }
    setDisabledUntil(0);
  };

  const handleNotificationPress = async (n: AppNotification) => {
    await AppNotificationService.markAsRead(n.id);
    setShowPreview(false);

    // Cast to any to avoid strict route checking errors
    if (n.actionType === 'view_loans') router.push('/loans' as any);
    else if (n.actionType === 'view_budget') router.push('/budget' as any);
    else if (n.actionType === 'view_recurring') router.push('/recurring' as any);
    else if (n.actionType === 'view_reports') router.push('/reports' as any);
    else if (n.actionType === 'view_drafts') router.push('/draft-transactions' as any);
    else router.push('/notifications' as any);
  };

  const handleSeeAll = () => {
    setShowPreview(false);
    router.push('/notifications' as any);
  };

  const togglePreview = () => {
    setShowPreview(!showPreview);
  };

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
      {/* Top App Bar */}
      <View
        className="flex-row items-center justify-between px-3 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800"
        style={{
          height: HEADER_HEIGHT,
          zIndex: 2000,
        }}
      >
        <TouchableOpacity onPress={() => setDrawerVisible(true)} style={{ padding: 8 }}>
          <FontAwesome name="bars" size={20} color={actualTheme === 'dark' ? '#fff' : '#111827'} />
        </TouchableOpacity>

        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text className="text-base font-bold text-slate-900 dark:text-white">Hisab Track</Text>
        </View>

        <TouchableOpacity onPress={togglePreview} style={{ padding: 8, position: 'relative' }}>
          <FontAwesome name="bell-o" size={20} color={actualTheme === 'dark' ? '#fff' : '#111827'} />
          {aiUnreadCount > 0 && (
            <View style={{
              position: 'absolute',
              top: 4,
              right: 4,
              backgroundColor: '#3b82f6',
              borderRadius: 10,
              minWidth: 16,
              height: 16,
              justifyContent: 'center',
              alignItems: 'center',
              paddingHorizontal: 3,
            }}>
              <Text style={{ color: 'white', fontSize: 10, fontWeight: 'bold' }}>
                {aiUnreadCount > 9 ? '9+' : aiUnreadCount}
              </Text>
            </View>
          )}
          {regularUnreadCount > 0 && (
            <View style={{
              position: 'absolute',
              top: 4,
              right: aiUnreadCount > 0 ? 20 : 4,
              backgroundColor: '#ef4444',
              borderRadius: 10,
              minWidth: 16,
              height: 16,
              justifyContent: 'center',
              alignItems: 'center',
              paddingHorizontal: 3,
            }}>
              <Text style={{ color: 'white', fontSize: 10, fontWeight: 'bold' }}>
                {regularUnreadCount > 9 ? '9+' : regularUnreadCount}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Notification Preview Overlay */}
      {showPreview && (
        <>
          {/* Transparent backdrop to close on click outside */}
          <TouchableWithoutFeedback onPress={() => setShowPreview(false)}>
            <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, zIndex: 2001, backgroundColor: 'transparent' }} />
          </TouchableWithoutFeedback>

          <View
            className="absolute right-3 w-[300px] bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-100 dark:border-slate-700"
            style={{
              top: HEADER_HEIGHT + 4,
              elevation: 8,
              zIndex: 2002,
            }}
          >
            <View className="p-4 border-b border-slate-100 dark:border-slate-700">
              <Text className="font-bold text-base text-slate-900 dark:text-white">Notifications</Text>
            </View>

            {recentNotifications.length === 0 ? (
              <View style={{ padding: 24, alignItems: 'center' }}>
                <Text style={{ color: '#94a3b8' }}>No notifications</Text>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 300 }}>
                {recentNotifications.map(notification => (
                  <TouchableOpacity
                    key={notification.id}
                    className={`p-3 border-b border-slate-50 dark:border-slate-700/50 ${notification.read ? 'bg-white dark:bg-slate-800' : 'bg-slate-50 dark:bg-slate-700/30'
                      }`}
                    onPress={() => handleNotificationPress(notification)}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                      <View style={{
                        width: 32,
                        height: 32,
                        borderRadius: 16,
                        backgroundColor: notification.color + '20',
                        justifyContent: 'center',
                        alignItems: 'center',
                        marginRight: 12,
                      }}>
                        <FontAwesome name={notification.icon as any} size={14} color={notification.color} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text className="font-semibold text-slate-800 dark:text-slate-200 mb-0.5" numberOfLines={1}>
                          {notification.title}
                        </Text>
                        <Text className="text-slate-500 dark:text-slate-400 text-xs" numberOfLines={2}>
                          {notification.message}
                        </Text>
                        <Text style={{ color: '#94a3b8', fontSize: 10, marginTop: 4 }}>
                          {new Date(notification.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                      </View>
                      {!notification.read && (
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#ef4444', marginTop: 6 }} />
                      )}
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            <TouchableOpacity
              onPress={handleSeeAll}
              className="p-3 items-center bg-slate-50 dark:bg-slate-700/50 rounded-b-2xl"
            >
              <Text className="text-indigo-600 dark:text-indigo-400 font-bold text-sm">See all notifications</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* Persistent banner when auto-sync is disabled due to native DB errors */}
      {disabledUntil && disabledUntil > Date.now() ? (
        <View style={{ backgroundColor: '#fee2e2', padding: 8, borderBottomWidth: 1, borderBottomColor: '#fecaca' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: '#991b1b', flex: 1 }}>
              Auto-sync disabled due to repeated local database errors. Retry after {new Date(disabledUntil).toLocaleTimeString()}.
            </Text>
            <TouchableOpacity onPress={retrySync} style={{ padding: 8, marginLeft: 8 }}>
              <Text style={{ color: '#991b1b', fontWeight: '700' }}>Retry now</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {/* Page content - pushed below header */}
      <View style={{ flex: 1, zIndex: 1 }}>
        <View style={{ marginTop: 0, flex: 1 }}>{children}</View>
      </View>

      <FinanceAssistantOverlay hidden={drawerVisible} />

      <DrawerMenu visible={drawerVisible} onClose={() => setDrawerVisible(false)} />
    </SafeAreaView>
  );
}
