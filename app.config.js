const appJson = require('./app.json');

/**
 * Normal builds use app.json's app-version runtime policy. A release operator
 * may target a compatibility bridge at an older runtime without editing tracked
 * files by setting HISAB_RUNTIME_VERSION_OVERRIDE for `eas update` only.
 */
module.exports = ({ config }) => ({
  ...config,
  runtimeVersion: process.env.HISAB_RUNTIME_VERSION_OVERRIDE
    ? process.env.HISAB_RUNTIME_VERSION_OVERRIDE
    : appJson.expo.runtimeVersion,
});
