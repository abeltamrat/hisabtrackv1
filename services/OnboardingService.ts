import AsyncStorage from '@react-native-async-storage/async-storage';

const ONBOARDING_KEY = '@hisabtrack_onboarding_completed';

export class OnboardingService {
    /**
     * Check if user has completed onboarding
     */
    static async hasCompletedOnboarding(): Promise<boolean> {
        try {
            const value = await AsyncStorage.getItem(ONBOARDING_KEY);
            return value === 'true';
        } catch (error) {
            console.error('Error checking onboarding status:', error);
            return false;
        }
    }

    /**
     * Mark onboarding as completed
     */
    static async completeOnboarding(): Promise<void> {
        try {
            await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
            console.log('Onboarding marked as completed');
        } catch (error) {
            console.error('Error saving onboarding status:', error);
        }
    }

    /**
     * Reset onboarding (for testing or re-showing)
     */
    static async resetOnboarding(): Promise<void> {
        try {
            await AsyncStorage.removeItem(ONBOARDING_KEY);
            console.log('Onboarding reset');
        } catch (error) {
            console.error('Error resetting onboarding:', error);
        }
    }

    /**
     * Check if this is the user's first app launch
     */
    static async isFirstLaunch(): Promise<boolean> {
        try {
            const hasCompleted = await this.hasCompletedOnboarding();
            return !hasCompleted;
        } catch (error) {
            console.error('Error checking first launch:', error);
            return false;
        }
    }
}

export default OnboardingService;
