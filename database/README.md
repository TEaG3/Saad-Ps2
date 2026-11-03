# Saad PS2 Game Database

This directory contains the versioned central game catalog.

## Files
- `manifest.json`: catalog version and update metadata.
- `catalog.json`: verified game metadata records.

## Record format
Each record may contain:
- `gameId` (required): normalized OPL ID, for example `SLUS_200.62`.
- `title` (recommended): verified game title.
- `region`, `publisher`, `developer`, `releaseYear`, `genre`, `description`.
- `coverUrl`, `discUrl`, `iconUrl` (optional artwork references).

Do not guess metadata. Add only records that have been checked against reliable game references. After changing catalog.json, increment manifest.json's version and update gameCount.

The app also keeps a private local IndexedDB library of games actually detected on the user's device. That local library is separate from this shared catalog and can be exported as a JSON backup. Scanned game names and storage contents are not uploaded to this repository.
