import { GoogleGenerativeAI } from '@google/generative-ai';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { loadStoredAppSettings } from '@/contexts/AppSettingsContext';
import { topToolsChatCompletion } from '@/services/TopToolsAIClient';

const RECEIPT_PROMPT = 'Transcribe this financial receipt exactly as plain text. Preserve one item per line, amounts, subtotal, discounts, every tax/fee, total, merchant, and date. Do not infer missing content.';

export class ReceiptOCRService {
  static async extractText(uri: string, explicitConsent: boolean, mimeType = 'image/jpeg'): Promise<string> {
    if (!explicitConsent) throw new Error('Receipt sharing requires your explicit consent.');
    const settings = await loadStoredAppSettings();
    if (!settings.aiSharingEnabled) throw new Error('Enable AI data sharing in Settings before sending a receipt image.');
    const topToolsKey = settings.topToolsApiKey?.trim();
    const geminiKey = settings.geminiApiKey?.trim();
    if (!topToolsKey && !geminiKey) throw new Error('Add a Top Tools AI or Gemini API key in Settings to recognize receipt images.');

    const base64 = await this.readBase64(uri, mimeType);

    if (topToolsKey) {
      try {
        return await this.extractWithTopTools(topToolsKey, base64, mimeType);
      } catch (error) {
        if (!geminiKey) throw error;
        // Fall through to Gemini below.
      }
    }
    return this.extractWithGemini(geminiKey!, base64, mimeType);
  }

  private static async readBase64(uri: string, mimeType: string): Promise<string> {
    if (Platform.OS === 'web') {
      const blob = await (await fetch(uri)).blob();
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }
    return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  }

  private static async extractWithGemini(apiKey: string, base64: string, mimeType: string): Promise<string> {
    const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent([
      RECEIPT_PROMPT,
      { inlineData: { data: base64, mimeType } },
    ]);
    return result.response.text().trim();
  }

  private static async extractWithTopTools(apiKey: string, base64: string, mimeType: string): Promise<string> {
    return topToolsChatCompletion(apiKey, [{
      role: 'user',
      content: [
        { type: 'text', text: RECEIPT_PROMPT },
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
      ],
    }]);
  }
}
