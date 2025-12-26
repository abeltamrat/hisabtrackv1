import { FontAwesome } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { Alert, Platform, Text, TouchableOpacity, View } from 'react-native';


export default function SMSPermissionsScreen() {
  const router = useRouter();
  const [hasPermission, setHasPermission] = useState(false);

  const requestSMSPermission = async () => {
    if (Platform.OS !== 'android') {
      Alert.alert('Not Available', 'SMS reading is only available on Android devices.');
      return;
    }

    try {
      // In a real app, you would use expo-sms or react-native-permissions here
      // For now, we'll simulate the permission request
      Alert.alert(
        'SMS Permission Required',
        'This app needs permission to read SMS messages to automatically track your transactions from bank notifications.',
        [
          {
            text: 'Cancel',
            style: 'cancel',
          },
          {
            text: 'Grant Permission',
            onPress: () => {
              setHasPermission(true);
              Alert.alert('Success', 'SMS permission granted!', [
                {
                  text: 'Continue',
                  onPress: () => router.replace('/(tabs)'),
                },
              ]);
            },
          },
        ]
      );
    } catch (error) {
      console.error('Error requesting SMS permission:', error);
      Alert.alert('Error', 'Failed to request SMS permission.');
    }
  };

  const skipPermission = () => {
    router.replace('/(tabs)');
  };

  return (
    <View className="flex-1 bg-background-light dark:bg-background-dark">
      <StatusBar style="dark" />
      <View className="flex-1 justify-center px-6">
        <View className="items-center mb-12">
          <View className="w-24 h-24 bg-primary-100 rounded-full justify-center items-center mb-6">
            <FontAwesome name="envelope" size={48} color="#6366f1" />
          </View>
          <Text className="text-3xl font-bold text-text-light dark:text-text-dark text-center mb-4">
            Auto-Track Transactions
          </Text>
          <Text className="text-base text-text-muted text-center">
            Allow HisabTrack to read SMS messages and automatically track your transactions from bank notifications.
          </Text>
        </View>

        <View className="bg-surface-light dark:bg-surface-dark p-6 rounded-3xl shadow-sm elevation-4 mb-6">
          <View className="flex-row items-start mb-4">
            <View className="w-8 h-8 bg-secondary-100 rounded-full justify-center items-center mr-4">
              <FontAwesome name="check" size={14} color="#0d9488" />
            </View>
            <View className="flex-1">
              <Text className="text-text-light dark:text-text-dark font-bold text-base mb-1">
                Automatic Tracking
              </Text>
              <Text className="text-text-muted text-sm">
                Transactions are automatically detected from bank SMS messages.
              </Text>
            </View>
          </View>

          <View className="flex-row items-start mb-4">
            <View className="w-8 h-8 bg-secondary-100 rounded-full justify-center items-center mr-4">
              <FontAwesome name="check" size={14} color="#0d9488" />
            </View>
            <View className="flex-1">
              <Text className="text-text-light dark:text-text-dark font-bold text-base mb-1">
                Smart Categorization
              </Text>
              <Text className="text-text-muted text-sm">
                Transactions are automatically categorized based on merchant names.
              </Text>
            </View>
          </View>

          <View className="flex-row items-start">
            <View className="w-8 h-8 bg-secondary-100 rounded-full justify-center items-center mr-4">
              <FontAwesome name="lock" size={14} color="#0d9488" />
            </View>
            <View className="flex-1">
              <Text className="text-text-light dark:text-text-dark font-bold text-base mb-1">
                Privacy First
              </Text>
              <Text className="text-text-muted text-sm">
                SMS messages are processed locally on your device. No data is sent to external servers.
              </Text>
            </View>
          </View>
        </View>

        <TouchableOpacity
          className="bg-primary-500 h-14 rounded-xl justify-center items-center shadow-lg shadow-primary-500/30 elevation-4 mb-4"
          onPress={requestSMSPermission}
        >
          <Text className="text-white text-lg font-bold">Enable Auto-Tracking</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={skipPermission} className="items-center py-3">
          <Text className="text-text-muted text-sm font-semibold">Skip for now</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
