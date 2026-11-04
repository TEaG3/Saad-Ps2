# Saad PS2 — Baseline Backup

This branch preserves the project exactly as it existed before the planned UX and responsive-interface improvements.

- **Project:** Saad PS2 Artwork Station
- **Backup date:** 2026-11-04
- **Source branch:** main
- **Source commit:** 4833d76912ba70bab58278ca0186debb1ad07553
- **Backup branch:** backup/baseline-before-ux-redesign-2026-11-04

## Preservation policy

Treat this branch as a read-only baseline. Do not apply redesigns, refactors, dependency upgrades, or feature changes here. Make future work on a separate development branch and merge only after review and testing.

## Original product purpose

A focused utility for scanning PlayStation 2 game storage and managing OPL-compatible artwork. It is not intended to become a general game-discovery or storefront website.

## Existing core workflows preserved in this snapshot

- Select a USB/game folder and scan ISO files.
- Read game identifiers from ISO9660 SYSTEM.CNF.
- Parse split-game entries from ul.cfg.
- Match and retrieve cover artwork online or from a local offline folder.
- Preview covers and save standardized artwork to ART and ICONS.
- Filter, search, and display detected games in gallery or list views.
- Track local game metadata and synchronize the catalog through IndexedDB.
- Export a local database backup.
- Support installable PWA behavior.
- Provide an Android Capacitor build with native Storage Access Framework access.

## Original interface direction

The original interface uses a dark navy background, blue/cyan accents, compact top navigation, a direct USB selection workflow, online/offline artwork source selection, scan/sync controls, game statistics, progress and report areas, database controls, and a searchable/filterable game gallery or table. Its functional sequence and existing controls are part of the baseline and must not be silently removed during future improvements.

## Validation note

This branch is a source-code snapshot at the recorded commit. It does not by itself certify that the web app, Android APK, PWA, or USB access has been freshly tested on physical devices.
