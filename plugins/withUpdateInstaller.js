const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PACKAGE_NAME = 'com.abeltamrat.hisabtrackv1';
const SOURCE_DIR = path.join('app', 'src', 'main', 'java', ...PACKAGE_NAME.split('.'), 'updates');

const moduleSource = `package ${PACKAGE_NAME}.updates

import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.security.MessageDigest

class HisabUpdateInstallerModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName(): String = "HisabUpdateInstaller"

  @ReactMethod
  fun canRequestPackageInstalls(promise: Promise) {
    try {
      val allowed = Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
        reactApplicationContext.packageManager.canRequestPackageInstalls()
      promise.resolve(allowed)
    } catch (error: Exception) {
      promise.reject("INSTALL_PERMISSION_CHECK", "Could not check Android install permission.", error)
    }
  }

  @Suppress("DEPRECATION")
  private fun signingFlag(): Int =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) PackageManager.GET_SIGNING_CERTIFICATES
    else PackageManager.GET_SIGNATURES

  @Suppress("DEPRECATION")
  private fun packageInfo(path: String): PackageInfo? =
    reactApplicationContext.packageManager.getPackageArchiveInfo(
      path,
      signingFlag(),
    )

  @Suppress("DEPRECATION")
  private fun installedPackageInfo(): PackageInfo =
    reactApplicationContext.packageManager.getPackageInfo(
      reactApplicationContext.packageName,
      signingFlag(),
    )

  @Suppress("DEPRECATION")
  private fun versionCode(info: PackageInfo): Long =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else info.versionCode.toLong()

  @Suppress("DEPRECATION")
  private fun certificateDigests(info: PackageInfo): Set<String> {
    val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      val signing = info.signingInfo ?: return emptySet()
      if (signing.hasMultipleSigners()) signing.apkContentsSigners else signing.signingCertificateHistory
    } else {
      info.signatures
    }
    return signatures.orEmpty().map { signature ->
      MessageDigest.getInstance("SHA-256")
        .digest(signature.toByteArray())
        .joinToString(separator = "") { byte -> "%02x".format(byte) }
    }.toSet()
  }

  @ReactMethod
  fun validateApk(fileUri: String, expectedVersion: String?, expectedBuild: Double?, promise: Promise) {
    try {
      val parsed = Uri.parse(fileUri)
      if (parsed.scheme != "file") {
        promise.reject("APK_URI", "The downloaded update is not a private app file.")
        return
      }
      val file = File(parsed.path ?: "")
      if (!file.isFile || file.length() <= 0L) {
        promise.reject("APK_MISSING", "The downloaded update package is missing.")
        return
      }

      val archive = packageInfo(file.absolutePath)
      if (archive == null) {
        promise.reject("APK_INVALID", "Android could not read the downloaded update package.")
        return
      }
      val installed = installedPackageInfo()
      if (archive.packageName != reactApplicationContext.packageName) {
        promise.reject("APK_PACKAGE", "The downloaded package is not HisabTrack.")
        return
      }
      if (!expectedVersion.isNullOrBlank() && archive.versionName != expectedVersion) {
        promise.reject("APK_VERSION", "The downloaded package version does not match the update notice.")
        return
      }
      val archiveBuild = versionCode(archive)
      if (expectedBuild != null && archiveBuild != expectedBuild.toLong()) {
        promise.reject("APK_BUILD", "The downloaded package build does not match the update notice.")
        return
      }
      if (archiveBuild <= versionCode(installed)) {
        promise.reject("APK_DOWNGRADE", "Android updates must have a newer build number.")
        return
      }
      val installedCertificates = certificateDigests(installed)
      val archiveCertificates = certificateDigests(archive)
      if (installedCertificates.isEmpty() || archiveCertificates.isEmpty() || installedCertificates.intersect(archiveCertificates).isEmpty()) {
        promise.reject("APK_SIGNATURE", "The downloaded package was signed by a different publisher.")
        return
      }
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("APK_VALIDATION", "The downloaded update could not be validated.", error)
    }
  }
}
`;

const packageSource = `package ${PACKAGE_NAME}.updates

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class HisabUpdateInstallerPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
    listOf(HisabUpdateInstallerModule(context))

  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
`;

function withInstallerManifest(config) {
  return withAndroidManifest(config, mod => {
    const manifest = mod.modResults.manifest;
    manifest['uses-permission'] = manifest['uses-permission'] || [];
    const permission = 'android.permission.REQUEST_INSTALL_PACKAGES';
    if (!manifest['uses-permission'].some(item => item.$?.['android:name'] === permission)) {
      manifest['uses-permission'].push({ $: { 'android:name': permission } });
    }
    return mod;
  });
}

function withInstallerSources(config) {
  return withDangerousMod(config, ['android', async mod => {
    const androidRoot = mod.modRequest.platformProjectRoot;
    const sourceDir = path.join(androidRoot, SOURCE_DIR);
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'HisabUpdateInstallerModule.kt'), moduleSource);
    fs.writeFileSync(path.join(sourceDir, 'HisabUpdateInstallerPackage.kt'), packageSource);

    const applicationPath = path.join(androidRoot, 'app', 'src', 'main', 'java', ...PACKAGE_NAME.split('.'), 'MainApplication.kt');
    let application = fs.readFileSync(applicationPath, 'utf8');
    const packageImport = `import ${PACKAGE_NAME}.updates.HisabUpdateInstallerPackage`;
    if (!application.includes(packageImport)) {
      application = application.replace('import android.content.res.Configuration', `import android.content.res.Configuration\n${packageImport}`);
    }
    if (!application.includes('add(HisabUpdateInstallerPackage())')) {
      application = application.replace(
        '// add(MyReactNativePackage())',
        '// add(MyReactNativePackage())\n              add(HisabUpdateInstallerPackage())',
      );
    }
    fs.writeFileSync(applicationPath, application);
    return mod;
  }]);
}

module.exports = function withUpdateInstaller(config) {
  return withInstallerSources(withInstallerManifest(config));
};
