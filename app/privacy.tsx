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
                className="pt-3 pb-6 px-6"
            >
                <TouchableOpacity onPress={() => router.back()} className="mb-4">
                    <FontAwesome name="arrow-left" size={24} color="#fff" />
                </TouchableOpacity>
                <Text className="text-white text-3xl font-bold">Privacy Policy</Text>
                <Text className="text-emerald-100 mt-2">Last updated: October 5, 2026</Text>
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
                            text: "If you grant permission, HisabTrack can read SMS messages to automatically extract bank transaction information. We scan configured financial senders and retain full SMS text in local drafts and saved parsing examples. If you enable AI data sharing and configure a provider, unparsed messages and up to five saved examples may be sent to that provider."
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
                            text: "Financial records use SQLite on native devices and IndexedDB on the web. These databases are not encrypted by the app. Device protection and app lock provide separate safeguards. Raw SMS drafts are stored locally, scoped to your signed-in account."
                        },
                        {
                            subtitle: "Cloud Backup (Optional)",
                            text: "Cloud synchronization is opt-in in Settings. It uploads accounts, transactions, budgets, categories and loans to Firebase. Shared loans, chat, phone lookup and push notifications use cloud services when you use those features."
                        },
                        {
                            subtitle: "Security Measures",
                            text: "Cloud access is restricted to the signed-in owner or shared-loan participants. App lock hides the interface; it does not encrypt the ledger. Exported backups contain financial data in plain text, exclude AI keys, and should be stored privately."
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
                            text: "• With your explicit consent\n• To comply with legal obligations or valid legal requests\n• To protect and defend our rights or property\n• To prevent or investigate possible wrongdoing\n• With service providers who assist in app operations (as described below)"
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
                            text: "• Access: Request a copy of your personal data\n• Correction: Update or correct inaccurate information\n• Deletion: Delete your sign-in account and private records in Settings. Shared financial records remain available to the other participant after your identity is anonymized\n• Export: Download your financial data in standard formats\n• Opt-out: Disable cloud synchronization or SMS reading at any time\n• Withdraw Consent: Revoke permissions granted to the app"
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
                            text: "• Firebase (Google): For authentication and cloud storage\n• Expo: For app updates and push notifications\n? Optional AI providers: Gemini, Groq, OpenRouter and Puter receive the financial context or SMS text required by enabled AI features after you enable AI sharing.\n\nThese services have their own privacy policies, and we encourage you to review them."
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
                            text: "Use the contact details provided by your app distributor."
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
