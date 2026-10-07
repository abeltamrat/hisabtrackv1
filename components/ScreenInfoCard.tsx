import { FontAwesome } from '@expo/vector-icons';
import React from 'react';
import { Text, View } from 'react-native';

type ScreenInfoCardProps = {
  icon: string;
  title: string;
  description: string;
  suggestions: string[];
};

export default function ScreenInfoCard({ icon, title, description, suggestions }: ScreenInfoCardProps) {
  return (
    <View className="w-full bg-indigo-50 dark:bg-indigo-950/40 rounded-3xl p-5 mb-5 border border-indigo-100 dark:border-indigo-900/60">
      <View className="flex-row items-start">
        <View className="w-11 h-11 rounded-2xl bg-indigo-100 dark:bg-indigo-900/60 items-center justify-center mr-3">
          <FontAwesome name={icon as any} size={18} color="#6366f1" />
        </View>
        <View className="flex-1">
          <Text className="text-indigo-950 dark:text-indigo-100 font-bold text-base">{title}</Text>
          <Text className="text-indigo-800 dark:text-indigo-200/80 text-sm leading-5 mt-1">{description}</Text>
        </View>
      </View>
      <View className="mt-4 pt-3 border-t border-indigo-200 dark:border-indigo-900/70 gap-2">
        {suggestions.map((suggestion) => (
          <View key={suggestion} className="flex-row items-start">
            <FontAwesome name="check-circle" size={13} color="#6366f1" style={{ marginTop: 2, marginRight: 8 }} />
            <Text className="flex-1 text-indigo-800 dark:text-indigo-200/80 text-xs leading-5">{suggestion}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
