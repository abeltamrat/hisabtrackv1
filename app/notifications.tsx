import { useTheme } from '@/contexts/ThemeContext';
import { AppNotification, AppNotificationService } from '@/services/AppNotificationService';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View
} from 'react-native';


export default function NotificationsScreen() {
  const router = useRouter();
  const { actualTheme } = useTheme();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadNotifications();
  }, []);

  const loadNotifications = async () => {
    const data = await AppNotificationService.getNotifications();
    setNotifications(data);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await loadNotifications();
    } finally {
      setRefreshing(false);
    }
  };

  const handleMarkAsRead = async (id: string) => {
    await AppNotificationService.markAsRead(id);
    await loadNotifications();
  };

  const handleDelete = async (id: string, title: string) => {
    Alert.alert(
      'Delete Notification',
      `Delete "${title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await AppNotificationService.deleteNotification(id);
              await loadNotifications();
            } catch {
              Alert.alert('Error', 'Failed to delete notification.');
            }
          },
        },
      ]
    );
  };

  const handleMarkAllRead = async () => {
    await AppNotificationService.markAllAsRead();
    await loadNotifications();
  };

  const handleClearAll = () => {
    Alert.alert(
      'Clear All Notifications',
      'Are you sure you want to clear all notifications?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            try {
              await AppNotificationService.clearAll();
              await loadNotifications();
            } catch {
              Alert.alert('Error', 'Failed to clear notifications.');
            }
          },
        },
      ]
    );
  };

  const handleNotificationAction = async (notification: AppNotification) => {
    await handleMarkAsRead(notification.id);

    if (notification.actionType === 'view_transactions') {
      router.push('/(tabs)/transactions');
    } else if (notification.actionType === 'view_budget') {
      router.push('/budget');
    } else if (notification.actionType === 'view_reports') {
      router.push('/(tabs)/reports');
    } else if (notification.actionType === 'view_loans') {
      router.push('/loans');
    } else if (notification.actionType === 'view_recurring') {
      router.push('/recurring');
    } else if (notification.actionType === 'view_drafts') {
      router.push('/draft-transactions');
    }
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <View className="flex-1 bg-slate-50 dark:bg-background-dark">
      <StatusBar style="auto" />

      {/* Header */}
      <LinearGradient
        colors={actualTheme === 'dark' ? ['#334155', '#1e293b'] : ['#6366f1', '#4f46e5']}
        className="px-6 pt-6 pb-8 rounded-b-[32px]"
      >
        <View className="flex-row items-center justify-between mb-4">
          <TouchableOpacity
            onPress={() => router.back()}
            className="w-10 h-10 bg-white/20 rounded-xl justify-center items-center"
          >
            <FontAwesome name="arrow-left" size={18} color="#fff" />
          </TouchableOpacity>

          <Text className="text-white text-2xl font-bold flex-1 text-center">
            Notifications
          </Text>

          <View className="w-10" />
        </View>

        {/* Stats */}
        <View className="flex-row justify-around">
          <View className="items-center">
            <Text className="text-white/80 text-xs">Total</Text>
            <Text className="text-white text-2xl font-bold">{notifications.length}</Text>
          </View>
          <View className="items-center">
            <Text className="text-white/80 text-xs">Unread</Text>
            <Text className="text-white text-2xl font-bold">{unreadCount}</Text>
          </View>
        </View>
      </LinearGradient>

      {/* Actions */}
      {notifications.length > 0 && (
        <View className="flex-row px-6 py-4 gap-3">
          {unreadCount > 0 && (
            <TouchableOpacity
              onPress={handleMarkAllRead}
              className="flex-1 bg-blue-500 py-3 rounded-xl"
            >
              <Text className="text-white text-center font-semibold text-sm">
                Mark All Read
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={handleClearAll}
            className="flex-1 bg-red-500 py-3 rounded-xl"
          >
            <Text className="text-white text-center font-semibold text-sm">
              Clear All
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Notifications List */}
      <ScrollView
        className="flex-1 px-6"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      >
        {notifications.length === 0 ? (
          <View className="flex-1 justify-center items-center py-20">
            <FontAwesome name="bell-slash" size={64} color="#cbd5e1" />
            <Text className="text-slate-400 text-lg mt-4">No notifications</Text>
            <Text className="text-slate-300 text-sm text-center mt-2 px-8">
              You're all caught up! New notifications will appear here.
            </Text>
          </View>
        ) : (
          notifications.map((notification) => (
            <TouchableOpacity
              key={notification.id}
              onPress={() => handleNotificationAction(notification)}
              className={`mb-3 rounded-2xl overflow-hidden ${!notification.read ? 'border-2 border-blue-500' : ''
                }`}
            >
              <LinearGradient
                colors={
                  actualTheme === 'dark'
                    ? ['#1e293b', '#0f172a']
                    : ['#ffffff', '#f8fafc']
                }
                className="p-4"
              >
                <View className="flex-row items-start">
                  {/* Icon */}
                  <View
                    className="w-12 h-12 rounded-xl justify-center items-center mr-3"
                    style={{ backgroundColor: notification.color + '20' }}
                  >
                    <FontAwesome
                      name={notification.icon as any}
                      size={20}
                      color={notification.color}
                    />
                  </View>
                  <View className="flex-1">
                    <View className="flex-row items-center justify-between mb-1">
                      <Text className="text-slate-900 dark:text-white font-bold text-base flex-1">
                        {notification.title}
                      </Text>
                      {!notification.read && (
                        <View className="w-3 h-3 bg-blue-500 rounded-full ml-2" />
                      )}
                    </View>
                    <Text className="text-slate-600 dark:text-slate-300 text-sm mb-2">
                      {notification.message}
                    </Text>
                    <Text className="text-slate-400 text-xs">
                      {new Date(notification.timestamp).toLocaleString()}
                    </Text>
                  </View>

                  {/* Delete Button */}
                  <TouchableOpacity
                    onPress={() => handleDelete(notification.id, notification.title)}
                    className="ml-2 w-8 h-8 bg-red-50 dark:bg-red-900/30 rounded-lg justify-center items-center"
                  >
                    <FontAwesome name="trash" size={14} color="#ef4444" />
                  </TouchableOpacity>
                </View>
              </LinearGradient>
            </TouchableOpacity>
          ))
        )}

        <View className="h-8" />
      </ScrollView>
    </View>
  );
}
