import { useAppSettings } from '@/contexts/AppSettingsContext';
import { RootState } from '@/store';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View, useColorScheme } from 'react-native';

import { useSelector } from 'react-redux';

interface AmortizationScheduleItem {
    period: number;
    payment: number;
    principal: number;
    interest: number;
    balance: number;
}

export default function LoanDetailsScreen() {
    const { id } = useLocalSearchParams();
    const router = useRouter();
    const colorScheme = useColorScheme();
    const { formatCurrency } = useAppSettings();

    const loan = useSelector((state: RootState) =>
        state.loans.items.find(l => l.id === id)
    );

    const [schedule, setSchedule] = useState<AmortizationScheduleItem[]>([]);

    useEffect(() => {
        if (loan) {
            calculateAmortization();
        }
    }, [loan]);

    const calculateAmortization = () => {
        if (!loan) return;

        const P = loan.principal_amount;
        const annualRate = loan.interest_rate / 100;

        const start = new Date(loan.start_date);
        const due = new Date(loan.due_date);

        if (due <= start) {
            setSchedule([]);
            return;
        }

        let months =
            (due.getFullYear() - start.getFullYear()) * 12 +
            (due.getMonth() - start.getMonth());

        if (due.getDate() < start.getDate()) {
            months -= 1;
        }

        months = Math.max(months, 1);
        const years = months / 12;

        const totalInterest = Number((P * annualRate * years).toFixed(2));
        const totalPayable = Number((P + totalInterest).toFixed(2));
        const payment = Number((totalPayable / months).toFixed(2));

        let balance = totalPayable;
        const newSchedule: AmortizationScheduleItem[] = [];

        for (let i = 1; i <= months; i++) {
            const interest = Number((totalInterest / months).toFixed(2));
            let principal = Number((payment - interest).toFixed(2));

            if (i === months) {
                principal = balance;
            }

            balance = Number((balance - principal).toFixed(2));

            newSchedule.push({
                period: i,
                payment,
                principal,
                interest,
                balance: Math.max(balance, 0)
            });
        }

        setSchedule(newSchedule);
    };

    const getPaidMonths = () => {
        if (!loan || schedule.length === 0) return 0;
        const totalPayable = loan.principal_amount + (loan.principal_amount * (loan.interest_rate / 100) * ((schedule.length) / 12));
        const paidAmount = totalPayable - loan.remaining_balance;
        const monthlyPayment = schedule[0]?.payment || 0;
        if (monthlyPayment === 0) return 0;
        return Math.floor(paidAmount / monthlyPayment);
    };

    if (!loan) {
        return (
            <View className="flex-1 bg-slate-50 dark:bg-background-dark justify-center items-center">
                <Text className="text-slate-500 text-lg">Loan not found</Text>
                <TouchableOpacity onPress={() => router.back()} className="mt-4 bg-blue-600 px-6 py-3 rounded-xl">
                    <Text className="text-white font-bold">Go Back</Text>
                </TouchableOpacity>
            </View>
        );
    }

    const isLent = loan.type === 'LENT';
    const gradientColors = isLent
        ? (colorScheme === 'dark' ? ['#064e3b', '#022c22'] : ['#16a34a', '#15803d'])
        : (colorScheme === 'dark' ? ['#881337', '#4c0519'] : ['#dc2626', '#b91c1c']);

    return (
        <View className="flex-1 bg-slate-50 dark:bg-background-dark">
            <Stack.Screen options={{ headerShown: false }} />
            <StatusBar style="auto" />

            {/* Header Section */}
            <LinearGradient
                colors={gradientColors as any}
                className="px-6 pt-12 pb-8 rounded-b-[32px]"
                style={{ elevation: 4 }}
            >
                <View className="flex-row justify-between items-center mb-6">
                    <TouchableOpacity onPress={() => router.back()} className="w-10 h-10 bg-white/20 rounded-xl justify-center items-center">
                        <FontAwesome name="arrow-left" size={18} color="#fff" />
                    </TouchableOpacity>
                    <Text className="text-white text-xl font-bold">Loan Details</Text>
                    <View className="w-10" />
                </View>

                <View className="items-center mb-6">
                    <Text className="text-white/80 text-xs font-bold uppercase tracking-widest mb-1">{isLent ? 'Borrower' : 'Lender'}</Text>
                    <Text className="text-white text-3xl font-bold text-center">{loan.lender_borrower_name}</Text>
                </View>

                <View className="flex-row bg-black/10 p-4 rounded-2xl">
                    <View className="flex-1 items-center border-r border-white/10">
                        <Text className="text-white/60 text-[10px] uppercase font-bold mb-1">Principal</Text>
                        <Text className="text-white font-bold text-base">{formatCurrency(loan.principal_amount)}</Text>
                    </View>
                    <View className="flex-1 items-center">
                        <Text className="text-white/60 text-[10px] uppercase font-bold mb-1">Remaining</Text>
                        <Text className="text-white font-bold text-base">{formatCurrency(loan.remaining_balance)}</Text>
                    </View>
                </View>
            </LinearGradient>

            <ScrollView className="flex-1 px-4" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: 24, paddingBottom: 40 }}>
                {/* Key Stats Row */}
                <View className="flex-row gap-3 mb-6">
                    <View className="flex-1 bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm">
                        <Text className="text-slate-400 text-[10px] font-bold uppercase mb-1">Interest</Text>
                        <Text className="text-slate-900 dark:text-white text-lg font-bold">{loan.interest_rate}%</Text>
                    </View>
                    <View className="flex-1 bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm">
                        <Text className="text-slate-400 text-[10px] font-bold uppercase mb-1">Due Date</Text>
                        <Text className="text-slate-900 dark:text-white text-sm font-bold">{new Date(loan.due_date).toLocaleDateString()}</Text>
                    </View>
                </View>

                {/* Minimalist Amortization Table */}
                <View className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 overflow-hidden shadow-sm">
                    <View className="px-4 py-4 border-b border-slate-50 dark:border-slate-700">
                        <Text className="text-slate-900 dark:text-white font-bold">Amortization Schedule</Text>
                    </View>

                    {schedule.length > 0 ? (
                        <View>
                            {/* Header */}
                            <View className="flex-row px-4 py-2 bg-slate-50/50 dark:bg-slate-900/20 border-b border-slate-100 dark:border-slate-700">
                                <Text className="flex-[0.7] text-[10px] font-bold text-slate-400 uppercase">#</Text>
                                <Text className="flex-[2] text-[10px] font-bold text-slate-400 uppercase text-right">Payment</Text>
                                <Text className="flex-[2] text-[10px] font-bold text-slate-400 uppercase text-right">Principal</Text>
                                <Text className="flex-[2] text-[10px] font-bold text-slate-400 uppercase text-right">Balance</Text>
                                <Text className="flex-[0.5] text-[10px] font-bold text-slate-400 uppercase text-right"></Text>
                            </View>

                            {/* List items */}
                            {schedule.map((row) => {
                                const paidMonths = getPaidMonths();
                                const isPaid = row.period <= paidMonths;

                                return (
                                    <View 
                                        key={row.period} 
                                        className={`flex-row items-center px-4 py-4 border-b border-slate-50 dark:border-slate-700/50 ${isPaid ? 'opacity-40' : ''}`}
                                    >
                                        <Text className="flex-[0.7] text-xs font-bold text-slate-400">{row.period}</Text>
                                        <Text className="flex-[2] text-xs font-semibold text-slate-900 dark:text-slate-100 text-right">
                                            {formatCurrency(row.payment)}
                                        </Text>
                                        <View className="flex-[2]">
                                            <Text className="text-[11px] font-medium text-slate-600 dark:text-slate-400 text-right">
                                                {formatCurrency(row.principal)}
                                            </Text>
                                            <Text className="text-[9px] text-slate-400 text-right">Int: {formatCurrency(row.interest)}</Text>
                                        </View>
                                        <Text className="flex-[2] text-xs font-bold text-blue-600 dark:text-blue-400 text-right">
                                            {formatCurrency(row.balance)}
                                        </Text>
                                        <View className="flex-[0.5] items-end">
                                            {isPaid && <FontAwesome name="check-circle" size={12} color="#10b981" />}
                                        </View>
                                    </View>
                                );
                            })}
                        </View>
                    ) : (
                        <View className="p-10 items-center">
                            <Text className="text-slate-400 text-sm italic">Schedule calculation unavailable</Text>
                        </View>
                    )}
                </View>
            </ScrollView>
        </View>
    );
}