export type BundledLogo = {
  name: string;
  src: any; // require() result for native/static rendering
  url: string; // editable string URL (used in edit textbox)
};

// Helper function to convert filename to readable bank name
// e.g., "CommercialBankOfEthiopia" -> "Commercial Bank Of Ethiopia"
function filenameToName(filename: string): string {
  // Remove extension
  const nameWithoutExt = filename.replace(/\.(jpeg|jpg|png|gif|webp)$/i, '');
  
  // Add spaces before capital letters (camelCase to words)
  const withSpaces = nameWithoutExt.replace(/([A-Z])/g, ' $1').trim();
  
  return withSpaces;
}

// Automatically load all images from the images folder
// Add new banks by simply adding image files to assets/bankLogos/images/
const imageContext = {
  'Awach.jpeg': require('@/assets/bankLogos/images/Awach.jpeg'),
  'AwashBank.png': require('@/assets/bankLogos/images/AwashBank.png'),
  'BankOfAbyssinia.jpeg': require('@/assets/bankLogos/images/BankOfAbyssinia.jpeg'),
  'BerhanBank.png': require('@/assets/bankLogos/images/BerhanBank.png'),
  'CommercialBankOfEthiopia.jpeg': require('@/assets/bankLogos/images/CommercialBankOfEthiopia.jpeg'),
  'CooperativeBankOfOromia.jpeg': require('@/assets/bankLogos/images/CooperativeBankOfOromia.jpeg'),
  'DashenBank.jpeg': require('@/assets/bankLogos/images/DashenBank.jpeg'),
  'HibretBank.jpeg': require('@/assets/bankLogos/images/HibretBank.jpeg'),
  'NibInternationalBank.jpeg': require('@/assets/bankLogos/images/NibInternationalBank.jpeg'),
  'WegagenBank.png': require('@/assets/bankLogos/images/WegagenBank.png'),
  'ZemenBank.png': require('@/assets/bankLogos/images/ZemenBank.png'),
};

// Generate bundled logos array from image files
export const BUNDLED_LOGOS: BundledLogo[] = Object.entries(imageContext).map(([filename, rawSrc]) => {
  // Handle ES modules (ensure we get the actual source)
  const src = (rawSrc && typeof rawSrc === 'object' && 'default' in rawSrc) ? rawSrc.default : rawSrc;

  return {
    name: filenameToName(filename),
    src,
    url: `/assets/bankLogos/images/${filename}`,
  };
});

export default BUNDLED_LOGOS;
