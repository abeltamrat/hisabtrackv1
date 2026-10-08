import { GoogleGenerativeAI } from '@google/generative-ai';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { loadStoredAppSettings } from '@/contexts/AppSettingsContext';

export class ReceiptOCRService {
  static async extractText(uri: string, explicitConsent: boolean, mimeType = 'image/jpeg'): Promise<string> {
    if (!explicitConsent) throw new Error('Receipt sharing requires your explicit consent.');
    const settings = await loadStoredAppSettings();
    if (!settings.aiSharingEnabled) throw new Error('Enable AI data sharing in Settings before sending a receipt image.');
    if (!settings.geminiApiKey?.trim()) throw new Error('Add a Gemini API key in Settings to recognize receipt images.');
    let base64: string;
    if (Platform.OS === 'web') {
      const blob = await (await fetch(uri)).blob();
      base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(blob); });
    } else base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    const model = new GoogleGenerativeAI(settings.geminiApiKey.trim()).getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent([
      'Transcribe this financial receipt exactly as plain text. Preserve one item per line, amounts, subtotal, discounts, every tax/fee, total, merchant, and date. Do not infer missing content.',
      { inlineData: { data: base64, mimeType } },
    ]);
    return result.response.text().trim();
  }
}
