import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

export default function TermsOfServiceScreen() {
    const router = useRouter();

    return (
        <View className="flex-1 bg-slate-50 dark:bg-slate-900">
            {/* Header */}
            <LinearGradient
                colors={['#f59e0b', '#d97706']}
                className="pt-12 pb-6 px-6"
            >
                <TouchableOpacity onPress={() => router.back()} className="mb-4">
                    <FontAwesome name="arrow-left" size={24} color="#fff" />
                </TouchableOpacity>
                <Text className="text-white text-3xl font-bold">Terms of Service</Text>
                <Text className="text-amber-100 mt-2">Last updated: January 8, 2026</Text>
            </LinearGradient>

            <ScrollView className="flex-1 px-6 py-6">
                {/* Introduction */}
                <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg">
                    <Text className="text-slate-700 dark:text-slate-300 text-base leading-6">
                        Welcome to HisabTrack. These Terms of Service ("Terms") govern your access to and use of the HisabTrack mobile application and services. By using HisabTrack, you agree to be bound by these Terms. If you do not agree to these Terms, please do not use our service.
                    </Text>
                </View>

                {/* Section 1 */}
                <TermsSection
                    number="1"
                    title="Acceptance of Terms"
                    content={[
                        {
                            text: "By creating an account or using HisabTrack, you acknowledge that you have read, understood, and agree to be bound by these Terms and our Privacy Policy. These Terms apply to all users of the application, including without limitation users who are browsers, customers, and contributors of content."
                        }
                    ]}
                />

                {/* Section 2 */}
                <TermsSection
                    number="2"
                    title="Description of Service"
                    content={[
                        {
                            text: "HisabTrack is a personal finance management application that allows you to:"
                        },
                        {
                            text: "• Track income and expenses\n• Manage multiple financial accounts\n• Create and monitor budgets\n• Track loans and debts\n• Generate financial reports\n• Synchronize data across devices\n• Automatically extract transaction data from SMS (Android)"
                        },
                        {
                            text: "We reserve the right to modify, suspend, or discontinue any aspect of the service at any time, with or without notice."
                        }
                    ]}
                />

                {/* Section 3 */}
                <TermsSection
                    number="3"
                    title="User Accounts and Registration"
                    content={[
                        {
                            subtitle: "Account Creation",
                            text: "To use certain features of HisabTrack, you must create an account. You agree to provide accurate, current, and complete information during registration and to update such information to keep it accurate, current, and complete."
                        },
                        {
                            subtitle: "Account Security",
                            text: "You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You agree to immediately notify us of any unauthorized use of your account."
                        },
                        {
                            subtitle: "Account Termination",
                            text: "We reserve the right to suspend or terminate your account at any time for any reason, including violation of these Terms, without prior notice or liability."
                        }
                    ]}
                />

                {/* Section 4 */}
                <TermsSection
                    number="4"
                    title="User Responsibilities"
                    content={[
                        {
                            text: "As a user of HisabTrack, you agree to:"
                        },
                        {
                            text: "• Use the service only for lawful purposes\n• Not use the service to transmit any harmful code or malware\n• Not attempt to gain unauthorized access to our systems\n• Not interfere with or disrupt the service or servers\n• Not impersonate any person or entity\n• Maintain the accuracy of your financial data\n• Comply with all applicable laws and regulations\n• Not use the service for any commercial purposes without our consent"
                        }
                    ]}
                />

                {/* Section 5 */}
                <TermsSection
                    number="5"
                    title="Intellectual Property Rights"
                    content={[
                        {
                            subtitle: "Our Content",
                            text: "The HisabTrack application, including its design, features, functionality, and content (excluding user-generated content), is owned by HisabTrack and is protected by copyright, trademark, and other intellectual property laws."
                        },
                        {
                            subtitle: "Your Content",
                            text: "You retain all rights to the financial data and information you input into HisabTrack. By using our service, you grant us a limited license to use, store, and process your data solely for the purpose of providing the service to you."
                        },
                        {
                            subtitle: "License to Use",
                            text: "We grant you a limited, non-exclusive, non-transferable, revocable license to use HisabTrack for your personal, non-commercial use, subject to these Terms."
                        }
                    ]}
                />

                {/* Section 6 */}
                <TermsSection
                    number="6"
                    title="Data Accuracy and Financial Advice"
                    content={[
                        {
                            text: "HisabTrack is a tool for tracking and organizing your financial information. You acknowledge and agree that:"
                        },
                        {
                            text: "• HisabTrack does not provide financial, investment, or tax advice\n• You are solely responsible for the accuracy of data you input\n• We are not responsible for any financial decisions you make based on the app\n• Automatically extracted SMS data may contain errors and should be verified\n• You should consult with qualified professionals for financial advice\n• The app is not a substitute for professional financial planning"
                        }
                    ]}
                />

                {/* Section 7 */}
                <TermsSection
                    number="7"
                    title="Privacy and Data Protection"
                    content={[
                        {
                            text: "Your privacy is important to us. Our collection and use of personal information is governed by our Privacy Policy, which is incorporated into these Terms by reference. By using HisabTrack, you consent to our collection and use of your information as described in the Privacy Policy."
                        }
                    ]}
                />

                {/* Section 8 */}
                <TermsSection
                    number="8"
                    title="Disclaimers and Limitations of Liability"
                    content={[
                        {
                            subtitle: "Service 'As Is'",
                            text: "HisabTrack is provided 'as is' and 'as available' without warranties of any kind, either express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, or non-infringement."
                        },
                        {
                            subtitle: "Limitation of Liability",
                            text: "To the maximum extent permitted by law, HisabTrack shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits or revenues, whether incurred directly or indirectly, or any loss of data, use, goodwill, or other intangible losses resulting from your use of the service."
                        },
                        {
                            subtitle: "Data Loss",
                            text: "While we implement security measures to protect your data, we cannot guarantee that your data will never be lost, corrupted, or breached. You are responsible for maintaining your own backups of important financial information."
                        }
                    ]}
                />

                {/* Section 9 */}
                <TermsSection
                    number="9"
                    title="Indemnification"
                    content={[
                        {
                            text: "You agree to indemnify, defend, and hold harmless HisabTrack and its officers, directors, employees, and agents from and against any claims, liabilities, damages, losses, and expenses, including reasonable attorney's fees, arising out of or in any way connected with your access to or use of the service, your violation of these Terms, or your violation of any rights of another."
                        }
                    ]}
                />

                {/* Section 10 */}
                <TermsSection
                    number="10"
                    title="Third-Party Services and Links"
                    content={[
                        {
                            text: "HisabTrack may contain links to third-party websites or services that are not owned or controlled by us. We have no control over and assume no responsibility for the content, privacy policies, or practices of any third-party websites or services. You acknowledge and agree that we shall not be responsible or liable for any damage or loss caused by your use of any such third-party services."
                        }
                    ]}
                />

                {/* Section 11 */}
                <TermsSection
                    number="11"
                    title="Modifications to Terms"
                    content={[
                        {
                            text: "We reserve the right to modify these Terms at any time. We will notify users of any material changes by posting the new Terms on this page and updating the 'Last updated' date. Your continued use of HisabTrack after such modifications constitutes your acceptance of the updated Terms."
                        }
                    ]}
                />

                {/* Section 12 */}
                <TermsSection
                    number="12"
                    title="Termination"
                    content={[
                        {
                            text: "You may terminate your account at any time by deleting the app and requesting account deletion through the settings. Upon termination, your right to use the service will immediately cease. We may also terminate or suspend your account and access to the service at any time, without prior notice or liability, for any reason, including breach of these Terms."
                        }
                    ]}
                />

                {/* Section 13 */}
                <TermsSection
                    number="13"
                    title="Governing Law and Dispute Resolution"
                    content={[
                        {
                            subtitle: "Governing Law",
                            text: "These Terms shall be governed by and construed in accordance with the laws of the jurisdiction in which HisabTrack operates, without regard to its conflict of law provisions."
                        },
                        {
                            subtitle: "Dispute Resolution",
                            text: "Any disputes arising out of or relating to these Terms or the service shall first be attempted to be resolved through good faith negotiations. If negotiations fail, disputes shall be resolved through binding arbitration in accordance with applicable arbitration rules."
                        }
                    ]}
                />

                {/* Section 14 */}
                <TermsSection
                    number="14"
                    title="Severability and Waiver"
                    content={[
                        {
                            text: "If any provision of these Terms is found to be unenforceable or invalid, that provision shall be limited or eliminated to the minimum extent necessary, and the remaining provisions shall remain in full force and effect. Our failure to enforce any right or provision of these Terms shall not be deemed a waiver of such right or provision."
                        }
                    ]}
                />

                {/* Section 15 */}
                <TermsSection
                    number="15"
                    title="Contact Information"
                    content={[
                        {
                            text: "If you have any questions about these Terms of Service, please contact us at:"
                        },
                        {
                            text: "Email: legal@hisabtrack.com\nWebsite: www.hisabtrack.com/terms\nSupport: support@hisabtrack.com"
                        }
                    ]}
                />

                {/* Footer */}
                <View className="bg-amber-50 dark:bg-amber-900/20 rounded-3xl p-6 mb-6">
                    <View className="flex-row items-start">
                        <FontAwesome name="file-text" size={24} color="#f59e0b" />
                        <View className="flex-1 ml-3">
                            <Text className="text-amber-900 dark:text-amber-300 font-bold mb-2">Agreement Acknowledgment</Text>
                            <Text className="text-amber-700 dark:text-amber-400 text-sm">
                                By using HisabTrack, you acknowledge that you have read, understood, and agree to be bound by these Terms of Service and our Privacy Policy.
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

interface TermsContent {
    subtitle?: string;
    text: string;
}

function TermsSection({ number, title, content }: { number: string; title: string; content: TermsContent[] }) {
    return (
        <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 mb-6 shadow-lg">
            <View className="flex-row items-center mb-4">
                <View className="w-8 h-8 bg-amber-500 rounded-full items-center justify-center mr-3">
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
