import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Text, TouchableOpacity, View } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { UpdateInfo, UpdateInstallProgress, UpdateService } from '@/services/UpdateService';

interface UpdateModalProps {
  visible: boolean;
  updateInfo: UpdateInfo | null;
  onClose: () => void;
}

export default function UpdateModal({ visible, updateInfo, onClose }: UpdateModalProps) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<UpdateInstallProgress | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setBusy(false);
      setStatus(null);
      setErrorMessage(null);
    }
  }, [visible, updateInfo?.latestVersion]);

  const actionLabel = useMemo(() => {
    if (!updateInfo) return 'Update Now';
    if (busy) return 'Working...';
    if (updateInfo.updateType === 'ota') return 'Install In-App Update';
    return 'Download and Install';
  }, [busy, updateInfo]);

  if (!updateInfo) return null;

  const handleUpdate = async () => {
    try {
      setBusy(true);
      setErrorMessage(null);
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
      const message = error instanceof Error ? error.message : 'Failed to start the update.';
      setErrorMessage(message);
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
        <View className="bg-white dark:bg-slate-800 rounded-3xl p-6 w-full max-w-sm shadow-2xl items-center">
          <View className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full justify-center items-center mb-4">
            <FontAwesome
              name={updateInfo.updateType === 'ota' ? 'refresh' : 'cloud-download'}
              size={32}
              color="#2563eb"
            />
          </View>

          <Text className="text-xl font-bold text-slate-900 dark:text-white mb-2 text-center">
            {updateInfo.forceUpdate ? 'Update Required' : 'Update Available'}
          </Text>

          <Text className="text-slate-600 dark:text-slate-300 text-center mb-2">
            {updateInfo.updateType === 'ota'
              ? 'A new in-app update is ready for this version of HisabTrack.'
              : `Version ${updateInfo.latestVersion} is now available.`}
          </Text>

          {updateInfo.releaseNotes && (
            <Text className="text-slate-500 text-sm text-center mb-4 italic">
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

          {!updateInfo.forceUpdate && !busy && (
            <TouchableOpacity onPress={onClose} className="py-2">
              <Text className="text-slate-500 dark:text-slate-400 font-medium">Maybe Later</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}
