import Constants from 'expo-constants';
import * as Sharing from 'expo-sharing';
import { Platform, Share } from 'react-native';

import UpdateService from './UpdateService';

const APP_PAGE_URL = 'https://www.hisab.nonstopplc.com';
const APK_MIME_TYPE = 'application/vnd.android.package-archive';

interface ShareManifest {
  latestVersion?: string;
  downloadUrl?: string;
  androidDownloadUrl?: string;
  androidSha256?: string;
  sha256?: string;
  androidSize?: number;
  size?: number;
}

export interface AppShareProgress {
  message: string;
  progress?: number;
}

async function getManifest(): Promise<ShareManifest> {
  const response = await fetch(UpdateService.getUpdateManifestUrl(), {
    headers: { 'Cache-Control': 'no-cache' },
  });
  if (!response.ok) throw new Error('The app download information is unavailable right now.');
  return response.json() as Promise<ShareManifest>;
}

function secureAndroidUrl(manifest: ShareManifest): string {
  const url = manifest.androidDownloadUrl ?? manifest.downloadUrl;
  if (!url || !url.startsWith('https://')) {
    throw new Error('APK sharing is temporarily unavailable because the download link is not secure.');
  }
  return url;
}

function shareMessage(url: string): string {
  return `Try Hisab Track — a simple way to track spending, accounts, budgets, and loans.\n\nInstall it here: ${url}`;
}

export const AppShareService = {
  async shareInstallLink() {
    let url = APP_PAGE_URL;
    try {
      const candidate = secureAndroidUrl(await getManifest());
      // Share the direct installer only after confirming the server returns an APK.
      const response = await fetch(candidate, { method: 'HEAD' });
      const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
      const isPackage = contentType.includes(APK_MIME_TYPE) || contentType.includes('application/octet-stream');
      if (response.ok && isPackage) {
        url = candidate;
      }
    } catch {
      // The public app page remains useful if the binary manifest is unavailable.
    }

    await Share.share({
      title: 'Share Hisab Track',
      message: shareMessage(url),
      ...(Platform.OS === 'ios' ? { url } : {}),
    });
  },

  async shareApk(onProgress?: (progress: AppShareProgress) => void) {
    if (Platform.OS !== 'android') {
      throw new Error('APK file sharing is available on Android. You can share the install link on this device.');
    }
    if (!(await Sharing.isAvailableAsync())) {
      throw new Error('File sharing is not available on this device.');
    }

    onProgress?.({ message: 'Checking the latest APK…' });
    const manifest = await getManifest();
    const url = secureAndroidUrl(manifest);
    const sha256 = (manifest.androidSha256 ?? manifest.sha256)?.trim().toLowerCase();
    const expectedSize = manifest.androidSize ?? manifest.size;
    if (!sha256 || !/^[0-9a-f]{64}$/.test(sha256)) {
      throw new Error('The APK cannot be shared until its security checksum is published. Share the install link instead.');
    }

    const FileSystem = UpdateService.getLegacyFileSystem();
    const targetDirectory = FileSystem?.cacheDirectory ?? FileSystem?.documentDirectory;
    if (!FileSystem?.createDownloadResumable || !targetDirectory) {
      throw new Error('APK downloading is not available in this build.');
    }

    const version = (manifest.latestVersion ?? Constants.expoConfig?.version ?? 'latest')
      .replace(/[^a-zA-Z0-9._-]+/g, '_');
    const targetUri = `${targetDirectory}HisabTrack-${version}.apk`;
    await FileSystem.deleteAsync?.(targetUri, { idempotent: true }).catch(() => undefined);

    const download = FileSystem.createDownloadResumable(url, targetUri, {}, event => {
      const progress = event.totalBytesExpectedToWrite > 0
        ? event.totalBytesWritten / event.totalBytesExpectedToWrite
        : undefined;
      onProgress?.({
        message: progress === undefined ? 'Downloading APK…' : `Downloading APK… ${Math.round(progress * 100)}%`,
        progress,
      });
    });
    const result = await download.downloadAsync();
    if (!result?.uri) throw new Error('The APK download did not finish correctly.');

    onProgress?.({ message: 'Verifying APK…', progress: 1 });
    await UpdateService.verifyDownloadedPackage(result.uri, {
      sha256,
      size: typeof expectedSize === 'number' ? expectedSize : undefined,
    });
    onProgress?.({ message: 'Opening share options…', progress: 1 });
    await Sharing.shareAsync(result.uri, {
      mimeType: APK_MIME_TYPE,
      dialogTitle: 'Share Hisab Track APK',
      UTI: 'public.data',
    });
  },
};

export default AppShareService;
