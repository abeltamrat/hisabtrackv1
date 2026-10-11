import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Text, TouchableOpacity, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useTheme } from '@/contexts/ThemeContext';
import { InstallPermissionRequiredError, UpdateInfo, UpdateInstallProgress, UpdateService } from '@/services/UpdateService';
import UpdateCoinBadge from './UpdateCoinBadge';

interface UpdateModalProps {
  visible: boolean;
  updateInfo: UpdateInfo | null;
  onClose: () => void;
}

export default function UpdateModal({ visible, updateInfo, onClose }: UpdateModalProps) {
  const { isAurora } = useTheme();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<UpdateInstallProgress | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [permissionRequired, setPermissionRequired] = useState(false);

  useEffect(() => {
    if (!visible) {
      setBusy(false);
      setStatus(null);
      setErrorMessage(null);
      setPermissionRequired(false);
    }
  }, [visible, updateInfo?.latestVersion]);

  const actionLabel = useMemo(() => {
    if (!updateInfo) return 'Update Now';
    if (busy) return 'Working...';
    if (updateInfo.updateType === 'ota') return 'Install In-App Update';
    if (permissionRequired) return 'Check Permission & Continue';
    return 'Download and Install';
  }, [busy, permissionRequired, updateInfo]);

  if (!updateInfo) return null;

  const handleUpdate = async () => {
    try {
      setBusy(true);
      setErrorMessage(null);
      setPermissionRequired(false);
      setStatus({
        phase: 'checking',
        message: updateInfo.updateType === 'ota'
          ? 'Preparing the in-app update...'
          : 'Preparing the download...',
      });

      await UpdateService.installUpdate(updateInfo, (progress) => {
        setStatus(progress);
      });

      if (updateInfo.updateType === 'binary' && !updateInfo.forceUpdate) {
        onClose();
      }
    } catch (error) {
      if (error instanceof InstallPermissionRequiredError || (error as { code?: string })?.code === 'INSTALL_PERMISSION_REQUIRED') {
        setPermissionRequired(true);
      }
      const message = error instanceof Error ? error.message : 'Failed to start the update.';
      setErrorMessage(message);
    } finally {
      setBusy(false);
    }
  };

  const handleBrowserDownload = async () => {
    if (!updateInfo.downloadUrl) return;
    try {
      setBusy(true);
      setErrorMessage(null);
      setStatus({ phase: 'browser', message: 'Opening the secure download in your browser...' });
      await UpdateService.openUpdateUrl(updateInfo.downloadUrl);
      setStatus({ phase: 'completed', message: 'Download opened in your browser.', progress: 1 });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not open the download link.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!updateInfo.forceUpdate && !busy) {
          onClose();
        }
      }}
    >
      <View className="flex-1 bg-black/60 justify-center items-center px-6">
        <View
          // dark:bg-slate-900 (not -800): this card stands alone, with
          // nothing else backing it, unlike a card nested inside a sheet —
          // slate-800's ~8%-opaque glass fill was nearly invisible here,
          // especially if BlurView doesn't render on a given device.
          className="bg-white dark:bg-slate-900 rounded-3xl p-6 w-full max-w-sm shadow-2xl items-center"
          style={isAurora ? { overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' } : undefined}
        >
          {isAurora && (
            <BlurView intensity={36} tint="dark" pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
          )}
          <UpdateCoinBadge />

          <Text className="text-xl font-bold text-slate-900 dark:text-white mb-2 text-center">
            {updateInfo.forceUpdate ? 'Update Required' : 'Update Available'}
          </Text>

          <Text className="text-slate-600 dark:text-slate-300 text-center mb-2">
            {updateInfo.updateType === 'ota'
              ? 'A new in-app update is ready for this version of HisabTrack.'
              : `A new HisabTrack version is ready to download and install.`}
          </Text>

          {updateInfo.updateType === 'binary' && (
            <Text className="text-slate-700 dark:text-slate-200 text-sm text-center mb-3">
              {updateInfo.currentVersion ?? 'Current'}{updateInfo.currentBuildNumber ? ` (${updateInfo.currentBuildNumber})` : ''}
              {'  →  '}
              {updateInfo.latestVersion}{updateInfo.latestBuildNumber ? ` (${updateInfo.latestBuildNumber})` : ''}
            </Text>
          )}

          {updateInfo.releaseNotes && (
            <Text className="text-slate-600 dark:text-slate-300 text-sm text-center mb-4 italic">
              {updateInfo.releaseNotes}
            </Text>
          )}

          {status && (
            <View className="w-full mb-4">
              <Text className="text-slate-600 dark:text-slate-300 text-sm text-center mb-3">
                {status.message}
              </Text>
              <View className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                <View
                  className="h-full bg-blue-600"
                  style={{ width: `${Math.max(8, Math.round((status.progress ?? 0.1) * 100))}%` }}
                />
              </View>
            </View>
          )}

          {errorMessage && (
            <Text className="text-red-500 text-sm text-center mb-4">
              {errorMessage}
            </Text>
          )}

          <TouchableOpacity
            onPress={handleUpdate}
            disabled={busy}
            className={`w-full py-3 rounded-xl items-center mb-3 ${busy ? 'bg-blue-400' : 'bg-blue-600'}`}
          >
            <Text className="text-white font-bold text-lg">{actionLabel}</Text>
          </TouchableOpacity>

          {updateInfo.updateType === 'binary' && updateInfo.downloadUrl && !busy && (
            <TouchableOpacity onPress={handleBrowserDownload} className="py-2 mb-1">
              <Text className="text-blue-600 dark:text-blue-300 font-semibold">Download in Browser</Text>
            </TouchableOpacity>
          )}

          {!updateInfo.forceUpdate && !busy && (
            <TouchableOpacity onPress={onClose} className="py-2">
              <Text className="text-slate-600 dark:text-slate-300 font-medium">Maybe Later</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}
