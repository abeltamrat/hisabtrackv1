const fs = require('fs');
const path = require('path');

// Read the et.ts file
const etPath = path.join(__dirname, 'et.ts');
const content = fs.readFileSync(etPath, 'utf8');

// Extract base64 data
const base64Regex = /url: 'data:image\/(png|jpeg);base64,([^']+)'/g;
let match;
const images = [];
while ((match = base64Regex.exec(content)) !== null) {
  const type = match[1];
  const base64 = match[2];
  images.push({ type, base64 });
}

// Function to decode base64
function decodeBase64(base64, outputPath) {
  const buffer = Buffer.from(base64, 'base64');
  fs.writeFileSync(outputPath, buffer);
}

// Save images
const imagesDir = path.join(__dirname, 'images');
if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir);
}

const bankNames = [
  'CommercialBankOfEthiopia',
  'AwashBank',
  'DashenBank',
  'BankOfAbyssinia',
  'NibInternationalBank',
  'CooperativeBankOfOromia',
  'WegagenBank',
  'BerhanBank',
  'HibretBank',
  'ZemenBank',
  'Awach'
];

images.forEach((img, index) => {
  const filename = `${bankNames[index]}.${img.type}`;
  const outputPath = path.join(imagesDir, filename);
  decodeBase64(img.base64, outputPath);
  console.log(`Saved ${filename}`);
});

console.log('All images extracted.');