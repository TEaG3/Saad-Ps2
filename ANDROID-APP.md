# Saad PS2 Android

The repository contains a Capacitor Android wrapper and a native Android Storage Access Framework (SAF) plugin. The web interface uses the same scan, cover-fetch, preview, and artwork-saving workflow on desktop browsers and Android.

## Build a debug APK
1. Open GitHub → Actions → **Build Saad PS2 Android APK**.
2. Select **Run workflow** (or wait for the workflow triggered by a push).
3. Wait for the build job to finish successfully.
4. Download the `saad-ps2-android-apks` artifact (contains `app-debug.apk` and `app-release.apk`), or use the [latest GitHub Release](https://github.com/TEaG3/Saad-Ps2/releases/tag/android-latest).
5. Install it on an Android device.

The release APK is optimized and signed with the temporary Android debug key for sideload testing. It is not a Play Store release and is not signed with a persistent private keystore; updates over builds signed with another key may require uninstalling the previous app first.

## Android storage support
The native `SafStorage` plugin uses Android's Storage Access Framework:
- `pickFolder()` opens the Android system folder picker. Choose the folder that contains `DVD`, `CD`, and `ul.cfg`; an attached USB OTG drive can be selected when Android exposes it.
- `listFiles({uri})` lists the selected directory.
- `readFile({uri, name})` reads small files and artwork.
- `readFileRange({uri, name, offset, length})` reads only the required ISO sectors while identifying a game.
- `writeFile({uri, name, data})` saves artwork.
- `createDirectory({uri, name})` creates `ART` and `ICONS`.

The JavaScript adapter in `app.js` presents SAF directories and files through the same handle methods used by the browser version. The existing game scanner, ISO SYSTEM.CNF reader, ul.cfg parser, online cover lookup, preview, and ART/ICONS saving workflow are therefore shared.

The web assets copied into `www/` before `cap sync` are: `index.html`, `styles.css`, `app.js`, `manifest.webmanifest`, `sw.js`, `icon.svg`, `game-database.js`, `saf-storage-bridge.bundle.js`, and the `database/` catalog files.

## Notes and limitations
- Downloading covers requires an internet connection. Previously saved artwork can be used offline.
- Android's document picker may prevent selecting certain protected system roots. Select the PS2 games folder or another accessible parent folder instead.
- USB OTG behavior depends on the Android device, USB filesystem, and whether Android exposes the drive in its document picker.
- The code has been statically checked, but a successful GitHub Actions build and real-device USB OTG test must be confirmed separately.