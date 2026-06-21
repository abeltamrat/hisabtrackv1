import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import * as XLSX from 'xlsx';

export async function saveWorkbook(filename: string, wb: XLSX.WorkBook) {
  if (Platform.OS === 'web') {
    const fileSaver = require('file-saver');
    const saveAs = fileSaver.saveAs || fileSaver.default || fileSaver;
    const arrayBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([arrayBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    saveAs(blob, filename);
    return;
  }

  const base64 = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
  const uri = FileSystem.cacheDirectory + filename;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
}

export async function saveCSV(filename: string, csvContent: string) {
    if (Platform.OS === 'web') {
        const fileSaver = require('file-saver');
        const saveAs = fileSaver.saveAs || fileSaver.default || fileSaver;
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
        saveAs(blob, filename);
        return;
    }

    const uri = FileSystem.cacheDirectory + filename;
    await FileSystem.writeAsStringAsync(uri, csvContent, { encoding: FileSystem.EncodingType.UTF8 });
    if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'text/csv' });
    }
}

export async function saveJSON(filename: string, jsonContent: string) {
    if (Platform.OS === 'web') {
        const fileSaver = require('file-saver');
        const saveAs = fileSaver.saveAs || fileSaver.default || fileSaver;
        const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8' });
        saveAs(blob, filename);
        return;
    }

    const uri = FileSystem.cacheDirectory + filename;
    await FileSystem.writeAsStringAsync(uri, jsonContent, { encoding: FileSystem.EncodingType.UTF8 });
    if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/json' });
    }
}
