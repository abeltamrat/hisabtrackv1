import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { Linking, Platform } from 'react-native';
import { Alert } from '@/utils/alert';

const DEFAULT_UPDATE_JSON_URL = 'https://www.hisab.nonstopplc.com/update.json';
const APK_MIME_TYPE = 'application/vnd.android.package-archive';
const FLAG_GRANT_READ_URI_PERMISSION = 1;

type UpdateType = 'ota' | 'binary';
type UpdatePhase = 'checking' | 'downloading' | 'installing' | 'reloading' | 'completed';

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
  getContentUriAsync: (fileUri: string) => Promise<string>;
};

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

  toHex(buffer: ArrayBuffer): string {
    return Array.from(new Uint8Array(buffer)).map(byte => byte.toString(16).padStart(2, '0')).join('');
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
  async verifyDownloadedPackage(fileUri: string, expected: { sha256?: string; size?: number }) {
    if (!expected.sha256) {
      throw new Error('This update is missing its SHA-256 checksum, so it cannot be verified. Update was not installed.');
    }

    const { File } = require('expo-file-system') as {
      File: new (uri: string) => {
        exists: boolean;
        size: number;
        bytes(): Promise<Uint8Array<ArrayBuffer>>;
        delete(): void;
      };
    };
    const Crypto = require('expo-crypto') as {
      digest(algorithm: string, data: BufferSource): Promise<ArrayBuffer>;
      CryptoDigestAlgorithm: Record<string, string>;
    };

    const file = new File(fileUri);
    if (!file.exists) throw new Error('The downloaded update could not be read for verification.');

    // Cheap check first: a size mismatch means there is no point hashing.
    if (expected.size !== undefined && file.size !== expected.size) {
      file.delete();
      throw new Error('The downloaded update is the wrong size and was discarded. Please try again.');
    }

    const actual = this.toHex(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, await file.bytes()));
    if (actual !== expected.sha256) {
      // Never leave an unverified APK on disk where a later run might use it.
      file.delete();
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

      const response = await fetch(this.getUpdateManifestUrl(), {
        headers: {
          'Cache-Control': 'no-cache',
        },
      });

      if (!response.ok) {
        console.warn('[UpdateService] Failed to fetch update info');
        return null;
      }

      const data = await response.json() as BinaryUpdateManifest;
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

  openUpdateUrl(url: string) {
    if (!url.startsWith('https://')) throw new Error('Update downloads require HTTPS');
    Linking.canOpenURL(url).then(supported => {
      if (supported) {
        Linking.openURL(url);
      } else {
        Alert.alert('Error', 'Cannot open update URL: ' + url);
      }
    });
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
      await Updates.reloadAsync();
      return;
    }

    if (updateInfo.downloadUrl && !updateInfo.downloadUrl.startsWith('https://')) throw new Error('Update downloads require HTTPS');
    if (!updateInfo.downloadUrl) {
      throw new Error('No download URL was provided for this update.');
    }

    if (Platform.OS !== 'android') {
      this.openUpdateUrl(updateInfo.downloadUrl);
      return;
    }

    const FileSystem = this.getLegacyFileSystem();
    const IntentLauncher = this.getIntentLauncherModule();

    if (!FileSystem?.createDownloadResumable || !FileSystem.getContentUriAsync || !IntentLauncher?.startActivityAsync) {
      throw new Error('The Android in-app installer dependencies are not available in this build.');
    }

    const targetDirectory = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
    if (!targetDirectory) {
      throw new Error('No writable directory is available for the update download.');
    }

    const safeVersion = updateInfo.latestVersion.replace(/[^a-zA-Z0-9._-]+/g, '_');
    const targetUri = `${targetDirectory}hisabtrack-${safeVersion}.apk`;

    if (FileSystem.deleteAsync) {
      await FileSystem.deleteAsync(targetUri, { idempotent: true }).catch(() => undefined);
    }

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

    onProgress?.({
      phase: 'installing',
      message: 'Verifying the update package...',
      progress: 1,
    });

    // Fails closed: nothing reaches the installer without a matching digest.
    await this.verifyDownloadedPackage(result.uri, {
      sha256: updateInfo.expectedSha256,
      size: updateInfo.expectedSize,
    });

    onProgress?.({
      phase: 'installing',
      message: 'Opening the Android installer...',
      progress: 1,
    });

    try {
      const contentUri = await FileSystem.getContentUriAsync(result.uri);
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        flags: FLAG_GRANT_READ_URI_PERMISSION,
        type: APK_MIME_TYPE,
      });
    } catch (error) {
      await this.openAndroidInstallPermissionSettings().catch(() => undefined);
      throw new Error('Android blocked the installer. Allow installs from this app and try again.');
    }

    onProgress?.({
      phase: 'completed',
      message: 'Android installer opened.',
      progress: 1,
    });
  },
};

export default UpdateService;
