// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require("nativewind/metro");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Add resolver configuration for platform-specific modules
config.resolver = {
  ...config.resolver,
  alias: {
    '@': __dirname,
  },
  resolveRequest: (context, moduleName, platform) => {
    // Use IndexedDB implementation for web, skip expo-sqlite
    if (platform === 'web' && moduleName === 'expo-sqlite') {
      return {
        type: 'empty',
      };
    }
    // Default resolution
    return context.resolveRequest(context, moduleName, platform);
  },
};

module.exports = withNativeWind(config, { input: "./global.css" });
