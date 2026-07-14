# EDL Workbench — Design

**Date:** 2026-07-14 · **Status:** Approved · **Scope:** Local dev tool for the Darkroom M0 renderer

## Purpose

A local web app to iterate on reels fast: edit an EDL as JSON with live validation, preview it instantly with the real `Reel` component, manage assets (fixtures + user photos), and trigger MP4 renders — all from one `npm run workbench`. This is a developer/operator tool; the product interface remains the Telegram bot (PRD non-goal: no product web UI).

## Decisions (from brainstorming)

- **EDL workbench**, not a media-first tester and not just Remotion Studio.
- **JSON editor + live errors** as the editing UX (no form builder).
- **Preview + render button** — a small local server runs renders.
- **Fixtures + user photos** — upload images from the UI into `public/assets`.
- **Approach A:** workbench lives inside `renderer/`, sharing its `node_modules`, guaranteeing remotion/react/@remotion/player version consistency.

## Architecture

Two units inside the existing `renderer/` package:

### Client — `renderer/workbench/`

Vite + React SPA. Two-pane layout:
- **Left:** monospace `<textarea>` with the EDL JSON; error panel beneath it (JSON syntax, Zod, invariant errors in one list); "Load fixture" and "Format JSON" buttons.
- **Right:** `@remotion/player` preview (portrait, scaled), asset strip (thumbnails + ids, drag-drop/browse upload), render panel (Render button, status/log tail, list of finished MP4s with play/download links).

Key properties:
- Imports `Reel`, `EdlSchema`, `checkInvariants`, `msToFrame` directly from `renderer/src` — preview and validation are the same code the render gate uses.
- Vite `publicDir` = `renderer/public`, so `staticFile('assets/…')` resolves identically in preview and CLI render.
- The `assets` map is derived, not hand-written: `GET /api/assets` lists files; id = filename without extension; map = `{id: 'assets/<file>'}`. EDLs reference ids only, matching the future pipeline.
- Player `durationInFrames`/`fps` are computed from the parsed EDL via `msToFrame`.

Pure helper `edlFromText(text, assetIds) → {edl?, errors: string[]}` implements parse → schema → invariants; unit-tested.

### Server — `renderer/server/workbench-server.mjs`

Express on localhost (port 7787). Endpoints:

| Endpoint | Behavior |
|---|---|
| `GET /api/assets` | List `public/assets` files (images + audio) as `{id, file, url}` |
| `POST /api/assets` | Multipart upload; accept jpg/png/webp/svg only; save into `public/assets` |
| `POST /api/render` | Body `{edl, assets}`; write props JSON to `out/`; spawn `npx remotion render Reel out/workbench-<timestamp>.mp4 --props=…`; single in-flight job — 409 if busy |
| `GET /api/render/status` | `{state: idle\|running\|done\|failed, file?, error?, logTail}` |
| `GET /api/renders` | List `out/*.mp4` newest-first |
| `GET /renders/<file>` | Serve an MP4 |

Renders shell out to the CLI (not programmatic `renderMedia`) to reuse the proven path including the `calculateMetadata` validation gate; server-side validation is therefore enforced even if a client bypasses UI validation.

### Wiring

- `vite.config.ts`: root `workbench/`, `publicDir: '../public'`, proxy `/api` and `/renders` → `localhost:7787`.
- New deps in `renderer/package.json`: `@remotion/player` (pinned to installed remotion version), `express`, `multer`, `vite`, `@vitejs/plugin-react`, `concurrently`.
- Script: `"workbench": "concurrently \"node server/workbench-server.mjs\" \"vite --open --config workbench/vite.config.ts\""`.

## Error handling

- Editor: all three error classes (JSON parse, Zod path:message, invariant strings) in one panel; preview keeps showing the last valid EDL.
- Render: CLI non-zero exit → `failed` with stderr tail (includes the gate's "EDL invariant violations" messages).
- Upload: non-image MIME/extension → 400 with message; duplicate filename → overwrite allowed (dev tool, deliberate).
- Busy: second render request → 409; UI disables the button while `running`.

## Testing

- Unit (vitest): `edlFromText` (valid, syntax error, schema error, invariant error), asset filename→id mapping.
- Existing 29 renderer tests unchanged and still passing.
- End-to-end: start workbench, load fixture, break a cut → see invariant error, fix → preview updates, upload a photo, reference it, render → MP4 playable from the UI.

## Out of scope (YAGNI)

CodeMirror/Monaco, timeline GUI, beat-grid editing tools, auth, deployment, multi-user, WebSocket log streaming (poll instead), deleting/renaming assets from the UI.
