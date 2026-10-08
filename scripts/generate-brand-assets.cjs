// Resize/package the generated coin artwork for Expo; no generation API needed.
const fs = require('node:fs');
const path = require('node:path');
const { generateImageAsync, generateImageBackgroundAsync, compositeImagesAsync } = require('@expo/image-utils');
const projectRoot = path.resolve(__dirname, '..');
const directory = path.join(projectRoot, 'assets/images');
const backgroundColor = '#0f172a';

async function resize(size, background) {
  return (await generateImageAsync({ projectRoot }, {
    src: path.join(directory, 'hisab-coin-source.png'),
    width: size, height: size, resizeMode: 'contain',
    backgroundColor: background || 'transparent',
    removeTransparency: Boolean(background),
  })).source;
}

async function main() {
  fs.writeFileSync(path.join(directory, 'hisab-coin-loader.png'), await resize(192));
  fs.writeFileSync(path.join(directory, 'hisab-coin-icon.png'), await resize(1024, backgroundColor));
  fs.writeFileSync(path.join(directory, 'hisab-coin-favicon.png'), await resize(48, backgroundColor));
  const foreground = await resize(768);
  const background = await generateImageBackgroundAsync({ width: 1024, height: 1024, backgroundColor: 'transparent', resizeMode: 'contain' });
  fs.writeFileSync(path.join(directory, 'hisab-coin-adaptive.png'), await compositeImagesAsync({ foreground, background, x: 128, y: 128 }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
