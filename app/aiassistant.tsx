import React, { useState, useEffect, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSelector } from 'react-redux';
import { RootState } from '@/store';
import AIFinancialAssistant, { AssistantApiKeys, AssistantProvider, ChatMessage, FinancialData } from '@/services/AIFinancialAssistant';
import { useAppSettings } from '@/contexts/AppSettingsContext';

export default function AIAssistantScreen() {
    const router = useRouter();
    const scrollViewRef = useRef<ScrollView>(null);
    const { geminiApiKey, groqApiKey, openRouterApiKey, puterJsEnabled } = useAppSettings();

    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [inputText, setInputText] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [showQuickActions, setShowQuickActions] = useState(true);

    // Get financial data from Redux
    const transactions = useSelector((state: RootState) => state.transactions.items);
    const budgets = useSelector((state: RootState) => state.budgets.items);
    const loans = useSelector((state: RootState) => state.loans.items);
    const accounts = useSelector((state: RootState) => state.accounts.items);

    // Calculate financial summary
    const financialData: FinancialData = {
        totalIncome: transactions.filter(t => t.type === 'INCOME').reduce((sum, t) => sum + t.amount, 0),
        totalExpense: transactions.filter(t => t.type === 'EXPENSE').reduce((sum, t) => sum + t.amount, 0),
        balance: transactions.filter(t => t.type === 'INCOME').reduce((sum, t) => sum + t.amount, 0) -
            transactions.filter(t => t.type === 'EXPENSE').reduce((sum, t) => sum + t.amount, 0),
        transactions,
        budgets,
        loans,
        accounts,
        savingsRate: 0,
        monthlyAverage: 0
    };

    // Calculate savings rate
    if (financialData.totalIncome > 0) {
        financialData.savingsRate = (financialData.balance / financialData.totalIncome) * 100;
    }

    const providerKeys: AssistantApiKeys = {
        geminiApiKey: geminiApiKey?.trim(),
        groqApiKey: groqApiKey?.trim(),
        openRouterApiKey: openRouterApiKey?.trim(),
        usePuterJs: !!puterJsEnabled,
    };
    const hasAnyCloudProvider = !!(
        providerKeys.geminiApiKey ||
        providerKeys.groqApiKey ||
        providerKeys.openRouterApiKey ||
        (Platform.OS === 'web' && providerKeys.usePuterJs)
    );

    useEffect(() => {
        // Load chat history
        const history = AIFinancialAssistant.getChatHistory();
        setMessages(history);

        // Show welcome message if no history
        if (history.length === 0) {
            const welcomeMessage: ChatMessage = {
                id: 'welcome',
                role: 'assistant',
                content: "👋 Hello! I'm your AI Financial Assistant. I'm here to help you understand your finances better and make smarter money decisions. How can I help you today?",
                timestamp: new Date()
            };
            setMessages([welcomeMessage]);
        }
    }, []);

    useEffect(() => {
        // Scroll to bottom when new messages arrive
        scrollViewRef.current?.scrollToEnd({ animated: true });
    }, [messages]);

    const handleSend = async () => {
        if (!inputText.trim()) return;

        const userMessage: ChatMessage = {
            id: Date.now().toString(),
            role: 'user',
            content: inputText.trim(),
            timestamp: new Date()
        };

        setMessages(prev => [...prev, userMessage]);
        setInputText('');
        setIsLoading(true);
        setShowQuickActions(false);

        try {
            const response = await AIFinancialAssistant.chat(userMessage.content, financialData, providerKeys);

            const assistantMessage: ChatMessage = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: response,
                timestamp: new Date(),
                provider: AIFinancialAssistant.getLastProviderUsed(),
            };

            setMessages(prev => [...prev, assistantMessage]);
        } catch (error) {
            console.error('Chat error:', error);
            Alert.alert('Error', 'Failed to get response. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleQuickAction = async (action: string) => {
        setShowQuickActions(false);
        setIsLoading(true);

        try {
            let response = '';

            switch (action) {
                case 'health':
                    response = await AIFinancialAssistant.analyzeFinancialHealth(financialData, providerKeys);
                    break;
                case 'insights':
                    response = await AIFinancialAssistant.getSpendingInsights(financialData, providerKeys);
                    break;
                case 'budget':
                    response = await AIFinancialAssistant.getBudgetRecommendations(financialData, providerKeys);
                    break;
            }

            const assistantMessage: ChatMessage = {
                id: Date.now().toString(),
                role: 'assistant',
                content: response,
                timestamp: new Date(),
                provider: AIFinancialAssistant.getLastProviderUsed(),
            };

            setMessages(prev => [...prev, assistantMessage]);
        } catch (error) {
            console.error('Quick action error:', error);
            Alert.alert('Error', 'Failed to get analysis. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleClearChat = () => {
        Alert.alert(
            'Clear Chat',
            'Are you sure you want to clear the conversation?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Clear',
                    style: 'destructive',
                    onPress: () => {
                        AIFinancialAssistant.clearChatHistory();
                        setMessages([{
                            id: 'welcome',
                            role: 'assistant',
                            content: "Chat cleared! How can I help you today?",
                            timestamp: new Date()
                        }]);
                        setShowQuickActions(true);
                    }
                }
            ]
        );
    };

    return (
        <View className="flex-1 bg-slate-50 dark:bg-slate-900">
            {/* Header */}
            <LinearGradient
                colors={['#6366f1', '#8b5cf6']}
                className="pt-12 pb-6 px-6"
            >
                <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center flex-1">
                        <TouchableOpacity onPress={() => router.back()} className="mr-4">
                            <FontAwesome name="arrow-left" size={24} color="#fff" />
                        </TouchableOpacity>
                        <View className="flex-1">
                            <Text className="text-white text-2xl font-bold">AI Financial Assistant</Text>
                            <Text className="text-indigo-200 text-sm">Powered by Gemini / Groq / OpenRouter / Puter.js</Text>
                        </View>
                    </View>
                    <TouchableOpacity onPress={handleClearChat} className="ml-2">
                        <FontAwesome name="trash" size={20} color="#fff" />
                    </TouchableOpacity>
                </View>
            </LinearGradient>

            {/* Chat Messages */}
            <ScrollView
                ref={scrollViewRef}
                className="flex-1 px-4 py-4"
                contentContainerStyle={{ paddingBottom: 20 }}
            >
                {!hasAnyCloudProvider && (
                    <View className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-6 mb-6">
                        <View className="flex-row items-center mb-3">
                            <FontAwesome name="warning" size={20} color="#d97706" />
                            <Text className="text-amber-800 dark:text-amber-400 font-bold ml-2">Cloud AI Optional</Text>
                        </View>
                        <Text className="text-amber-700 dark:text-amber-300 text-sm mb-4 leading-5">
                            Add Gemini, Groq, or OpenRouter API key, or enable Puter.js on web. Without cloud AI, the assistant still gives local offline guidance.
                        </Text>
                        <TouchableOpacity
                            onPress={() => router.push('/settings')}
                            className="bg-amber-500 py-3 rounded-xl items-center"
                        >
                            <Text className="text-white font-bold">Open AI Settings</Text>
                        </TouchableOpacity>
                    </View>
                )}
                {messages.map((message) => (
                    <MessageBubble key={message.id} message={message} />
                ))}

                {isLoading && (
                    <View className="flex-row items-center my-4">
                        <View className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-lg">
                            <ActivityIndicator size="small" color="#6366f1" />
                            <Text className="text-slate-500 text-sm ml-2">Thinking...</Text>
                        </View>
                    </View>
                )}

                {/* Quick Actions */}
                {showQuickActions && messages.length <= 1 && (
                    <View className="mt-4">
                        <Text className="text-slate-500 dark:text-slate-400 text-sm font-semibold mb-3 px-2">
                            Quick Actions
                        </Text>
                        <QuickActionButton
                            icon="heartbeat"
                            title="Analyze My Financial Health"
                            color="#10b981"
                            onPress={() => handleQuickAction('health')}
                        />
                        <QuickActionButton
                            icon="line-chart"
                            title="Get Spending Insights"
                            color="#f59e0b"
                            onPress={() => handleQuickAction('insights')}
                        />
                        <QuickActionButton
                            icon="pie-chart"
                            title="Budget Recommendations"
                            color="#6366f1"
                            onPress={() => handleQuickAction('budget')}
                        />
                    </View>
                )}
            </ScrollView>

            {/* Input Area */}
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
            >
                <View className="bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 px-4 py-3">
                    <View className="flex-row items-center">
                        <TextInput
                            value={inputText}
                            onChangeText={setInputText}
                            placeholder="Ask me anything about your finances..."
                            placeholderTextColor="#94a3b8"
                            className="flex-1 bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white rounded-full px-5 py-3 mr-3"
                            multiline
                            maxLength={500}
                            onSubmitEditing={handleSend}
                        />
                        <TouchableOpacity
                            onPress={handleSend}
                            disabled={!inputText.trim() || isLoading}
                            className={`w-12 h-12 rounded-full items-center justify-center ${inputText.trim() && !isLoading ? 'bg-indigo-500' : 'bg-slate-300 dark:bg-slate-600'
                                }`}
                        >
                            <FontAwesome
                                name="send"
                                size={18}
                                color={inputText.trim() && !isLoading ? '#fff' : '#94a3b8'}
                            />
                        </TouchableOpacity>
                    </View>
                </View>
            </KeyboardAvoidingView>
        </View>
    );
}

function MessageBubble({ message }: { message: ChatMessage }) {
    const isUser = message.role === 'user';
    const providerLabel = getProviderBadgeLabel(message.provider);

    return (
        <View className={`flex-row mb-4 ${isUser ? 'justify-end' : 'justify-start'}`}>
            {!isUser && (
                <View className="w-8 h-8 bg-indigo-500 rounded-full items-center justify-center mr-2">
                    <FontAwesome name="android" size={16} color="#fff" />
                </View>
            )}

            <View className={`max-w-[75%] ${isUser ? 'bg-indigo-500' : 'bg-white dark:bg-slate-800'} rounded-2xl p-4 shadow-lg`}>
                <Text className={`${isUser ? 'text-white' : 'text-slate-900 dark:text-white'} text-base leading-6`}>
                    {message.content}
                </Text>
                <View className="flex-row items-center mt-2">
                    {!isUser && providerLabel ? (
                        <View className="px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 mr-2">
                            <Text className="text-[10px] text-indigo-700 dark:text-indigo-300 font-semibold">
                                {providerLabel}
                            </Text>
                        </View>
                    ) : null}
                    <Text className={`${isUser ? 'text-indigo-100' : 'text-slate-400'} text-xs`}>
                        {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                </View>
            </View>

            {isUser && (
                <View className="w-8 h-8 bg-slate-300 dark:bg-slate-700 rounded-full items-center justify-center ml-2">
                    <FontAwesome name="user" size={16} color="#64748b" />
                </View>
            )}
        </View>
    );
}

function getProviderBadgeLabel(provider?: AssistantProvider): string | null {
    if (!provider || provider === 'none') return null;
    if (provider === 'gemini') return 'Gemini';
    if (provider === 'groq') return 'Groq';
    if (provider === 'openrouter') return 'OpenRouter';
    if (provider === 'puter') return 'Puter.js';
    if (provider === 'local') return 'Local';
    return null;
}

function QuickActionButton({
    icon,
    title,
    color,
    onPress
}: {
    icon: string;
    title: string;
    color: string;
    onPress: () => void;
}) {
    return (
        <TouchableOpacity
            onPress={onPress}
            className="flex-row items-center bg-white dark:bg-slate-800 rounded-2xl p-4 mb-3 shadow-lg active:opacity-70"
        >
            <View
                className="w-12 h-12 rounded-xl items-center justify-center mr-4"
                style={{ backgroundColor: color + '20' }}
            >
                <FontAwesome name={icon as any} size={20} color={color} />
            </View>
            <Text className="flex-1 text-slate-900 dark:text-white font-semibold text-base">
                {title}
            </Text>
            <FontAwesome name="chevron-right" size={16} color="#94a3b8" />
        </TouchableOpacity>
    );
}
