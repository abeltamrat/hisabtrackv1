import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, Image, ScrollView, useWindowDimensions, StyleSheet, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { FontAwesome } from '@expo/vector-icons';
import AuthBackground, { AUTH_ACCENT, AUTH_BASE } from './AuthBackground';

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
    const { width } = useWindowDimensions();
    const scrollViewRef = useRef<ScrollView>(null);
    const currentIndexRef = useRef(0);

    useEffect(() => {
        scrollViewRef.current?.scrollTo({ x: currentIndexRef.current * width, animated: false });
    }, [width]);

    const goTo = (index: number) => {
        currentIndexRef.current = index;
        setCurrentIndex(index);
        scrollViewRef.current?.scrollTo({ x: index * width, animated: true });
    };
    const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        const index = Math.max(0, Math.min(slides.length - 1, Math.round(event.nativeEvent.contentOffset.x / width)));
        currentIndexRef.current = index;
        setCurrentIndex(index);
    };

    return (
        <View style={[styles.root, { backgroundColor: AUTH_BASE }]}>
            <AuthBackground />
            <StatusBar style="light" />
            <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
                <View style={styles.topBar}>
                    <Text style={styles.brand}>HISAB TRACK</Text>
                    <TouchableOpacity onPress={onComplete} accessibilityRole="button" style={styles.textButton}>
                        <Text style={styles.link}>{currentIndex === slides.length - 1 ? 'Sign in' : 'Skip intro'}</Text>
                    </TouchableOpacity>
                </View>
                <ScrollView ref={scrollViewRef} horizontal pagingEnabled
                    showsHorizontalScrollIndicator={false} onMomentumScrollEnd={handleScroll}
                    bounces={false} style={{ flex: 1 }}>
                    {slides.map((slide, index) => (
                        <ScrollView key={slide.id} style={{ width }} showsVerticalScrollIndicator={false}
                            contentContainerStyle={styles.slideScroll}>
                            <View style={styles.slide}>
                                <View style={styles.emblem}>
                                    {index === 0 || index === slides.length - 1 ? (
                                        <Image source={require('../assets/images/hisab-coin-loader.png')}
                                            accessibilityLabel="Hisab Track coin logo" style={{ width: 124, height: 124 }} />
                                    ) : <FontAwesome name={slide.icon as React.ComponentProps<typeof FontAwesome>['name']} size={48} color={AUTH_ACCENT} />}
                                </View>
                                <Text style={styles.eyebrow}>YOUR MONEY. A CLEARER PICTURE.</Text>
                                <Text accessibilityRole="header" style={styles.title}>{slide.title}</Text>
                                <Text style={styles.description}>{slide.description}</Text>
                                {slide.features && (
                                    <View style={styles.glass}>
                                        {slide.features.map(feature => (
                                            <View key={feature} style={styles.feature}>
                                                <View style={styles.check}><FontAwesome name="check" size={12} color={AUTH_ACCENT} /></View>
                                                <Text style={styles.featureText}>{feature}</Text>
                                            </View>
                                        ))}
                                    </View>
                                )}
                            </View>
                        </ScrollView>
                    ))}
                </ScrollView>
                <View style={styles.footer}>
                    <View style={styles.pagination}>
                        {slides.map((slide, index) => (
                            <TouchableOpacity key={slide.id} onPress={() => goTo(index)}
                                accessibilityRole="button" accessibilityLabel={'Go to introduction slide ' + (index + 1)}
                                accessibilityState={{ selected: currentIndex === index }} style={styles.dotButton}>
                                <View style={[styles.dot, currentIndex === index && styles.activeDot]} />
                            </TouchableOpacity>
                        ))}
                    </View>
                    <TouchableOpacity accessibilityRole="button" activeOpacity={0.8} style={styles.primary}
                        onPress={() => currentIndex === slides.length - 1 ? onComplete() : goTo(currentIndex + 1)}>
                        <Text style={styles.primaryText}>{currentIndex === slides.length - 1 ? 'Get Started' : 'Continue'}</Text>
                        <FontAwesome name="arrow-right" size={16} color="#fff" />
                    </TouchableOpacity>
                    <Text style={styles.step}>{currentIndex + 1} of {slides.length}</Text>
                </View>
            </SafeAreaView>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1 },
    topBar: { paddingHorizontal: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 64 },
    brand: { color: '#e2e8f0', fontSize: 12, fontWeight: '800', letterSpacing: 2 },
    textButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
    link: { color: AUTH_ACCENT, fontWeight: '600' },
    slideScroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
    slide: { width: '100%', maxWidth: 460, alignSelf: 'center', alignItems: 'center' },
    emblem: { width: 144, height: 144, borderRadius: 48, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
    eyebrow: { color: AUTH_ACCENT, fontSize: 10, fontWeight: '700', letterSpacing: 2, textAlign: 'center', marginBottom: 14 },
    title: { color: '#fff', fontSize: 32, fontWeight: '800', textAlign: 'center', lineHeight: 40, marginBottom: 16 },
    description: { color: '#cbd5e1', fontSize: 16, lineHeight: 25, textAlign: 'center', marginBottom: 28 },
    glass: { width: '100%', backgroundColor: 'rgba(255,255,255,0.08)', borderColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderRadius: 24, padding: 22, gap: 18 },
    feature: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    check: { backgroundColor: 'rgba(103,232,249,0.1)', width: 26, height: 26, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
    featureText: { color: '#e2e8f0', fontSize: 15, flex: 1, lineHeight: 22 },
    footer: { paddingHorizontal: 24, paddingBottom: 12, width: '100%', maxWidth: 508, alignSelf: 'center' },
    pagination: { flexDirection: 'row', justifyContent: 'center', marginBottom: 8 },
    dotButton: { minWidth: 36, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    dot: { height: 6, width: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.25)' },
    activeDot: { width: 22, backgroundColor: AUTH_ACCENT },
    primary: { backgroundColor: '#4f46e5', borderWidth: 1, borderColor: '#818cf8', borderRadius: 18, minHeight: 56, padding: 16, flexDirection: 'row', gap: 12, alignItems: 'center', justifyContent: 'center' },
    primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
    step: { color: '#94a3b8', fontSize: 12, textAlign: 'center', marginTop: 12 },
});
