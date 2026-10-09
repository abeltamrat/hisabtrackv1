import CoinLoader from '@/components/CoinLoader';
import { sessionLocalStorage } from '@/services/SessionStorage';
import { useAppSettings } from '@/contexts/AppSettingsContext';
import { useAuth } from '@/contexts/AuthContext';
import { useI18n } from '@/contexts/I18nContext';
import { useTheme } from '@/contexts/ThemeContext';
import { AppNotificationService } from '@/services/AppNotificationService';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from '@/components/aurora/AuroraGradient';
import { BlurView } from 'expo-blur';
import { useRouter } from 'expo-router';
import React from 'react';
import { Animated, Modal, Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Alert } from '@/utils/alert';
import { useDispatch, useSelector } from 'react-redux';
import { UpdateService, UpdateInfo } from '@/services/UpdateService';
import { AppDispatch, RootState } from '@/store';
import { fetchAccounts } from '@/store/slices/accountsSlice';
import UpdateModal from './UpdateModal';
import { FUNDS_ENABLED } from '@/config/features';

interface DrawerMenuProps {
  visible: boolean;
  onClose: () => void;
}

interface MenuItem {
  id: string;
  title: string;
  icon: string;
  color: string;
  route?: string;
  badge?: number;
}

export default function DrawerMenu({ visible, onClose }: DrawerMenuProps) {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { actualTheme, isAurora } = useTheme();
  const dispatch = useDispatch<AppDispatch>();
  const slideAnim = React.useRef(new Animated.Value(-300)).current;
  const { formatCurrency, fontSize } = useAppSettings();
  const { t } = useI18n();
  const [notificationCount, setNotificationCount] = React.useState(0);
  const [userPhone, setUserPhone] = React.useState<string | null>(null);
  const [, setIsPasswordModalVisible] = React.useState(false);
  const [, setPasswordInput] = React.useState('');
  const [, setIsResetting] = React.useState(false);
  const [, setResetError] = React.useState<string | null>(null);
  const [updateInfo, setUpdateInfo] = React.useState<UpdateInfo | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = React.useState(false);
  const accounts = useSelector((state: RootState) => state.accounts.items);
  const isVerySmall = fontSize === 'V.Small';
  const drawerWidth = isVerySmall ? 300 : 320;
  const closeButtonClass = `absolute ${isVerySmall ? 'top-12 right-3 w-9 h-9' : 'top-14 right-4 w-10 h-10'} bg-white/20 rounded-xl justify-center items-center z-50`;
  const headerUserCardClass = `${isVerySmall ? 'w-14 h-14 mr-3 rounded-xl' : 'w-16 h-16 mr-4 rounded-2xl'} bg-white/20 justify-center items-center`;
  const headerInitialsClass = `text-white ${isVerySmall ? 'text-xl' : 'text-2xl'} font-bold`;
  const headerNameClass = `text-white ${isVerySmall ? 'text-lg' : 'text-xl'} font-bold`;
  const headerEmailClass = `text-primary-100 ${isVerySmall ? 'text-xs' : 'text-sm'}`;
  const summaryCardClass = `bg-white/10 backdrop-blur-lg rounded-2xl ${isVerySmall ? 'p-3 mt-3' : 'p-4 mt-4'}`;
  const summaryLabelClass = `text-primary-100 ${isVerySmall ? 'text-[10px]' : 'text-xs'} mb-1`;
  const summaryValueClass = `text-white ${isVerySmall ? 'text-xl' : 'text-2xl'} font-bold`;
  const sectionWrapperClass = `px-4 ${isVerySmall ? 'py-3' : 'py-4'}`;
  const sectionWrapperMainClass = `px-4 ${isVerySmall ? 'py-4' : 'py-6'}`;
  const sectionTitleClass = `text-slate-500 dark:text-slate-400 ${isVerySmall ? 'text-[10px]' : 'text-xs'} font-bold uppercase mb-3 px-2`;
  // `active:` is a CSS pseudo-class; press feedback comes from activeOpacity.
  const menuItemClass = `flex-row items-center px-4 ${isVerySmall ? 'py-3' : 'py-4'} rounded-2xl mb-2`;
  const menuIconWrapClass = `${isVerySmall ? 'w-9 h-9 mr-3' : 'w-10 h-10 mr-4'} rounded-xl justify-center items-center`;
  const menuTitleClass = `flex-1 text-slate-900 dark:text-white font-semibold ${isVerySmall ? 'text-sm' : 'text-base'}`;
  const menuChevronSize = isVerySmall ? 12 : 14;
  const menuIconSize = isVerySmall ? 16 : 18;
  const destructiveRowClass = `flex-row items-center px-4 ${isVerySmall ? 'py-3' : 'py-4'} rounded-2xl`;
  const destructiveTextClass = `flex-1 font-bold ${isVerySmall ? 'text-sm' : 'text-base'}`;

  // Load notification count and phone
  React.useEffect(() => {
    if (visible) {
      loadNotificationCount();
      if (user?.uid) {
        import('@/services/AuthService').then(({ AuthService }) => {
          AuthService.getUserPhone(user.uid).then(setUserPhone);
        });
      }
    }
  }, [visible, user?.uid]);

  const loadNotificationCount = async () => {
    const count = await AppNotificationService.getUnreadCount();
    setNotificationCount(count);
  };

  const totalBalance = React.useMemo(() => {
    return accounts.reduce((sum, account) => sum + (account.balance || 0), 0);
  }, [accounts]);

  React.useEffect(() => {
    if (visible) {
      if (accounts.length === 0) {
        dispatch(fetchAccounts());
      }

      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: -300,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, dispatch, slideAnim, accounts.length]);

  const menuItems: MenuItem[] = [
    { id: 'dashboard', title: 'Dashboard', icon: 'dashboard', route: '/(tabs)', color: '#6366f1' },
    { id: 'transactions', title: 'Transactions', icon: 'list', route: '/(tabs)/transactions', color: '#8b5cf6' },
    { id: 'sms-transactions', title: 'SMS Transactions', icon: 'commenting', route: '/draft-transactions', color: '#0d9488' },
    { id: 'reports', title: 'Reports & Analytics', icon: 'bar-chart', route: '/(tabs)/reports', color: '#ec4899' },
  ];

  const financeItems: MenuItem[] = [
    { id: 'budget', title: 'Budget Management', icon: 'pie-chart', route: '/budget', color: '#a855f7' },
    { id: 'cards', title: 'Cards & Savings', icon: 'credit-card', route: '/cards', color: '#f59e0b' },
    { id: 'transfer', title: 'Transfer Money', icon: 'exchange', route: '/transfer', color: '#3b82f6' },
    { id: 'categories', title: 'Manage Categories', icon: 'tags', route: '/categories', color: '#10b981' },
    { id: 'loans', title: 'Loans & Debts', icon: 'line-chart', route: '/loans', color: '#ef4444' },
    ...(FUNDS_ENABLED ? [{ id: 'funds', title: 'Funds & Petty Cash', icon: 'briefcase', route: '/funds', color: '#0d9488' }] : []),
    { id: 'recurring', title: 'Recurring Payments', icon: 'refresh', route: '/recurring', color: '#14b8a6' },
    { id: 'community', title: 'Equb & Iddir', icon: 'users', route: '/community', color: '#0d9488' },
  ];

  const toolsItems: MenuItem[] = [
    { id: 'smart-review', title: 'Smart Review', icon: 'shield', route: '/smart-review', color: '#7c3aed' },
    { id: 'sms-learning', title: 'Teach SMS Parser', icon: 'graduation-cap', route: '/manage-sms-rules', color: '#14b8a6' },
    { id: 'ai-assistant', title: 'AI Assistant', icon: 'magic', route: '/aiassistant', color: '#6366f1' },
    { id: 'export', title: 'Export Data', icon: 'download', route: '/export', color: '#06b6d4' },
    { id: 'backup', title: 'Backup & Restore', icon: 'cloud', color: '#14b8a6' },
    { id: 'calculator', title: 'Calculator', icon: 'calculator', route: '/calculator', color: '#f97316' },
    { id: 'goals', title: 'Financial Goals', icon: 'star', route: '/goals', color: '#eab308' },
  ];

  const moreItems: MenuItem[] = [
    { id: 'settings', title: 'Settings', icon: 'cog', color: '#64748b' },
    { id: 'notifications', title: 'Notifications', icon: 'bell', badge: notificationCount > 0 ? notificationCount : undefined, color: '#8b5cf6' },
    { id: 'checkUpdate', title: 'Check for Updates', icon: 'refresh', color: '#10b981' },
    { id: 'help', title: 'Help & Support', icon: 'question-circle', color: '#10b981' },
    { id: 'about', title: 'About HisabTrack', icon: 'info-circle', color: '#6366f1' },
    { id: 'privacy', title: 'Privacy Policy', icon: 'shield', color: '#10b981' },
    { id: 'terms', title: 'Terms of Service', icon: 'file-text', color: '#f59e0b' },
  ];


  const handleNavigate = (route?: string) => {
    if (!route) return;
    onClose();
    setTimeout(() => {
      router.push(route as any);
    }, 300);
  };

  const handleLogout = async () => {
    console.log('Logout button clicked');

    const confirmed = await new Promise<boolean>((resolve) => {
      Alert.alert(
        'Logout',
        'Are you sure you want to logout?',
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Logout', style: 'destructive', onPress: () => resolve(true) },
        ],
        // Dismissing the dialog must settle the promise, or the handler hangs.
        { onDismiss: () => resolve(false) }
      );
    });

    if (!confirmed) {
      console.log('Logout cancelled by user');
      return;
    }

    try {
      console.log('User confirmed logout');
      console.log('Closing drawer...');
      onClose();
      console.log('Calling signOut...');
      await signOut();
      console.log('SignOut complete');
    } catch (error) {
      console.error('Logout error:', error);
      if (Platform.OS === 'web') {
        (window as any).alert('Failed to logout. Please try again.');
      } else {
        Alert.alert('Error', 'Failed to logout. Please try again.');
      }
    }
  };

  const executeReset = async (password: string) => {
    try {
      setIsResetting(true);
      setResetError(null);
      const { AccountResetService } = await import('@/services/AccountResetService');
      await AccountResetService.resetWithPassword(password);

      // Success message
      if (Platform.OS === 'web') {
        (window as any).alert('Account reset successfully! You will now be logged out.');
      } else {
        Alert.alert('Success', 'Account reset successfully! You will now be logged out.');
      }

      // Sign out and redirect
      await signOut();
      router.replace('/(auth)/login');
      setIsPasswordModalVisible(false);
      onClose();

    } catch (error: any) {
      console.error('Reset account error:', error);

      let errorMessage = 'Failed to reset account. ';
      if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
        errorMessage = 'Incorrect password. Please try again.';
      } else if (error.code === 'auth/too-many-requests') {
        errorMessage = 'Too many attempts. Please try again later.';
      } else {
        errorMessage += (error.message || 'Please try again.');
      }

      setResetError(errorMessage);
      if (Platform.OS === 'web') {
        (window as any).alert(errorMessage);
      }
    } finally {
      setIsResetting(false);
    }
  };

  const handleResetAccount = async () => {
    console.log('Reset Account button clicked');

    // First confirmation
    const firstConfirm = Platform.OS === 'web'
      ? (window as any).confirm('⚠️ WARNING: This will permanently delete ALL your data!\n\nThis includes:\n• All transactions\n• All categories\n• All budgets\n• All recurring payments\n• All loans and debts\n• All financial goals\n• All cards and accounts\n\nThis action CANNOT be undone!\n\nAre you sure you want to continue?')
      : await new Promise((resolve) => {
        Alert.alert(
          '⚠️ WARNING',
          'This will permanently delete ALL your data!\n\nThis includes:\n• All transactions\n• All categories\n• All budgets\n• All recurring payments\n• All loans and debts\n• All financial goals\n• All cards and accounts\n\nThis action CANNOT be undone!\n\nAre you sure you want to continue?',
          [
            {
              text: 'Cancel',
              style: 'cancel',
              onPress: () => resolve(false),
            },
            {
              text: 'Continue',
              style: 'destructive',
              onPress: () => resolve(true),
            },
          ]
        );
      });

    if (!firstConfirm) {
      console.log('Reset cancelled by user');
      return;
    }

    if (Platform.OS === 'web') {
      const password = (window as any).prompt('Please enter your password to confirm:');
      if (password) {
        await executeReset(password);
      }
    } else {
      setPasswordInput('');
      setResetError(null);
      setIsPasswordModalVisible(true);
    }
  };

  const handleCheckForUpdates = async () => {
    setIsCheckingUpdate(true);
    try {
      const info = await UpdateService.checkForUpdate();
      if (info) {
        setUpdateInfo(info);
        onClose(); // Close drawer to show update modal
      } else {
        Alert.alert('Up to Date', 'You are using the latest version!');
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to check for updates. Please try again later.');
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  // Get user initials for avatar
  const getUserInitials = () => {
    if (user?.displayName) {
      return user.displayName
        .split(' ')
        .map(n => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    }
    if (user?.email) {
      return user.email.slice(0, 2).toUpperCase();
    }
    return 'U';
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View className="flex-1 bg-black/50">
        {/* Backdrop - tap to close */}
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close menu"
          activeOpacity={1}
          onPress={onClose}
          className="absolute inset-0"
        />

        {/* Drawer */}
        <Animated.View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: drawerWidth,
            transform: [{ translateX: slideAnim }],
            backgroundColor: isAurora ? 'rgba(15,23,42,0.94)' : actualTheme === 'dark' ? '#0f172a' : '#ffffff',
            shadowColor: '#000',
            shadowOffset: { width: 2, height: 0 },
            shadowOpacity: 0.25,
            shadowRadius: 8,
            elevation: 8,
            overflow: 'hidden',
          }}
        >
          {isAurora && (
            <BlurView intensity={36} tint="dark" pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
          )}
          {/* Close Button */}
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Close menu"
            onPress={onClose}
            className={closeButtonClass}
          >
            <FontAwesome name="times" size={isVerySmall ? 16 : 18} color="#fff" />
          </TouchableOpacity>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ flexGrow: 1 }}
            showsVerticalScrollIndicator={false}
          >
            {/* Header */}
            <LinearGradient
              colors={actualTheme === 'dark' ? ['#1e293b', '#0f172a'] : ['#4f46e5', '#4338ca']}
              className={`px-6 pt-16 ${isVerySmall ? 'pb-6' : 'pb-8'}`}
            >
              <View className="flex-row items-center mb-4">
                <View className={headerUserCardClass}>
                  <Text className={headerInitialsClass}>{getUserInitials()}</Text>
                </View>
                <View className="flex-1">
                  <Text className={headerNameClass}>
                    {user?.displayName || 'User'}
                  </Text>
                  <Text className={headerEmailClass}>
                    {user?.email || 'user@example.com'}
                  </Text>
                  {userPhone && (
                    <View className="flex-row items-center mt-1 gap-1">
                      <FontAwesome name="link" size={isVerySmall ? 10 : 11} color="rgba(199,210,254,0.8)" />
                      <Text className={`${headerEmailClass} ml-1`}>{userPhone}</Text>
                    </View>
                  )}
                </View>
              </View>

              {/* Balance Summary */}
              <View className={summaryCardClass}>
                <Text className={summaryLabelClass}>{t('totalBalance')}</Text>
                <Text className={summaryValueClass}>
                  {formatCurrency(totalBalance)}
                </Text>
              </View>
            </LinearGradient>

            {/* Main Navigation */}
            <View className={sectionWrapperMainClass}>
              <Text className={sectionTitleClass}>
                {t('mainMenu')}
              </Text>
              {menuItems.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  onPress={() => handleNavigate(item.route)}
                  className={menuItemClass}
                >
                  <View className={menuIconWrapClass} style={{ backgroundColor: item.color + '20' }}>
                    <FontAwesome name={item.icon as any} size={menuIconSize} color={item.color} />
                  </View>
                  <Text className={menuTitleClass}>
                    {item.title}
                  </Text>
                  <FontAwesome name="chevron-right" size={menuChevronSize} color="#94a3b8" />
                </TouchableOpacity>
              ))}
            </View>

            {/* Divider */}
            <View className="h-px bg-slate-200 dark:bg-slate-800 mx-6 my-2" />

            {/* Finance Management */}
            <View className={sectionWrapperClass}>
              <Text className={sectionTitleClass}>
                {t('financeManagement')}
              </Text>
              {financeItems.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  onPress={() => item.route ? handleNavigate(item.route) : null}
                  className={menuItemClass}
                >
                  <View className={menuIconWrapClass} style={{ backgroundColor: item.color + '20' }}>
                    <FontAwesome name={item.icon as any} size={menuIconSize} color={item.color} />
                  </View>
                  <Text className={menuTitleClass}>
                    {item.title}
                  </Text>
                  <FontAwesome name="chevron-right" size={menuChevronSize} color="#94a3b8" />
                </TouchableOpacity>
              ))}
            </View>

            {/* Divider */}
            <View className="h-px bg-slate-200 dark:bg-slate-800 mx-6 my-2" />

            {/* Tools & Features */}
            <View className={sectionWrapperClass}>
              <Text className={sectionTitleClass}>
                {t('toolsFeatures')}
              </Text>
              {toolsItems.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  onPress={() => item.route ? handleNavigate(item.route) : null}
                  className={menuItemClass}
                >
                  <View className={menuIconWrapClass} style={{ backgroundColor: item.color + '20' }}>
                    <FontAwesome name={item.icon as any} size={menuIconSize} color={item.color} />
                  </View>
                  <Text className={menuTitleClass}>
                    {item.title}
                  </Text>
                  <FontAwesome name="chevron-right" size={menuChevronSize} color="#94a3b8" />
                </TouchableOpacity>
              ))}
            </View>

            {/* Divider */}
            <View className="h-px bg-slate-200 dark:bg-slate-800 mx-6 my-2" />

            {/* More */}
            <View className={sectionWrapperClass}>
              <Text className={sectionTitleClass}>
                {t('more')}
              </Text>
              {moreItems.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  onPress={() => {
                    if (item.id === 'settings') {
                      handleNavigate('/settings');
                    } else if (item.id === 'notifications') {
                      handleNavigate('/notifications');
                    } else if (item.id === 'checkUpdate') {
                      handleCheckForUpdates();
                    } else if (item.id === 'help') {
                      handleNavigate('/help');
                    } else if (item.id === 'about') {
                      handleNavigate('/about');
                    } else if (item.id === 'privacy') {
                      handleNavigate('/privacy');
                    } else if (item.id === 'terms') {
                      handleNavigate('/terms');
                    }
                  }}
                  className={menuItemClass}
                >
                  <View className={menuIconWrapClass} style={{ backgroundColor: item.color + '20' }}>
                    <FontAwesome name={item.icon as any} size={menuIconSize} color={item.color} />
                  </View>
                  <Text className={menuTitleClass}>
                    {item.title}
                  </Text>
                  {item.badge ? (
                    <View className={`bg-red-500 ${isVerySmall ? 'px-1.5 py-0.5' : 'px-2 py-1'} rounded-full mr-2`}>
                      <Text className={`text-white font-bold ${isVerySmall ? 'text-[10px]' : 'text-xs'}`}>{item.badge}</Text>
                    </View>
                  ) : item.id === 'checkUpdate' && isCheckingUpdate ? (
                    <CoinLoader size="small" color="#10b981" />
                  ) : (
                    <FontAwesome name="chevron-right" size={menuChevronSize} color="#94a3b8" />
                  )}
                </TouchableOpacity>
              ))}
            </View>

            {/* Divider */}
            <View className="h-px bg-slate-200 dark:bg-slate-800 mx-6 my-2" />

            {/* Logout */}
            <View className={`px-4 ${isVerySmall ? 'py-3 pb-6' : 'py-4 pb-8'}`}>
              <TouchableOpacity
                onPress={handleLogout}
                className={`${destructiveRowClass} bg-red-50 dark:bg-red-900/30`}
              >
                <View className={`${menuIconWrapClass} bg-red-100 dark:bg-red-900/50`}>
                  <FontAwesome name="sign-out" size={menuIconSize} color="#ef4444" />
                </View>
                <Text className={`${destructiveTextClass} text-red-600 dark:text-red-400`}>
                  {t('logout')}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Version */}
            <View className="px-6 pb-6">
              <Text className={`text-slate-500 ${isVerySmall ? 'text-[10px]' : 'text-xs'} text-center dark:text-slate-400`}>
                HisabTrack v1.0.0
              </Text>
            </View>
          </ScrollView>
        </Animated.View>
      </View>

      {/* Update Modal */}
      <UpdateModal
        visible={!!updateInfo}
        updateInfo={updateInfo}
        onClose={() => setUpdateInfo(null)}
      />
    </Modal>
  );
}
