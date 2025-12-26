import { IDatabase } from '@/types/database';
import { Platform } from 'react-native';
import { WebDatabase } from './web';

let database: IDatabase;

if (Platform.OS === 'web') {
  database = new WebDatabase();
} else {
  // Lazy load AndroidDatabase to avoid importing expo-sqlite on web
  const { AndroidDatabase } = require('./android');
  database = new AndroidDatabase();
}

export const getDatabase = async (): Promise<IDatabase> => {
  await database.init();
  return database;
};
