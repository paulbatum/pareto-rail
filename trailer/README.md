# Trailer

Remotion project that overlays promo typography and an end card onto edited gameplay footage.

- Source footage is not tracked. Copy the edited cut to `public/footage.mp4` (current master lives in `C:\Users\paulb\OneDrive\Videos\pareto-rail\`).
- `npm install`, then `npm run render` writes the finished video to `../tmp/trailer/pareto-rail-trailer.mp4`.
- `npm run studio` opens the Remotion studio for interactive preview.
- Overlay copy, beat timings (frame-aligned to the footage's cut points), and the end card all live in `src/Trailer.tsx`. If the footage edit changes, re-derive the cut points (`ffmpeg` scene detection) and update `BEATS` and `FOOTAGE_FRAMES`.

Fonts and colors follow the site brand: Archivo, IBM Plex Mono, and the raspberry accent from `src/app/theme.css`.
