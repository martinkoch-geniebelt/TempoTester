# Vibe Coded BeatSync Lab

BeatSync Lab is a Vite + React + TypeScript browser app for tracking beat intervals from either keyboard taps or microphone input.

The app measures accepted beat intervals, plots them over time, and can optionally judge incoming beats relative to a target BPM.

## What It Does

- Defaults to keyboard tap input (`Space`, `Enter`, or `F`).
- Supports microphone beat detection with two engines:
  - `Precision` via `AudioWorklet`
  - `Standard` via `AnalyserNode` + RMS thresholding
- Calibrates mic sensitivity from ambient noise.
- Tracks accepted beat intervals and estimates BPM from recent intervals.
- Supports optional Target BPM mode, which accepts/rejects beats relative to the target interval instead of the recent median.
- Draws a live interval graph with:
  - visible min/max labels based on what is actually on screen
  - stable 4/4 beat labels (`1 2 3 4`) stored per accepted beat
  - ahead / on / behind coloring for keyboard-tap points
- Includes a hidden-by-default debug panel with:
  - snapshot export / copy
  - emulated beat input controls (tempo + jitter)

## Current UI Behavior

- Keyboard input is the default mode on load.
- The debug panel is hidden by default.
- Input device selection is only shown for microphone mode.
- Emulated input controls live in the debug panel, not the main settings panel.

## Run

```bash
npm install
npm run dev
```

Open the local Vite URL in the browser.

If you use microphone input, allow mic access when prompted.

## Scripts

```bash
npm run dev
npm run build
npm run preview
npm run lint
```

## Deploy to GitHub Pages

This repo includes a GitHub Actions workflow at `.github/workflows/deploy-pages.yml`.

1. Push this project to a GitHub repository.
2. In GitHub, open **Settings -> Pages**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.
4. Push to `main` (or run the workflow manually from the **Actions** tab).

The workflow builds with `VITE_BASE_PATH=/<repo-name>/` and publishes `dist` to GitHub Pages.

Your site URL will be:

`https://<your-username>.github.io/<repo-name>/`

## How Detection Works

### Keyboard Mode

- Press `Space`, `Enter`, or `F` to register a beat.
- Each accepted beat stores its bar position (`1..4`) so graph labels stay stable over time.

### Microphone Mode

- `Precision` mode loads `public/onset-detector-worklet.js` and receives onset messages from an `AudioWorkletNode`.
- `Standard` mode analyzes the waveform with an `AnalyserNode`, RMS floor tracking, slope gating, peak gating, and a minimum inter-onset gap.
- Ambient calibration samples RMS over a short window and derives a sensitivity multiplier.

### Interval Acceptance

- Raw beat-to-beat intervals are accepted only when they fall within configured min/max bounds.
- With Target BPM mode off:
  - accepted intervals are compared against the recent median interval
  - outliers beyond the configured tolerance are rejected
- With Target BPM mode on:
  - accepted intervals are compared against the target interval `60000 / BPM`
  - outliers beyond the same tolerance are rejected

## Graph Semantics

- The graph shows accepted interval durations in milliseconds.
- With Target BPM mode off, the center line is based on the visible interval average.
- With Target BPM mode on, the center line locks to the target interval.
- Keyboard points are colored as:
  - blue = ahead
  - green = on
  - orange/red = behind

## Project Structure

- `src/App.tsx` - orchestration layer
- `src/audio/` - mic stream + calibration helpers
- `src/hooks/useAudioContext.ts` - audio context lifecycle
- `src/hooks/useAudioDevices.ts` - device enumeration
- `src/hooks/useBeatEngine.ts` - interval tracking, target BPM logic, emulation
- `src/hooks/useMicListening.ts` - mic detection pipeline
- `src/components/BeatGraph.tsx` - graph rendering
- `src/components/ControlPanel.tsx` - main settings UI
- `src/components/DebugPanel.tsx` - debug + emulation UI

## Notes

- Best results come from clear transients such as taps, claps, stick hits, or kick-like sounds.
- Browser audio APIs still require user interaction before some audio features fully activate.
- Precision mode depends on `AudioWorklet` support.
