// Suppress specific Expo/React Native warnings and errors

if (__DEV__) {
    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;

    console.error = (...args) => {
        if (typeof args[0] === 'string') {
            // Suppress Expo Go Notification error
            if (args[0].includes('expo-notifications: Android Push notifications')) {
                return;
            }
        }
        originalConsoleError(...args);
    };

    console.warn = (...args) => {
        if (typeof args[0] === 'string') {
            // Suppress react-native-web deprecation warning
            if (args[0].includes('props.pointerEvents is deprecated')) {
                return;
            }
        }
        originalConsoleWarn(...args);
    };
}
