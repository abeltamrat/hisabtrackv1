import React, { useState, useRef } from 'react';
import { View, Text, TouchableOpacity, Dimensions, Image, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { FontAwesome } from '@expo/vector-icons';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withSpring,
    interpolate,
    Extrapolate
} from 'react-native-reanimated';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface OnboardingSlide {
    id: string;
    title: string;
    description: string;
    icon: string;
    gradient: string[];
    features?: string[];
}

const slides: OnboardingSlide[] = [
    {
        id: '1',
        title: 'Welcome to HisabTrack',
        description: 'Your personal finance companion that helps you take control of your money with ease and confidence.',
        icon: 'line-chart',
        gradient: ['#6366f1', '#8b5cf6'],
    },
    {
        id: '2',
        title: 'Track Every Transaction',
        description: 'Easily record income and expenses with smart categorization and detailed insights.',
        icon: 'credit-card',
        gradient: ['#10b981', '#059669'],
        features: [
            'Quick transaction entry',
            'Smart categorization',
            'Multiple account support',
            'Receipt attachments'
        ]
    },
    {
        id: '3',
        title: 'Smart Budget Planning',
        description: 'Set monthly budgets and track your spending against goals with visual insights and alerts.',
        icon: 'pie-chart',
        gradient: ['#f59e0b', '#d97706'],
        features: [
            'Category-wise budgets',
            'Real-time tracking',
            'Overspending alerts',
            'Monthly reports'
        ]
    },
    {
        id: '4',
        title: 'Auto SMS Sync',
        description: 'Automatically extract bank transactions from SMS messages. No manual entry needed!',
        icon: 'mobile',
        gradient: ['#3b82f6', '#2563eb'],
        features: [
            'Auto transaction detection',
            'Bank SMS parsing',
            'Smart learning',
            'Manual review option'
        ]
    },
    {
        id: '5',
        title: 'Manage Loans & Debts',
        description: 'Keep track of money you\'ve lent or borrowed with due date reminders and payment tracking.',
        icon: 'users',
        gradient: ['#ef4444', '#dc2626'],
        features: [
            'Loan tracking',
            'Payment reminders',
            'Interest calculation',
            'Settlement history'
        ]
    },
    {
        id: '6',
        title: 'Secure Cloud Backup',
        description: 'Your data is encrypted and safely backed up to the cloud. Access from anywhere, anytime.',
        icon: 'cloud',
        gradient: ['#14b8a6', '#0d9488'],
        features: [
            'End-to-end encryption',
            'Auto sync across devices',
            'Secure Firebase storage',
            'Local backup option'
        ]
    },
    {
        id: '7',
        title: 'Ready to Start?',
        description: 'Let\'s begin your journey to better financial management. Your future self will thank you!',
        icon: 'rocket',
        gradient: ['#a855f7', '#9333ea'],
    }
];

interface OnboardingScreenProps {
    onComplete: () => void;
}

export default function OnboardingScreen({ onComplete }: OnboardingScreenProps) {
    const [currentIndex, setCurrentIndex] = useState(0);
    const scrollViewRef = useRef<ScrollView>(null);
    const scrollX = useSharedValue(0);

    const handleNext = () => {
        if (currentIndex < slides.length - 1) {
            const nextIndex = currentIndex + 1;
            setCurrentIndex(nextIndex);
            scrollViewRef.current?.scrollTo({ x: nextIndex * SCREEN_WIDTH, animated: true });
        } else {
            onComplete();
        }
    };

    const handleSkip = () => {
        onComplete();
    };

    const handleScroll = (event: any) => {
        const offsetX = event.nativeEvent.contentOffset.x;
        scrollX.value = offsetX;
        const index = Math.round(offsetX / SCREEN_WIDTH);
        setCurrentIndex(index);
    };

    return (
        <View className="flex-1 bg-white dark:bg-slate-900">
            {/* Skip Button */}
            {currentIndex < slides.length - 1 && (
                <TouchableOpacity
                    onPress={handleSkip}
                    className="absolute top-12 right-6 z-10 px-4 py-2 bg-white/20 rounded-full"
                >
                    <Text className="text-white font-semibold">Skip</Text>
                </TouchableOpacity>
            )}

            {/* Slides */}
            <ScrollView
                ref={scrollViewRef}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onScroll={handleScroll}
                scrollEventThrottle={16}
                bounces={false}
            >
                {slides.map((slide, index) => (
                    <SlideItem
                        key={slide.id}
                        slide={slide}
                        index={index}
                        scrollX={scrollX}
                    />
                ))}
            </ScrollView>

            {/* Bottom Section */}
            <View className="absolute bottom-0 left-0 right-0 pb-12 px-6">
                {/* Pagination Dots */}
                <View className="flex-row justify-center mb-8">
                    {slides.map((_, index) => {
                        const dotStyle = useAnimatedStyle(() => {
                            const inputRange = [
                                (index - 1) * SCREEN_WIDTH,
                                index * SCREEN_WIDTH,
                                (index + 1) * SCREEN_WIDTH,
                            ];

                            const width = interpolate(
                                scrollX.value,
                                inputRange,
                                [8, 24, 8],
                                Extrapolate.CLAMP
                            );

                            const opacity = interpolate(
                                scrollX.value,
                                inputRange,
                                [0.3, 1, 0.3],
                                Extrapolate.CLAMP
                            );

                            return {
                                width,
                                opacity,
                            };
                        });

                        return (
                            <Animated.View
                                key={index}
                                style={[dotStyle]}
                                className="h-2 bg-indigo-500 rounded-full mx-1"
                            />
                        );
                    })}
                </View>

                {/* Action Button */}
                <TouchableOpacity onPress={handleNext} activeOpacity={0.8}>
                    <LinearGradient
                        colors={slides[currentIndex].gradient as [string, string]}
                        className="py-4 rounded-2xl flex-row items-center justify-center"
                    >
                        <Text className="text-white text-lg font-bold mr-2">
                            {currentIndex === slides.length - 1 ? 'Get Started' : 'Next'}
                        </Text>
                        <FontAwesome
                            name={currentIndex === slides.length - 1 ? 'check' : 'arrow-right'}
                            size={20}
                            color="#fff"
                        />
                    </LinearGradient>
                </TouchableOpacity>
            </View>
        </View>
    );
}

function SlideItem({
    slide,
    index,
    scrollX
}: {
    slide: OnboardingSlide;
    index: number;
    scrollX: any;
}) {
    const animatedStyle = useAnimatedStyle(() => {
        const inputRange = [
            (index - 1) * SCREEN_WIDTH,
            index * SCREEN_WIDTH,
            (index + 1) * SCREEN_WIDTH,
        ];

        const scale = interpolate(
            scrollX.value,
            inputRange,
            [0.8, 1, 0.8],
            Extrapolate.CLAMP
        );

        const opacity = interpolate(
            scrollX.value,
            inputRange,
            [0.5, 1, 0.5],
            Extrapolate.CLAMP
        );

        return {
            transform: [{ scale }],
            opacity,
        };
    });

    return (
        <View style={{ width: SCREEN_WIDTH }} className="flex-1">
            <LinearGradient
                colors={slide.gradient as [string, string]}
                className="flex-1 pt-32 px-8"
            >
                {/* Icon */}
                <Animated.View style={animatedStyle} className="items-center mb-12">
                    <View className="w-32 h-32 bg-white/20 rounded-full items-center justify-center mb-8">
                        <FontAwesome name={slide.icon as any} size={64} color="#fff" />
                    </View>

                    {/* Title */}
                    <Text className="text-white text-3xl font-bold text-center mb-4">
                        {slide.title}
                    </Text>

                    {/* Description */}
                    <Text className="text-white/90 text-lg text-center leading-7 mb-8">
                        {slide.description}
                    </Text>

                    {/* Features List */}
                    {slide.features && (
                        <View className="w-full bg-white/10 rounded-3xl p-6 backdrop-blur-lg">
                            {slide.features.map((feature, idx) => (
                                <View key={idx} className="flex-row items-center mb-3 last:mb-0">
                                    <View className="w-6 h-6 bg-white/20 rounded-full items-center justify-center mr-3">
                                        <FontAwesome name="check" size={12} color="#fff" />
                                    </View>
                                    <Text className="text-white text-base flex-1">{feature}</Text>
                                </View>
                            ))}
                        </View>
                    )}
                </Animated.View>
            </LinearGradient>
        </View>
    );
}
