import { useAuth } from '@/contexts/AuthContext';
import { AppNotification, AppNotificationService } from '@/services/AppNotificationService';
import LocalChangeEmitter from '@/services/LocalChangeEmitter';
import SyncService from '@/services/SyncService';
import { FontAwesome } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DrawerMenu from './DrawerMenu';

const HEADER_HEIGHT = 56;

interface AppShellProps {
  children: React.ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  const [drawerVisible, setDrawerVisible] = React.useState(false);
  const router = useRouter();
  const { user } = useAuth();

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
    loadNotifications();
    const unsub = LocalChangeEmitter.subscribe(() => {
      loadNotifications();
    });
    return () => {
      if (unsub) unsub();
    };
  }, []);

  const retrySync = () => {
    SyncService.disableAutoSyncUntil = 0;
    SyncService.consecutiveNativeErrors = 0;
    if (user?.uid) {
      try { SyncService.startAutoSync(user.uid); } catch (e) { console.error('retrySync: startAutoSync failed', e); }
    }
    setDisabledUntil(0);
  };

  const handleNotificationPress = async (n: AppNotification) => {
    await AppNotificationService.markAsRead(n.id);
    setShowPreview(false);

    // Cast to any to avoid strict route checking errors
    if (n.actionType === 'view_loans') router.push('/loans' as any);
    else if (n.actionType === 'view_budget') router.push('/budgets' as any);
    else if (n.actionType === 'view_recurring') router.push('/recurring' as any);
    else if (n.actionType === 'view_reports') router.push('/reports' as any);
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
        style={{
          height: HEADER_HEIGHT,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 12,
          backgroundColor: '#ffffff',
          borderBottomWidth: 1,
          borderBottomColor: '#e6e6e6',
          zIndex: 2000,
        }}
      >
        <TouchableOpacity onPress={() => setDrawerVisible(true)} style={{ padding: 8 }}>
          <FontAwesome name="bars" size={20} color="#111827" />
        </TouchableOpacity>

        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: '#111827' }}>Hisab Track</Text>
        </View>

        <TouchableOpacity onPress={togglePreview} style={{ padding: 8, position: 'relative' }}>
          <FontAwesome name="bell-o" size={20} color="#111827" />
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

          <View style={{
            position: 'absolute',
            top: HEADER_HEIGHT + 4,
            right: 12,
            width: 300,
            backgroundColor: 'white',
            borderRadius: 16,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.15,
            shadowRadius: 12,
            elevation: 8,
            zIndex: 2002, // On top of backdrop
            borderWidth: 1,
            borderColor: '#f1f5f9',
          }}>
            <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }}>
              <Text style={{ fontWeight: 'bold', fontSize: 16, color: '#1e293b' }}>Notifications</Text>
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
                    style={{
                      padding: 12,
                      borderBottomWidth: 1,
                      borderBottomColor: '#f8fafc',
                      backgroundColor: notification.read ? 'white' : '#f8fafc'
                    }}
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
                        <Text style={{ fontWeight: '600', color: '#334155', marginBottom: 2 }} numberOfLines={1}>
                          {notification.title}
                        </Text>
                        <Text style={{ color: '#64748b', fontSize: 12 }} numberOfLines={2}>
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
              style={{ padding: 12, alignItems: 'center', backgroundColor: '#f8fafc', borderBottomLeftRadius: 16, borderBottomRightRadius: 16 }}
            >
              <Text style={{ color: '#4f46e5', fontWeight: 'bold', fontSize: 14 }}>See all notifications</Text>
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

      <DrawerMenu visible={drawerVisible} onClose={() => setDrawerVisible(false)} />
    </SafeAreaView>
  );
}
