import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

export default function AboutScreen() {
    const router = useRouter();

    const openLink = (url: string) => {
        Linking.openURL(url);
    };

    return (
        <View className="flex-1 bg-slate-50 dark:bg-slate-900">
            {/* Header */}
            <LinearGradient
                colors={['#4f46e5', '#6366f1']}
                className="pt-12 pb-6 px-6"
            >
                <TouchableOpacity onPress={() => router.back()} className="mb-4">
                    <FontAwesome name="arrow-left" size={24} color="#fff" />
                </TouchableOpacity>
                <Text className="text-white text-3xl font-bold">About HisabTrack</Text>
                <Text className="text-indigo-100 mt-2">Your Personal Finance Companion</Text>
            </LinearGradient>

            <ScrollView className="flex-1 px-6 py-6">
                {/* App Info Card */}
                <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg">
                    <View className="items-center mb-6">
                        <View className="w-20 h-20 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl items-center justify-center mb-4">
                            <FontAwesome name="line-chart" size={40} color="#fff" />
                        </View>
                        <Text className="text-2xl font-bold text-slate-900 dark:text-white">HisabTrack</Text>
                        <Text className="text-slate-500 dark:text-slate-400">Version 1.0.2</Text>
                    </View>

                    <View className="border-t border-slate-200 dark:border-slate-700 pt-6">
                        <Text className="text-slate-700 dark:text-slate-300 text-base leading-6 mb-4">
                            HisabTrack is a comprehensive personal finance management application designed to help you take control of your financial life with ease and confidence.
                        </Text>
                        <Text className="text-slate-700 dark:text-slate-300 text-base leading-6">
                            Built with modern technology and user-centric design, HisabTrack empowers you to track expenses, manage budgets, monitor loans, and gain valuable insights into your spending patterns.
                        </Text>
                    </View>
                </View>

                {/* Features Section */}
                <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg">
                    <Text className="text-xl font-bold text-slate-900 dark:text-white mb-4">Key Features</Text>

                    <FeatureItem
                        icon="credit-card"
                        title="Transaction Management"
                        description="Easily track income and expenses with detailed categorization and smart filtering."
                    />
                    <FeatureItem
                        icon="bank"
                        title="Multi-Account Support"
                        description="Manage multiple bank accounts, cash, and digital wallets in one place."
                    />
                    <FeatureItem
                        icon="pie-chart"
                        title="Budget Planning"
                        description="Set monthly budgets and track your spending against goals with visual insights."
                    />
                    <FeatureItem
                        icon="users"
                        title="Loan Tracking"
                        description="Keep track of money you've lent or borrowed with due date reminders."
                    />
                    <FeatureItem
                        icon="mobile"
                        title="SMS Auto-Sync"
                        description="Automatically extract transactions from bank SMS messages (Android)."
                    />
                    <FeatureItem
                        icon="cloud"
                        title="Cloud Backup"
                        description="Secure cloud synchronization keeps your data safe and accessible."
                    />
                    <FeatureItem
                        icon="bar-chart"
                        title="Financial Reports"
                        description="Generate professional PDF and Excel reports for analysis."
                    />
                    <FeatureItem
                        icon="lock"
                        title="Privacy First"
                        description="Your financial data is encrypted and stored securely on your device."
                    />
                </View>

                {/* Technology Stack */}
                <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg">
                    <Text className="text-xl font-bold text-slate-900 dark:text-white mb-4">Built With</Text>
                    <View className="flex-row flex-wrap gap-2">
                        <TechBadge name="React Native" />
                        <TechBadge name="Expo" />
                        <TechBadge name="TypeScript" />
                        <TechBadge name="Redux" />
                        <TechBadge name="Firebase" />
                        <TechBadge name="SQLite" />
                        <TechBadge name="TailwindCSS" />
                    </View>
                </View>

                {/* Mission Statement */}
                <View className="bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 rounded-3xl p-6 mb-6">
                    <Text className="text-xl font-bold text-slate-900 dark:text-white mb-3">Our Mission</Text>
                    <Text className="text-slate-700 dark:text-slate-300 text-base leading-6">
                        To democratize personal finance management by providing a powerful, intuitive, and accessible tool that helps individuals make informed financial decisions and achieve their financial goals.
                    </Text>
                </View>

                {/* Contact & Support */}
                <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg">
                    <Text className="text-xl font-bold text-slate-900 dark:text-white mb-4">Contact & Support</Text>

                    <TouchableOpacity
                        onPress={() => openLink('mailto:support@hisabtrack.com')}
                        className="flex-row items-center py-3 border-b border-slate-200 dark:border-slate-700"
                    >
                        <FontAwesome name="envelope" size={20} color="#6366f1" />
                        <Text className="text-slate-700 dark:text-slate-300 ml-3 flex-1">support@hisabtrack.com</Text>
                        <FontAwesome name="chevron-right" size={16} color="#94a3b8" />
                    </TouchableOpacity>

                    <TouchableOpacity
                        onPress={() => openLink('https://hisabtrack.com')}
                        className="flex-row items-center py-3 border-b border-slate-200 dark:border-slate-700"
                    >
                        <FontAwesome name="globe" size={20} color="#6366f1" />
                        <Text className="text-slate-700 dark:text-slate-300 ml-3 flex-1">www.hisabtrack.com</Text>
                        <FontAwesome name="chevron-right" size={16} color="#94a3b8" />
                    </TouchableOpacity>

                    <TouchableOpacity
                        onPress={() => router.push('/privacy')}
                        className="flex-row items-center py-3 border-b border-slate-200 dark:border-slate-700"
                    >
                        <FontAwesome name="shield" size={20} color="#6366f1" />
                        <Text className="text-slate-700 dark:text-slate-300 ml-3 flex-1">Privacy Policy</Text>
                        <FontAwesome name="chevron-right" size={16} color="#94a3b8" />
                    </TouchableOpacity>

                    <TouchableOpacity
                        onPress={() => router.push('/terms')}
                        className="flex-row items-center py-3"
                    >
                        <FontAwesome name="file-text" size={20} color="#6366f1" />
                        <Text className="text-slate-700 dark:text-slate-300 ml-3 flex-1">Terms of Service</Text>
                        <FontAwesome name="chevron-right" size={16} color="#94a3b8" />
                    </TouchableOpacity>
                </View>

                {/* Footer */}
                <View className="items-center py-6">
                    <Text className="text-slate-400 text-sm">© 2026 HisabTrack. All rights reserved.</Text>
                    <Text className="text-slate-400 text-xs mt-1">Made with ❤️ for better financial wellness</Text>
                </View>

                <View className="h-8" />
            </ScrollView>
        </View>
    );
}

function FeatureItem({ icon, title, description }: { icon: string; title: string; description: string }) {
    return (
        <View className="flex-row mb-4">
            <View className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/30 rounded-xl items-center justify-center mr-3">
                <FontAwesome name={icon as any} size={18} color="#6366f1" />
            </View>
            <View className="flex-1">
                <Text className="text-slate-900 dark:text-white font-semibold mb-1">{title}</Text>
                <Text className="text-slate-600 dark:text-slate-400 text-sm">{description}</Text>
            </View>
        </View>
    );
}

function TechBadge({ name }: { name: string }) {
    return (
        <View className="bg-indigo-100 dark:bg-indigo-900/30 px-3 py-1.5 rounded-full">
            <Text className="text-indigo-700 dark:text-indigo-300 text-sm font-medium">{name}</Text>
        </View>
    );
}
