const { withAppBuildGradle } = require('expo/config-plugins');
const marker = '// HisabTrack release signing';
function configureReleaseSigning(contents) {
  if (contents.includes(marker)) return contents;
  return contents + `
${marker}
def hisabSigning = android.signingConfigs.maybeCreate('release')
if (System.getenv('HISAB_RELEASE_STORE_FILE')) {
    hisabSigning.storeFile = file(System.getenv('HISAB_RELEASE_STORE_FILE'))
    hisabSigning.storePassword = System.getenv('HISAB_RELEASE_STORE_PASSWORD')
    hisabSigning.keyAlias = System.getenv('HISAB_RELEASE_KEY_ALIAS')
    hisabSigning.keyPassword = System.getenv('HISAB_RELEASE_KEY_PASSWORD')
}
android.buildTypes.release.signingConfig = hisabSigning
gradle.taskGraph.whenReady { graph ->
    if (graph.allTasks.any { it.name.toLowerCase().contains('release') }) {
        if (System.getenv('EAS_BUILD') == 'true' && file('eas-build.gradle').exists()) {
            def managed = android.buildTypes.release.signingConfig
            if (!managed?.storeFile?.exists() || !managed.keyAlias || managed.keyAlias == 'androiddebugkey') throw new GradleException('EAS release signing credentials are missing or use a debug key')
        } else {
        ['HISAB_RELEASE_STORE_FILE', 'HISAB_RELEASE_STORE_PASSWORD', 'HISAB_RELEASE_KEY_ALIAS', 'HISAB_RELEASE_KEY_PASSWORD'].each { name ->
            if (!System.getenv(name)) throw new GradleException('Missing release signing environment variable: ' + name)
        }
        }
    }
}
`;
}
module.exports = config => withAppBuildGradle(config, mod => {
  if (mod.modResults.language !== 'groovy') throw new Error('HisabTrack release signing requires Groovy build.gradle');
  mod.modResults.contents = configureReleaseSigning(mod.modResults.contents);
  return mod;
});
module.exports.configureReleaseSigning = configureReleaseSigning;
