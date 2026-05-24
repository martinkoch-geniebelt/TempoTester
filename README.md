# BeatSync Lab

BeatSync Lab is a browser app that helps you practice timing against a metronome.

It can:

- Play a metronome click at your selected BPM.
- Capture microphone audio and detect beat onsets from input energy spikes.
- Compare detected beats to the nearest metronome beat.
- Show whether your input is ahead of or behind the click in milliseconds.
- Visualize offset history on a lane with center alignment.

## Run

```bash
npm install
npm run dev
```

Open the local Vite URL and allow microphone access when prompted.

## Build

```bash
npm run build
```

## How It Works

- The metronome uses Web Audio with a short lookahead scheduler.
- Microphone input is analyzed with an `AnalyserNode` and RMS energy tracking.
- Beat candidates are detected when signal energy crosses an adaptive threshold with a positive slope and refractory gap.
- Offset is measured as:

  detected beat time minus nearest metronome beat time

Negative means ahead, positive means behind.

## Notes

- Best with clear transients (claps, stick hits, kick).
- Browser autoplay policies require user interaction before audio starts.
- Works best in a quiet room with headphones to reduce metronome bleed into the mic.
