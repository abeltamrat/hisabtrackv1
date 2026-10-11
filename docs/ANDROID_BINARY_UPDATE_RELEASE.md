# Android binary update release

HisabTrack checks `https://www.hisab.nonstopplc.com/update.json` for a newer native version. Publish the manifest only after the signed APK is available at its final HTTPS URL. This order prevents users from seeing an update that they cannot download.

1. Commit and push all release changes to `master`.
2. Increase `expo.version` in `app.json`. EAS owns this project's Android build number remotely and `autoIncrement` must produce a number higher than the installed APK.
3. Build the signed preview APK from that commit, note the Android build number shown by EAS, and download the APK locally.
4. Upload the APK to its final HTTPS URL. Confirm the URL downloads the APK without a redirect to HTTP.
5. Generate the manifest from the exact uploaded APK:

   ```powershell
   npm run update:manifest -- --apk .\dist\hisabtrack-1.0.5.apk --url https://www.hisab.nonstopplc.com/hisabtrack-1.0.5.apk --build 103 --notes "HisabTrack 1.0.5" --out .\dist\update.json
   ```

6. Compare the server APK's SHA-256 and size with the generated manifest, then upload `update.json` last.
7. Test from the previous production APK: notice appears, permission screen opens when needed, progress moves, Android shows the HisabTrack update confirmation, and the user's local data remains after installation.

The app checks Android's per-source install permission before downloading. If the current APK lacks the native helper or the manifest lacks a valid SHA-256, it opens the HTTPS browser download instead. Before handing an APK to Android, version 1.0.5 verifies its size, SHA-256, package name, version, increasing build number, and signing certificate. Android still requires the user to confirm installation.

To stop offering a bad release, restore the previous `update.json`. Do not reuse an existing version code for a replacement APK.
