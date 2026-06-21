import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

export default function PrivacyPolicyScreen() {
    const router = useRouter();

    return (
        <View className="flex-1 bg-slate-50 dark:bg-slate-900">
            {/* Header */}
            <LinearGradient
                colors={['#10b981', '#059669']}
                className="pt-12 pb-6 px-6"
            >
                <TouchableOpacity onPress={() => router.back()} className="mb-4">
                    <FontAwesome name="arrow-left" size={24} color="#fff" />
                </TouchableOpacity>
                <Text className="text-white text-3xl font-bold">Privacy Policy</Text>
                <Text className="text-emerald-100 mt-2">Last updated: January 8, 2026</Text>
            </LinearGradient>

            <ScrollView className="flex-1 px-6 py-6">
                {/* Introduction */}
                <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg">
                    <Text className="text-slate-700 dark:text-slate-300 text-base leading-6">
                        At HisabTrack, we take your privacy seriously. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our mobile application. Please read this privacy policy carefully.
                    </Text>
                </View>

                {/* Section 1 */}
                <PolicySection
                    number="1"
                    title="Information We Collect"
                    content={[
                        {
                            subtitle: "Personal Information",
                            text: "When you create an account, we collect your email address and authentication credentials. This information is used solely for account creation and secure access to your data."
                        },
                        {
                            subtitle: "Financial Data",
                            text: "You voluntarily provide financial information including transactions, account balances, budgets, and loan details. This data is stored locally on your device and optionally synchronized to our secure cloud servers if you enable cloud backup."
                        },
                        {
                            subtitle: "SMS Messages (Android Only)",
                            text: "If you grant permission, HisabTrack can read SMS messages to automatically extract bank transaction information. We only process messages from recognized financial institutions and do not store or transmit the full content of your SMS messages."
                        },
                        {
                            subtitle: "Device Information",
                            text: "We collect basic device information such as device type, operating system version, and app version for troubleshooting and improving app performance."
                        }
                    ]}
                />

                {/* Section 2 */}
                <PolicySection
                    number="2"
                    title="How We Use Your Information"
                    content={[
                        {
                            text: "• To provide and maintain the HisabTrack service\n• To process and categorize your financial transactions\n• To generate financial reports and insights\n• To synchronize your data across devices (if enabled)\n• To send you important notifications about your finances\n• To improve app functionality and user experience\n• To provide customer support and respond to inquiries"
                        }
                    ]}
                />

                {/* Section 3 */}
                <PolicySection
                    number="3"
                    title="Data Storage and Security"
                    content={[
                        {
                            subtitle: "Local Storage",
                            text: "All financial data is primarily stored locally on your device using encrypted SQLite databases. This ensures your sensitive information remains under your control."
                        },
                        {
                            subtitle: "Cloud Backup (Optional)",
                            text: "If you enable cloud synchronization, your data is encrypted and stored on Firebase servers with industry-standard security measures. We use AES-256 encryption for data at rest and TLS for data in transit."
                        },
                        {
                            subtitle: "Security Measures",
                            text: "We implement appropriate technical and organizational security measures to protect your personal information against unauthorized access, alteration, disclosure, or destruction."
                        }
                    ]}
                />

                {/* Section 4 */}
                <PolicySection
                    number="4"
                    title="Data Sharing and Disclosure"
                    content={[
                        {
                            text: "We do not sell, trade, or rent your personal information to third parties. We may share your information only in the following circumstances:"
                        },
                        {
                            text: "• With your explicit consent\n• To comply with legal obligations or valid legal requests\n• To protect and defend our rights or property\n• To prevent or investigate possible wrongdoing\n• With service providers who assist in app operations (under strict confidentiality agreements)"
                        }
                    ]}
                />

                {/* Section 5 */}
                <PolicySection
                    number="5"
                    title="Your Rights and Choices"
                    content={[
                        {
                            text: "You have the following rights regarding your personal information:"
                        },
                        {
                            text: "• Access: Request a copy of your personal data\n• Correction: Update or correct inaccurate information\n• Deletion: Request deletion of your account and associated data\n• Export: Download your financial data in standard formats\n• Opt-out: Disable cloud synchronization or SMS reading at any time\n• Withdraw Consent: Revoke permissions granted to the app"
                        }
                    ]}
                />

                {/* Section 6 */}
                <PolicySection
                    number="6"
                    title="Third-Party Services"
                    content={[
                        {
                            text: "HisabTrack uses the following third-party services:"
                        },
                        {
                            text: "• Firebase (Google): For authentication and cloud storage\n• Expo: For app development and updates\n\nThese services have their own privacy policies, and we encourage you to review them."
                        }
                    ]}
                />

                {/* Section 7 */}
                <PolicySection
                    number="7"
                    title="Children's Privacy"
                    content={[
                        {
                            text: "HisabTrack is not intended for use by children under the age of 13. We do not knowingly collect personal information from children under 13. If you believe we have collected information from a child under 13, please contact us immediately."
                        }
                    ]}
                />

                {/* Section 8 */}
                <PolicySection
                    number="8"
                    title="Changes to This Policy"
                    content={[
                        {
                            text: "We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page and updating the 'Last updated' date. You are advised to review this Privacy Policy periodically for any changes."
                        }
                    ]}
                />

                {/* Section 9 */}
                <PolicySection
                    number="9"
                    title="Contact Us"
                    content={[
                        {
                            text: "If you have any questions or concerns about this Privacy Policy or our data practices, please contact us at:"
                        },
                        {
                            text: "Email: privacy@hisabtrack.com\nWebsite: www.hisabtrack.com/privacy\nAddress: HisabTrack Privacy Team"
                        }
                    ]}
                />

                {/* Footer */}
                <View className="bg-emerald-50 dark:bg-emerald-900/20 rounded-3xl p-6 mb-6">
                    <View className="flex-row items-start">
                        <FontAwesome name="shield" size={24} color="#10b981" />
                        <View className="flex-1 ml-3">
                            <Text className="text-emerald-900 dark:text-emerald-300 font-bold mb-2">Your Privacy Matters</Text>
                            <Text className="text-emerald-700 dark:text-emerald-400 text-sm">
                                We are committed to protecting your personal and financial information. Your data belongs to you, and we will never compromise your privacy.
                            </Text>
                        </View>
                    </View>
                </View>

                <View className="items-center py-6">
                    <Text className="text-slate-400 text-sm">© 2026 HisabTrack. All rights reserved.</Text>
                </View>

                <View className="h-8" />
            </ScrollView>
        </View>
    );
}

interface PolicyContent {
    subtitle?: string;
    text: string;
}

function PolicySection({ number, title, content }: { number: string; title: string; content: PolicyContent[] }) {
    return (
        <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg">
            <View className="flex-row items-center mb-4">
                <View className="w-8 h-8 bg-emerald-500 rounded-full items-center justify-center mr-3">
                    <Text className="text-white font-bold">{number}</Text>
                </View>
                <Text className="text-xl font-bold text-slate-900 dark:text-white flex-1">{title}</Text>
            </View>

            {content.map((item, index) => (
                <View key={index} className={index > 0 ? "mt-4" : ""}>
                    {item.subtitle && (
                        <Text className="text-slate-900 dark:text-white font-semibold mb-2">{item.subtitle}</Text>
                    )}
                    <Text className="text-slate-700 dark:text-slate-300 text-base leading-6">{item.text}</Text>
                </View>
            ))}
        </View>
    );
}
