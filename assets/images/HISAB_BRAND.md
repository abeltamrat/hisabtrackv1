# Modern Birr coin icon

Created with the built-in image generation tool using the existing Ethiopian
1 Birr coin image as the reference. The original asset is retained.

Design prompt: Modernize the Ethiopian 1 Birr coin into a polished mobile app
logo. Preserve the circular silver rim, warm gold inner disc, right-facing
gold Ethiopian lion with a sweeping mane and open mouth, and the reference
Amharic inscriptions. Use stronger flowing shapes, crisp contours and clean
surfaces without photographic scratches. Transparent exterior, no extra text,
monogram, cast shadow or mockup.

Assets:
- `hisab-coin-source.png`: generated transparent master.
- `hisab-coin-icon.png`: opaque 1024px launcher icon on slate navy.
- `hisab-coin-adaptive.png`: transparent 1024px foreground with safe-area padding; also used for splash.
- `hisab-coin-favicon.png`: 48px browser icon.

Regenerate packaged sizes with `node scripts/generate-brand-assets.cjs`.
Expo configuration references these assets. Existing native projects must be
regenerated and rebuilt for launcher/splash changes to appear; an OTA update
does not replace the installed launcher icon. Notification artwork is separate.

Validated PNG dimensions, opaque launcher alpha, transparent foreground padding,
and Expo configuration parsing. Device rendering has not been tested.
