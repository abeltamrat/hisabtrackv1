import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { Linking, Platform } from 'react-native';
import { Alert } from '@/utils/alert';
import { sha256 } from '@noble/hashes/sha256';
import { toByteArray } from 'base64-js';

const DEFAULT_UPDATE_JSON_URL = 'https://www.hisab.nonstopplc.com/update.json';
const APK_MIME_TYPE = 'application/vnd.android.package-archive';
const FLAG_GRANT_READ_URI_PERMISSION = 1;

// Runtime 1.0.4 needs a browser bridge to the first APK that contains the
// guarded native installer. Prefer a same/newer server manifest as soon as it
// is deployed; this record only covers a stale or temporarily unavailable host.
const BUNDLED_ANDROID_BRIDGE_RELEASE: BinaryUpdateManifest = {
  latestVersion: '1.0.5',
  latestBuildNumber: 103,
  androidDownloadUrl: 'https://github.com/abeltamrat/hisabtrackv1/releases/download/v1.0.5/hisabtrack-1.0.5-build-103.apk',
  androidSha256: 'a9e4ef028d71166714008ea44eba4062fcdd191e102829110091c14f9e77098a',
  androidSize: 103295634,
  forceUpdate: false,
  releaseNotes: 'Secure app updates, messaging, people and category improvements.',
  legacyVerifiedInstaller: true,
};

type UpdateType = 'ota' | 'binary';
type UpdatePhase = 'checking' | 'permission' | 'downloading' | 'verifying' | 'installing' | 'browser' | 'reloading' | 'completed';

interface BinaryUpdateManifest {
  latestVersion: string;
  latestBuildNumber?: string | number;
  minimumSupportedVersion?: string;
  minimumSupportedBuildNumber?: string | number;
  downloadUrl?: string;
  androidDownloadUrl?: string;
  iosDownloadUrl?: string;
  forceUpdate?: boolean;
  releaseNotes?: string;
  /**
   * Lowercase hex SHA-256 of the Android APK. Required: the app holds
   * REQUEST_INSTALL_PACKAGES, so an unverified package must never reach the
   * installer. HTTPS alone does not help against a compromised or misconfigured
   * download host, or a device trusting a user-installed CA.
   */
  androidSha256?: string;
  sha256?: string;
  /** Expected APK size in bytes. Checked before hashing to fail fast. */
  androidSize?: number;
  size?: number;
  /** Open the system browser; used by bridge releases for older native shells. */
  browserOnly?: boolean;
  /**
   * A checksum-pinned release that an older native shell may pass to Android's
   * installer without the 1.0.5 package inspector. Android still enforces the
   * installed app's package name, increasing version code, and signing key.
   */
  legacyVerifiedInstaller?: boolean;
}

type ExpoUpdatesModule = {
  isEnabled?: boolean;
  channel?: string | null;
  checkForUpdateAsync: () => Promise<{ isAvailable: boolean }>;
  fetchUpdateAsync: () => Promise<unknown>;
  reloadAsync: () => Promise<void>;
};

type IntentLauncherModule = {
  startActivityAsync: (
    action: string,
    params?: {
      data?: string;
      flags?: number;
      type?: string;
    }
  ) => Promise<unknown>;
};

type FileSystemProgressData = {
  totalBytesWritten: number;
  totalBytesExpectedToWrite: number;
};

type FileSystemDownloadResult = {
  uri?: string;
};

type FileSystemLegacyModule = {
  cacheDirectory: string | null;
  documentDirectory: string | null;
  createDownloadResumable: (
    uri: string,
    fileUri: string,
    options?: Record<string, unknown>,
    callback?: (progress: FileSystemProgressData) => void
  ) => {
    downloadAsync: () => Promise<FileSystemDownloadResult | undefined>;
  };
  deleteAsync?: (fileUri: string, options?: { idempotent?: boolean }) => Promise<void>;
  getInfoAsync?: (fileUri: string) => Promise<{ exists: boolean; size?: number }>;
  readAsStringAsync?: (
    fileUri: string,
    options: { encoding: 'base64'; position: number; length: number }
  ) => Promise<string>;
  getContentUriAsync: (fileUri: string) => Promise<string>;
};

type NativeUpdateInstallerModule = {
  canRequestPackageInstalls: () => Promise<boolean>;
  validateApk: (fileUri: string, expectedVersion?: string, expectedBuild?: number) => Promise<boolean>;
};

export class InstallPermissionRequiredError extends Error {
  code = 'INSTALL_PERMISSION_REQUIRED';
  constructor() {
    super('Allow HisabTrack to install unknown apps, then return and tap Continue.');
    this.name = 'InstallPermissionRequiredError';
  }
}

export interface UpdateInfo {
  latestVersion: string;
  downloadUrl?: string;
  forceUpdate: boolean;
  releaseNotes?: string;
  updateType: UpdateType;
  latestBuildNumber?: string | number;
  currentVersion?: string;
  currentBuildNumber?: string;
  channel?: string | null;
  /** Expected APK digest, verified before the installer is opened. */
  expectedSha256?: string;
  expectedSize?: number;
  browserOnly?: boolean;
  legacyVerifiedInstaller?: boolean;
}

export interface UpdateInstallProgress {
  phase: UpdatePhase;
  message: string;
  progress?: number;
}

export const UpdateService = {
  compareVersions(v1: string, v2: string): number {
    const v1Parts = v1.split('.').map(Number);
    const v2Parts = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
      const val1 = v1Parts[i] || 0;
      const val2 = v2Parts[i] || 0;
      if (val1 > val2) return 1;
      if (val1 < val2) return -1;
    }
    return 0;
  },

  compareBuildNumbers(v1?: string | number | null, v2?: string | number | null): number {
    const n1 = Number(v1 ?? 0);
    const n2 = Number(v2 ?? 0);

    if (Number.isNaN(n1) || Number.isNaN(n2)) {
      return 0;
    }

    if (n1 > n2) return 1;
    if (n1 < n2) return -1;
    return 0;
  },

  getCurrentVersion(): string {
    return Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '1.0.0';
  },

  getCurrentBuildNumber(): string {
    return Application.nativeBuildVersion
      ?? (Platform.OS === 'android'
        ? String(Constants.expoConfig?.android?.versionCode ?? '')
        : Platform.OS === 'ios'
          ? String(Constants.expoConfig?.ios?.buildNumber ?? '')
          : '');
  },

  getUpdateManifestUrl(): string {
    const configuredUrl = Constants.expoConfig?.extra?.updateManifestUrl;
    if (typeof configuredUrl === 'string' && configuredUrl.trim()) {
      if (!configuredUrl.startsWith('https://')) throw new Error('Update manifests require HTTPS');
      return configuredUrl;
    }
    return DEFAULT_UPDATE_JSON_URL;
  },

  getExpoUpdatesModule(): ExpoUpdatesModule | null {
    try {
      return require('expo-updates') as ExpoUpdatesModule;
    } catch {
      return null;
    }
  },

  getIntentLauncherModule(): IntentLauncherModule | null {
    try {
      return require('expo-intent-launcher') as IntentLauncherModule;
    } catch {
      return null;
    }
  },

  getLegacyFileSystem(): FileSystemLegacyModule | null {
    try {
      return require('expo-file-system/legacy') as FileSystemLegacyModule;
    } catch {
      return null;
    }
  },

  getNativeUpdateInstaller(): NativeUpdateInstallerModule | null {
    try {
      const { NativeModules } = require('react-native') as { NativeModules?: Record<string, NativeUpdateInstallerModule> };
      return NativeModules?.HisabUpdateInstaller ?? null;
    } catch {
      return null;
    }
  },

  getBinaryDownloadUrl(data: BinaryUpdateManifest): string | undefined {
    if (Platform.OS === 'android') {
      return data.androidDownloadUrl ?? data.downloadUrl;
    }

    if (Platform.OS === 'ios') {
      return data.iosDownloadUrl ?? data.downloadUrl;
    }

    return data.downloadUrl;
  },

  /** Lowercase hex digest the manifest promises for this platform's package. */
  getExpectedSha256(data: BinaryUpdateManifest): string | undefined {
    const value = (Platform.OS === 'android' ? data.androidSha256 ?? data.sha256 : data.sha256)?.trim().toLowerCase();
    return value && /^[0-9a-f]{64}$/.test(value) ? value : undefined;
  },

  getExpectedSize(data: BinaryUpdateManifest): number | undefined {
    const value = Platform.OS === 'android' ? data.androidSize ?? data.size : data.size;
    return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
  },

  toHex(value: ArrayBuffer | Uint8Array): string {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    return Array.from(bytes).map(byte => byte.toString(16).padStart(2, '0')).join('');
  },

  /**
   * Hash the downloaded package and compare it with the manifest.
   *
   * Android refuses an update signed by a different key, but that only protects
   * the upgrade path for this exact package name — a download URL pointing at
   * some other package would install as a brand new app. Verifying the digest
   * the publisher committed to closes that, and also catches a truncated or
   * tampered download before the installer ever sees it.
   */
  async verifyDownloadedPackage(
    fileUri: string,
    expected: { sha256?: string; size?: number },
    onProgress?: (progress: number) => void,
  ) {
    if (!expected.sha256) {
      throw new Error('This update is missing its SHA-256 checksum, so it cannot be verified. Update was not installed.');
    }

    const FileSystem = this.getLegacyFileSystem();
    if (!FileSystem?.getInfoAsync || !FileSystem.readAsStringAsync) {
      throw new Error('This app version cannot safely verify the downloaded update.');
    }
    const fileInfo = await FileSystem.getInfoAsync(fileUri);
    const fileSize = Number(fileInfo.size ?? 0);
    if (!fileInfo.exists || !Number.isFinite(fileSize) || fileSize <= 0) {
      throw new Error('The downloaded update could not be read for verification. Please retry the download.');
    }
    const discardFile = async () => {
      await FileSystem.deleteAsync?.(fileUri, { idempotent: true }).catch(() => undefined);
    };

    // Cheap check first: a size mismatch means there is no point hashing.
    if (expected.size !== undefined && fileSize !== expected.size) {
      await discardFile();
      throw new Error('The downloaded update is the wrong size and was discarded. Please try again.');
    }

    // Whole-file reads materialize the complete APK in Java memory. A 103 MB
    // APK can exceed the heap limit on entry-level phones. The legacy native
    // reader is available in both 1.0.4 and 1.0.5 and supports bounded reads.
    const hasher = sha256.create();
    const chunkSize = 1024 * 1024;
    let bytesRead = 0;
    while (bytesRead < fileSize) {
      const requestedLength = Math.min(chunkSize, fileSize - bytesRead);
      const encoded = await FileSystem.readAsStringAsync(fileUri, {
        encoding: 'base64',
        position: bytesRead,
        length: requestedLength,
      });
      const chunk = toByteArray(encoded);
      if (!chunk.length || chunk.length > requestedLength) {
        throw new Error('The downloaded update ended before verification finished. Please retry the download.');
      }
      hasher.update(chunk);
      bytesRead += chunk.length;
      onProgress?.(Math.min(1, bytesRead / fileSize));
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }

    const actual = this.toHex(hasher.digest());
    if (actual !== expected.sha256) {
      // Never leave an unverified APK on disk where a later run might use it.
      await discardFile();
      throw new Error('The downloaded update failed its integrity check and was discarded. It was not installed.');
    }
  },

  getBinaryLatestBuild(data: BinaryUpdateManifest): string | number | undefined {
    return data.latestBuildNumber;
  },

  isBinaryUpdateRequired(data: BinaryUpdateManifest, currentVersion: string, currentBuild: string): boolean {
    const minimumVersion = data.minimumSupportedVersion;
    const minimumBuild = data.minimumSupportedBuildNumber;

    if (minimumVersion && this.compareVersions(currentVersion, minimumVersion) < 0) {
      return true;
    }

    if (minimumBuild !== undefined && this.compareBuildNumbers(currentBuild, minimumBuild) < 0) {
      return true;
    }

    return false;
  },

  async checkForOtaUpdate(): Promise<UpdateInfo | null> {
    if (Platform.OS === 'web' || __DEV__) {
      return null;
    }

    const Updates = this.getExpoUpdatesModule();
    if (!Updates?.checkForUpdateAsync || Updates.isEnabled === false) {
      return null;
    }

    try {
      const result = await Updates.checkForUpdateAsync();
      if (!result?.isAvailable) {
        return null;
      }

      return {
        latestVersion: this.getCurrentVersion(),
        forceUpdate: false,
        releaseNotes: 'A new in-app update is ready to install.',
        updateType: 'ota',
        currentVersion: this.getCurrentVersion(),
        currentBuildNumber: this.getCurrentBuildNumber(),
        channel: Updates.channel ?? null,
      };
    } catch (error) {
      if (__DEV__) {
        console.log('[UpdateService] OTA update check skipped', error);
      }
      return null;
    }
  },

  async checkForBinaryUpdate(): Promise<UpdateInfo | null> {
    try {
      if (Platform.OS === 'web') return null;

      let data: BinaryUpdateManifest | null = Platform.OS === 'android'
        ? BUNDLED_ANDROID_BRIDGE_RELEASE
        : null;
      let usingBundledBridge = data === BUNDLED_ANDROID_BRIDGE_RELEASE;
      try {
        const response = await fetch(this.getUpdateManifestUrl(), {
          headers: {
            'Cache-Control': 'no-cache',
          },
        });
        if (response.ok) {
          const remote = await response.json() as BinaryUpdateManifest;
          // The server wins for an equal version so it can replace the bridge
          // URL with a checksum-protected first-party APK without another OTA.
          if (!data || this.compareVersions(remote.latestVersion, data.latestVersion) >= 0) {
            data = remote;
            usingBundledBridge = false;
          }
        }
      } catch {
        // Android still has the signed bridge release when the host is offline.
      }
      if (!data) return null;
      const currentVersion = this.getCurrentVersion();
      const currentBuildNumber = this.getCurrentBuildNumber();
      const latestBuildNumber = this.getBinaryLatestBuild(data);
      const downloadUrl = this.getBinaryDownloadUrl(data);
      if (downloadUrl && !downloadUrl.startsWith('https://')) throw new Error('Update downloads require HTTPS');
      const isRequired = this.isBinaryUpdateRequired(data, currentVersion, currentBuildNumber);
      const versionCompare = this.compareVersions(data.latestVersion, currentVersion);
      const buildCompare = versionCompare === 0
        ? this.compareBuildNumbers(latestBuildNumber, currentBuildNumber)
        : 0;
      const hasNewerBinary = versionCompare > 0 || buildCompare > 0;

      console.log(
        `[UpdateService] Native current=${currentVersion} (${currentBuildNumber}), latest=${data.latestVersion} (${latestBuildNumber ?? 'n/a'})`
      );

      if (!hasNewerBinary && !isRequired) {
        return null;
      }

      return {
        latestVersion: data.latestVersion,
        latestBuildNumber,
        downloadUrl,
        forceUpdate: Boolean(data.forceUpdate || isRequired),
        releaseNotes: data.releaseNotes,
        expectedSha256: this.getExpectedSha256(data),
        expectedSize: this.getExpectedSize(data),
        browserOnly: Boolean(data.browserOnly),
        // Never let a remote manifest opt an older native shell out of native
        // package inspection. This exception belongs only to the exact APK
        // whose size and digest are compiled into this bridge OTA.
        legacyVerifiedInstaller: usingBundledBridge && Boolean(data.legacyVerifiedInstaller),
        updateType: 'binary',
        currentVersion,
        currentBuildNumber,
      };
    } catch (error) {
      if (__DEV__) {
        console.log('[UpdateService] Binary update check skipped (server unreachable)');
      }
      return null;
    }
  },

  async checkForUpdate(): Promise<UpdateInfo | null> {
    const [otaUpdate, binaryUpdate] = await Promise.all([
      this.checkForOtaUpdate(),
      this.checkForBinaryUpdate(),
    ]);

    if (binaryUpdate?.forceUpdate) {
      return binaryUpdate;
    }

    return otaUpdate ?? binaryUpdate;
  },

  async openUpdateUrl(url: string) {
    if (!url.startsWith('https://')) throw new Error('Update downloads require HTTPS');
    const supported = await Linking.canOpenURL(url);
    if (!supported) {
      Alert.alert('Error', 'Cannot open update URL: ' + url);
      throw new Error('This device cannot open the secure update link.');
    }
    await Linking.openURL(url);
  },

  async canRequestPackageInstalls(): Promise<boolean | null> {
    if (Platform.OS !== 'android') return true;
    const installer = this.getNativeUpdateInstaller();
    if (!installer?.canRequestPackageInstalls) return null;
    return installer.canRequestPackageInstalls();
  },

  async openAndroidInstallPermissionSettings() {
    if (Platform.OS !== 'android') {
      return;
    }

    const IntentLauncher = this.getIntentLauncherModule();
    if (!IntentLauncher?.startActivityAsync) {
      return;
    }

    const applicationId = Application.applicationId
      ?? Constants.expoConfig?.android?.package
      ?? '';

    await IntentLauncher.startActivityAsync('android.settings.MANAGE_UNKNOWN_APP_SOURCES', {
      data: applicationId ? `package:${applicationId}` : undefined,
    });
  },

  async installUpdate(
    updateInfo: UpdateInfo,
    onProgress?: (progress: UpdateInstallProgress) => void
  ) {
    if (updateInfo.updateType === 'ota') {
      const Updates = this.getExpoUpdatesModule();
      if (!Updates?.fetchUpdateAsync || !Updates?.reloadAsync || !Updates?.checkForUpdateAsync) {
        throw new Error('expo-updates is not installed in this build.');
      }

      onProgress?.({
        phase: 'checking',
        message: 'Checking the latest in-app update...',
      });

      const availability = await Updates.checkForUpdateAsync();
      if (!availability?.isAvailable) {
        onProgress?.({
          phase: 'completed',
          message: 'This app is already up to date.',
          progress: 1,
        });
        return;
      }

      onProgress?.({
        phase: 'downloading',
        message: 'Downloading the in-app update...',
      });
      await Updates.fetchUpdateAsync();

      onProgress?.({
        phase: 'reloading',
        message: 'Installing the update...',
        progress: 1,
      });
      // The JS context resets on reload, but a native SQLite handle left
      // open can hold the file lock across it, making the next cold
      // start's init fail with "database is locked". Close it first.
      try {
        const { closeDatabase } = await import('@/services/database');
        await closeDatabase();
      } catch (e) {
        console.warn('UpdateService: failed to close database before reload', e);
      }
      await Updates.reloadAsync();
      return;
    }

    if (updateInfo.downloadUrl && !updateInfo.downloadUrl.startsWith('https://')) throw new Error('Update downloads require HTTPS');
    if (!updateInfo.downloadUrl) {
      throw new Error('No download URL was provided for this update.');
    }

    if (Platform.OS !== 'android') {
      await this.openUpdateUrl(updateInfo.downloadUrl);
      return;
    }

    if (updateInfo.browserOnly) {
      onProgress?.({ phase: 'browser', message: 'Opening the secure download in your browser...' });
      await this.openUpdateUrl(updateInfo.downloadUrl);
      onProgress?.({ phase: 'completed', message: 'Download opened in your browser.', progress: 1 });
      return;
    }

    const FileSystem = this.getLegacyFileSystem();
    const IntentLauncher = this.getIntentLauncherModule();
    const NativeInstaller = this.getNativeUpdateInstaller();

    // Older APKs do not contain the native permission/package inspector. They
    // must use the browser and Android's normal download/install UI instead of
    // receiving an OTA that assumes native code they do not have.
    if (
      !FileSystem?.createDownloadResumable
      || !FileSystem.getContentUriAsync
      || !IntentLauncher?.startActivityAsync
      || (!NativeInstaller && !updateInfo.legacyVerifiedInstaller)
    ) {
      onProgress?.({ phase: 'browser', message: 'Opening the secure download in your browser...' });
      await this.openUpdateUrl(updateInfo.downloadUrl);
      onProgress?.({ phase: 'completed', message: 'Download opened in your browser.', progress: 1 });
      return;
    }

    // A checksum is mandatory for the assisted installer. A browser download
    // remains available, but the app never hands an unverified file directly
    // to Android's package installer.
    if (!updateInfo.expectedSha256) {
      onProgress?.({ phase: 'browser', message: 'Opening the secure download in your browser...' });
      await this.openUpdateUrl(updateInfo.downloadUrl);
      onProgress?.({ phase: 'completed', message: 'Download opened in your browser.', progress: 1 });
      return;
    }

    const installPermission = await this.canRequestPackageInstalls();
    if (installPermission === false) {
      onProgress?.({ phase: 'permission', message: 'Allow HisabTrack to install this update, then return to continue.' });
      await this.openAndroidInstallPermissionSettings();
      throw new InstallPermissionRequiredError();
    }

    const targetDirectory = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
    if (!targetDirectory) {
      throw new Error('No writable directory is available for the update download.');
    }

    const safeVersion = updateInfo.latestVersion.replace(/[^a-zA-Z0-9._-]+/g, '_');
    const targetUri = `${targetDirectory}hisabtrack-${safeVersion}.apk`;
    const existingFile = await FileSystem.getInfoAsync?.(targetUri).catch(() => undefined);
    const canReuseDownload = Boolean(existingFile?.exists)
      && updateInfo.expectedSize !== undefined
      && existingFile?.size === updateInfo.expectedSize;

    if (!canReuseDownload && FileSystem.deleteAsync) {
      await FileSystem.deleteAsync(targetUri, { idempotent: true }).catch(() => undefined);
    }

    let downloadedUri = targetUri;
    if (canReuseDownload) {
      onProgress?.({
        phase: 'downloading',
        message: 'Using the completed update download...',
        progress: 1,
      });
    } else {
      onProgress?.({
        phase: 'downloading',
        message: 'Downloading the Android update package...',
        progress: 0,
      });

      const downloadTask = FileSystem.createDownloadResumable(
        updateInfo.downloadUrl,
        targetUri,
        {},
        (progress) => {
          const total = progress.totalBytesExpectedToWrite;
          const value = total > 0 ? progress.totalBytesWritten / total : undefined;
          const percentage = value !== undefined ? Math.round(value * 100) : null;

          onProgress?.({
            phase: 'downloading',
            message: percentage !== null
              ? `Downloading the Android update package... ${percentage}%`
              : 'Downloading the Android update package...',
            progress: value,
          });
        }
      );

      const result = await downloadTask.downloadAsync();
      if (!result?.uri) {
        throw new Error('The APK download did not finish correctly.');
      }
      downloadedUri = result.uri;
    }

    onProgress?.({
      phase: 'verifying',
      message: 'Verifying the update package...',
      progress: 1,
    });

    // Fails closed: nothing reaches the installer without a matching digest.
    await this.verifyDownloadedPackage(downloadedUri, {
      sha256: updateInfo.expectedSha256,
      size: updateInfo.expectedSize,
    }, (progress) => {
      onProgress?.({
        phase: 'verifying',
        message: `Verifying the update package... ${Math.round(progress * 100)}%`,
        progress,
      });
    });

    // The hash proves that the file matches the server manifest. The native
    // inspector separately proves that it is our package, signed by the same
    // publisher, and that Android sees it as a real upgrade rather than a
    // downgrade or an unrelated app.
    const expectedBuild = updateInfo.latestBuildNumber === undefined
      ? undefined
      : Number(updateInfo.latestBuildNumber);
    if (NativeInstaller) {
      await NativeInstaller.validateApk(
        downloadedUri,
        updateInfo.latestVersion,
        expectedBuild !== undefined && Number.isFinite(expectedBuild) ? expectedBuild : undefined,
      );
    } else if (!updateInfo.legacyVerifiedInstaller) {
      throw new Error('This app version cannot validate the Android update package. Use the browser download instead.');
    }

    onProgress?.({
      phase: 'installing',
      message: 'Opening the Android installer...',
      progress: 1,
    });

    try {
      const contentUri = await FileSystem.getContentUriAsync(downloadedUri);
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        flags: FLAG_GRANT_READ_URI_PERMISSION,
        type: APK_MIME_TYPE,
      });
    } catch (error) {
      const stillAllowed = await this.canRequestPackageInstalls().catch(() => null);
      if (stillAllowed === false) {
        await this.openAndroidInstallPermissionSettings().catch(() => undefined);
        throw new InstallPermissionRequiredError();
      }
      if (updateInfo.legacyVerifiedInstaller && stillAllowed === null) {
        await this.openAndroidInstallPermissionSettings().catch(() => undefined);
        throw new InstallPermissionRequiredError();
      }
      throw new Error('Android could not open the verified update package. You can use the browser download instead.');
    }

    onProgress?.({
      phase: 'completed',
      message: 'Android installer opened.',
      progress: 1,
    });
  },
};

export default UpdateService;
