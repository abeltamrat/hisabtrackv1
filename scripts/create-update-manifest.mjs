import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

function argsToObject(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!name?.startsWith('--') || value === undefined) {
      throw new Error('Arguments must use --name value pairs.');
    }
    result[name.slice(2)] = value;
  }
  return result;
}

const args = argsToObject(process.argv.slice(2));
if (!args.apk || !args.url || !args.build || !/^\d+$/.test(args.build)) {
  throw new Error('Usage: npm run update:manifest -- --apk <signed.apk> --url <https-url> --build <EAS-build-number> [--notes <text>] [--force true] [--out update.json]');
}
if (!args.url.startsWith('https://')) {
  throw new Error('The APK URL must use HTTPS.');
}

const root = process.cwd();
const appConfig = JSON.parse(await readFile(path.join(root, 'app.json'), 'utf8')).expo;
const apkPath = path.resolve(root, args.apk);
const apkBytes = await readFile(apkPath);
const apkStat = await stat(apkPath);
const manifest = {
  latestVersion: appConfig.version,
  // EAS uses remote app-version state in this project, so the generated APK's
  // build number must be supplied from the completed EAS build record.
  latestBuildNumber: Number(args.build),
  androidDownloadUrl: args.url,
  androidSha256: createHash('sha256').update(apkBytes).digest('hex'),
  androidSize: apkStat.size,
  forceUpdate: args.force === 'true',
  releaseNotes: args.notes ?? `HisabTrack ${appConfig.version}`,
};
const outputPath = path.resolve(root, args.out ?? 'update.json');
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Wrote ${outputPath}`);
console.log(`SHA-256 ${manifest.androidSha256}`);
