import { useAppSettings } from '@/contexts/AppSettingsContext';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { Dimensions, ScrollView, Text, TouchableOpacity, View } from 'react-native';


const { width } = Dimensions.get('window');
const cardWidth = width - 48;

export default function CardsScreen() {
  const router = useRouter();
  const { formatCurrency } = useAppSettings();
  const [selectedCard, setSelectedCard] = useState(0);

  const cards = [
    {
      id: '1',
      name: 'Premium Visa',
      number: '4532 **** **** 1234',
      holder: 'John Doe',
      expiry: '12/25',
      balance: 5420.50,
      limit: 10000,
      type: 'credit',
      color: ['#6366f1', '#8b5cf6'],
      network: 'visa',
    },
    {
      id: '2',
      name: 'Gold Mastercard',
      number: '5412 **** **** 5678',
      holder: 'John Doe',
      expiry: '08/26',
      balance: 3200.00,
      limit: 8000,
      type: 'credit',
      color: ['#f59e0b', '#ea580c'],
      network: 'mastercard',
    },
    {
      id: '3',
      name: 'Business Card',
      number: '3782 **** **** 9012',
      holder: 'John Doe',
      expiry: '03/27',
      balance: 12500.00,
      limit: 20000,
      type: 'credit',
      color: ['#10b981', '#14b8a6'],
      network: 'amex',
    },
  ];

  const card = cards[selectedCard];
  const usagePercentage = (card.balance / card.limit) * 100;

  return (
    <View className="flex-1 bg-slate-50 dark:bg-background-dark">
      <StatusBar style="auto" />

      {/* Header */}
      <View className="px-6 pt-6 pb-4">
        <View className="flex-row justify-between items-center">
          <TouchableOpacity onPress={() => router.back()} className="w-10 h-10 bg-white dark:bg-slate-800 rounded-xl justify-center items-center shadow-sm">
            <FontAwesome name="arrow-left" size={18} color="#64748b" />
          </TouchableOpacity>
          <Text className="text-slate-900 dark:text-white text-xl font-bold">My Cards</Text>
          <TouchableOpacity className="w-10 h-10 bg-white dark:bg-slate-800 rounded-xl justify-center items-center shadow-sm">
            <FontAwesome name="plus" size={18} color="#64748b" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* Card Carousel */}
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => {
            const page = Math.round(e.nativeEvent.contentOffset.x / cardWidth);
            setSelectedCard(page);
          }}
          className="mb-6"
        >
          {cards.map((cardItem, index) => (
            <View key={cardItem.id} className="px-6 py-4" style={{ width: cardWidth + 48 }}>
              <LinearGradient
                colors={cardItem.color as any}
                className="rounded-3xl p-6 shadow-2xl"
                style={{
                  width: cardWidth,
                  height: 200,
                  elevation: 8,
                }}
              >
                {/* Card Header */}
                <View className="flex-row justify-between items-center mb-8">
                  <View className="bg-white/20 px-3 py-1.5 rounded-lg">
                    <Text className="text-white text-xs font-bold">{cardItem.name}</Text>
                  </View>
                  <View className="bg-white/20 w-10 h-10 rounded-full justify-center items-center">
                    <FontAwesome name="credit-card" size={18} color="#fff" />
                  </View>
                </View>

                {/* Card Number */}
                <Text className="text-white text-xl font-bold mb-6 tracking-wider">
                  {cardItem.number}
                </Text>

                {/* Card Details */}
                <View className="flex-row justify-between items-end">
                  <View>
                    <Text className="text-white/70 text-xs mb-1">Card Holder</Text>
                    <Text className="text-white text-sm font-bold">{cardItem.holder}</Text>
                  </View>
                  <View>
                    <Text className="text-white/70 text-xs mb-1">Expires</Text>
                    <Text className="text-white text-sm font-bold">{cardItem.expiry}</Text>
                  </View>
                  <View className="bg-white/20 px-3 py-2 rounded-lg">
                    <Text className="text-white text-xs font-bold uppercase">{cardItem.network}</Text>
                  </View>
                </View>
              </LinearGradient>
            </View>
          ))}
        </ScrollView>

        {/* Pagination Dots */}
        <View className="flex-row justify-center mb-6">
          {cards.map((_, index) => (
            <View
              key={index}
              className={`h-2 rounded-full mx-1 ${index === selectedCard ? 'w-6 bg-primary-500' : 'w-2 bg-slate-300 dark:bg-slate-700'
                }`}
            />
          ))}
        </View>

        {/* Card Stats */}
        <View className="px-6 mb-6">
          <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 shadow-lg border border-slate-100 dark:border-slate-700" style={{ elevation: 4 }}>
            <View className="flex-row justify-between items-center mb-4">
              <Text className="text-slate-900 dark:text-white text-base font-bold">Card Usage</Text>
              <View className="bg-blue-50 dark:bg-blue-900/30 px-3 py-1.5 rounded-full">
                <Text className="text-blue-600 dark:text-blue-400 text-xs font-bold">{usagePercentage.toFixed(1)}%</Text>
              </View>
            </View>

            {/* Progress Bar */}
            <View className="mb-4">
              <View className="flex-row justify-between mb-2">
                <Text className="text-slate-500 dark:text-slate-400 text-sm">Balance</Text>
                <Text className="text-slate-900 dark:text-white text-sm font-bold">{formatCurrency(card.balance)}</Text>
              </View>
              <View className="bg-slate-100 dark:bg-slate-900 h-3 rounded-full overflow-hidden">
                <View
                  className="h-full rounded-full"
                  style={{
                    width: `${usagePercentage}%`,
                    backgroundColor: usagePercentage > 80 ? '#ef4444' : '#6366f1',
                  }}
                />
              </View>
              <View className="flex-row justify-between mt-2">
                <Text className="text-slate-400 text-xs">{formatCurrency(0)}</Text>
                <Text className="text-slate-400 text-xs">{formatCurrency(card.limit)}</Text>
              </View>
            </View>

            {/* Available Credit */}
            <View className="bg-slate-50 dark:bg-slate-900 p-4 rounded-2xl">
              <View className="flex-row justify-between items-center">
                <View>
                  <Text className="text-slate-500 dark:text-slate-400 text-sm mb-1">Available Credit</Text>
                  <Text className="text-slate-900 dark:text-white text-2xl font-bold">
                    {formatCurrency(card.limit - card.balance)}
                  </Text>
                </View>
                <FontAwesome name="check-circle" size={32} color="#10b981" />
              </View>
            </View>
          </View>
        </View>

        {/* Quick Actions */}
        <View className="px-6 mb-8">
          <Text className="text-slate-900 dark:text-white text-base font-bold mb-4">Quick Actions</Text>
          <View className="flex-row justify-between">
            <TouchableOpacity className="flex-1 items-center bg-white dark:bg-slate-800 p-5 rounded-2xl mr-3 shadow-sm border border-slate-100 dark:border-slate-700" style={{ elevation: 2 }}>
              <View className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-2xl justify-center items-center mb-2">
                <FontAwesome name="lock" size={20} color="#3b82f6" />
              </View>
              <Text className="text-slate-900 dark:text-white text-xs font-bold text-center">Freeze Card</Text>
            </TouchableOpacity>

            <TouchableOpacity className="flex-1 items-center bg-white dark:bg-slate-800 p-5 rounded-2xl mr-3 shadow-sm border border-slate-100 dark:border-slate-700" style={{ elevation: 2 }}>
              <View className="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 rounded-2xl justify-center items-center mb-2">
                <FontAwesome name="gear" size={20} color="#9333ea" />
              </View>
              <Text className="text-slate-900 dark:text-white text-xs font-bold text-center">Settings</Text>
            </TouchableOpacity>

            <TouchableOpacity className="flex-1 items-center bg-white dark:bg-slate-800 p-5 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700" style={{ elevation: 2 }}>
              <View className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-2xl justify-center items-center mb-2">
                <FontAwesome name="list-alt" size={20} color="#10b981" />
              </View>
              <Text className="text-slate-900 dark:text-white text-xs font-bold text-center">History</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
