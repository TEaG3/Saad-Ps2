# Saad PS2 Android

This repository includes a Capacitor Android build pipeline and an Android Storage Access Framework (SAF) plugin.

## Build APK
1. Open GitHub → Actions → **Build Saad PS2 Android APK**.
2. Select **Run workflow**.
3. Download the `saad-ps2-debug-apk` artifact when the run succeeds.
4. Install `app-debug.apk` on an Android device.

The workflow creates a debug APK. It is not a Play Store release and is not signed with a private release key.

## Native storage bridge
The Android plugin exposes `SafStorage` methods:
- `pickFolder()` — Android system folder picker (phone storage or USB OTG when mounted).
- `listFiles({uri?})`
- `readFile({name, uri?})` — Base64 content.
- `writeFile({name, data, uri?})` — Base64 content.
- `createDirectory({name, uri?})`

**Integration status:** the native SAF layer is added, but the current web UI still calls the browser File System Access API. A JavaScript storage adapter is still required before the existing scan/download workflow can use SAF end-to-end. Do not treat this build as completed OTG support until that adapter is integrated and tested.
