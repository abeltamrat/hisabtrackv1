import * as Crypto from 'expo-crypto';

export const generateUUID = () => {
  return Crypto.randomUUID();
};
