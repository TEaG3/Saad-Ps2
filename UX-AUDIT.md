# Saad PS2 — UX & Functional Audit
Date: 2026-11-04
Repository: TEaG3/Saad-Ps2
Audit base: main @ 193c7fb2327760ad8f778b63fda6e1ae97dc8da2
Working branch: ux/audit-and-mobile-refresh

## 1. Scope and safety
This audit records the current user-facing structure and the functional paths that must remain intact during the redesign. The backup branch `backup/baseline-before-ux-redesign-2026-11-04` is a protected reference and must not be modified. All proposed changes belong on this working branch until reviewed and tested. No claim of physical USB/OTG or device testing is made by this static audit.

## 2. Product purpose and primary workflow
Saad PS2 is a focused PlayStation 2 artwork utility, not a game-discovery or storefront product. Its core workflow remains:
1. Select the PS2 games root folder / USB storage.
2. Scan game folders and identify ISO and split-game entries.
3. Extract and normalize Game IDs.
4. Check existing artwork and identify missing cover/icon files.
5. Fetch artwork from online sources or a selected offline artwork folder.
6. Preview or manually supply artwork when needed.
7. Save cover files into `ART` and icons into `ICONS`.
8. Verify saved bytes, report failures, and allow retry.

## 3. Existing interface inventory
### Main navigation and install/update
- Saad PS2 brand header.
- Android APK download link.
- PWA install button with platform-specific guidance.
- App update notice with dismiss action.
- Unsupported-browser notice.

### Storage and scan controls
- USB/root-folder selection.
- Rescan action.
- Offline artwork folder selection.
- Online/offline source selector.
- Missing-artwork sync action.
- Full overwrite/update action with confirmation.
- Progress panel with status, count, progress bar, and cancel action.
- Completion report and retry-failed action.

### Statistics and database
- Total games, ISO games, ul.cfg games, ready games, and missing-artwork counts.
- Local game database count and catalog count.
- Database sync status and last-sync display.
- Database refresh/sync action.
- Database backup export action.

### Games and artwork presentation
- Search by game name / Game ID.
- Filter and sort controls.
- Grid and list/table views.
- Cover preview modal.
- Per-game artwork download and manual image actions.
- Empty state.

## 4. Functional paths found in source
The current `index.html` contains dedicated functions for:
- Storage selection and file access: `pickStorageFolder`, `writeFile`, `listDir`.
- Game identification: `readSystemCnfId`, `extractGameIdFromIso`, `parseUlCfg`, `scanIsoFolder`, `scanUsbDrive`.
- Artwork detection and rendering: `checkExistingArtwork`, `scanAndSyncArtwork`, `render`, `getVisibleGames`, `attachPreviews`.
- Image processing: `decodeImage`, `toCoverJpeg`, `toIconPng`, `saveArtwork`.
- Artwork sources and batch work: `fetchGameCoverBlob`, `processGame`, `runBatch`, `showReport`.
- Database: `refreshDatabasePanel`, `syncGameDatabase`, backup export handler.
- PWA lifecycle: install prompt, app-installed state, service-worker registration, app-update check.
- Android SAF bridge is included separately and is built into the Android package by the existing workflow.

## 5. Static structure checks
- Main page is Arabic-first (`lang="ar"`, `dir="rtl"`).
- HTML IDs were inventoried and checked for duplicates; no duplicate IDs were found in this pass.
- Existing responsive breakpoints: 820px, 700px, and 520px.
- At <=820px the browse layout becomes one column.
- At <=700px the games table is transformed into stacked mobile rows and the statistics use two columns.
- At <=520px the compact top navigation is adjusted.
- Existing global font stack is Segoe UI / Tahoma / Verdana; there is no dedicated Arabic webfont declared in the current page.
- The page already includes visible focus styling via `:focus-visible`.

## 6. Important behavior and data contracts to preserve
- ISO parsing and SYSTEM.CNF Game ID extraction.
- `ul.cfg` parsing and split-game detection.
- Existing online cover URL fallback logic and offline filename variants.
- Existing cover/icon conversion and naming conventions.
- Destination folders `ART` and `ICONS`.
- Save verification by reading back the saved file and comparing byte length.
- Retry behavior for failed items and cancel behavior for batch operations.
- IndexedDB/local catalog synchronization and database export.
- PWA manifest/service worker behavior.
- Capacitor + Android Storage Access Framework (SAF) integration.
- GitHub Actions APK workflow and release publication path.

## 7. UX findings and recommended order
### Priority 1 — Visual hierarchy and typography
- Introduce a restrained, consistent palette through CSS variables rather than scattered one-off colors.
- Use a legible Arabic-first font stack; keep technical IDs and paths in a monospace stack with LTR direction.
- Reduce decorative glow and heavy gradients; preserve clear active, success, warning, and error states.
- Standardize heading sizes, button heights, card padding, border radii, and focus indicators.

### Priority 2 — Mobile and tablet usability
- Verify the top navigation and primary actions at narrow widths.
- Keep USB selection and source mode prominent without forcing horizontal scrolling.
- Improve spacing and touch targets for scan, sync, cancel, and retry actions.
- Ensure the search/filter toolbar wraps cleanly on phones.
- Check long game names, IDs, and action buttons for overflow.
- Preserve the mobile stacked game-row layout.

### Priority 3 — Workflow clarity
- Make the sequence visually obvious: choose storage → scan → inspect missing items → sync → review report.
- Keep progress compact and readable; distinguish the progress percentage from the status text.
- Ensure database maintenance remains secondary to the main artwork workflow.

### Priority 4 — Accessibility and resilience
- Preserve keyboard focus visibility.
- Check text/background contrast for muted text and colored status badges.
- Ensure status changes remain understandable without color alone.
- Avoid layout shifts when notices/reports appear.

## 8. Risks / items requiring runtime testing
Static source inspection cannot prove:
- Browser permission behavior for folder access.
- USB OTG behavior across Android devices and filesystem providers.
- SAF read/write compatibility on actual USB drives.
- PWA install/update behavior on each supported browser.
- Real image-source availability and CORS behavior.
- APK build success and runtime behavior.

These require GitHub Actions checks plus real browser/device tests. Do not describe them as passed until those tests are performed.

## 9. Change strategy
1. Make CSS-only visual changes first, with no JavaScript or storage logic changes.
2. Check the diff to confirm that functional code and element IDs remain unchanged.
3. Run available syntax/build checks.
4. Test desktop, tablet, and phone layouts.
5. Test browser folder access and Android SAF/USB OTG separately.
6. Keep changes on `ux/audit-and-mobile-refresh`; do not merge into `main` or alter the backup branch until validation and review are complete.
