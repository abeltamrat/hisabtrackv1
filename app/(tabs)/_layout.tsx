import { useAuth } from '@/contexts/AuthContext';
import CustomTabBar from '@/components/CustomTabBar';
import { Redirect, Tabs } from 'expo-router';
import React from 'react';
import { ActivityIndicator, View } from 'react-native';

export default function TabLayout() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  if (!user) {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <Tabs
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index"        options={{ title: 'Home' }} />
      <Tabs.Screen name="transactions" options={{ title: 'Txns' }} />
      <Tabs.Screen name="reports"      options={{ title: 'Reports' }} />
    </Tabs>
  );
}
