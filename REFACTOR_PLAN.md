# Code Review & Refactor Plan

## Code Review Findings

### Bugs

1. **Stale closure in `registerBeat`** — `intervalSamples` is captured by value at the
   time each effect runs. The worklet `onmessage` handler and the RAF loop both call
   `registerBeat` long after the effect, so the outlier-rejection logic always sees an
   outdated copy of `intervalSamples`. Fix: mirror the state in a `useRef` that is
   written on every render, and read from the ref inside `registerBeat`.

2. **`colorForOffset` closes over `yRangeMs`** — defined inside the component but reads
   `yRangeMs` from outer scope. Because it is redefined on every render this works, but
   it makes the function impure and non-exportable. Fix: make it a pure function that
   takes `yRangeMs` as a parameter.

3. **`retainedBeatCount` stale in `registerBeat`** — same stale-closure class as above.
   The `.slice(-retainedBeatCount)` call inside `registerBeat` uses the value from when
   the listening effect ran, not the current value.

### Design Issues

4. **Monolith** — 887 lines of business logic, audio engine code, graph maths, and JSX
   in one file. Untestable in isolation; difficult to maintain.

5. **`Status` type is `'idle'` only** — but the CSS defines `.status-pill.ahead`,
   `.status-pill.behind`, and `.status-pill.on` — dead CSS from a removed feature, or
   the type was accidentally narrowed.

6. **`workletOnsetCount` vs `detectedBeatCount`** — both increment on every worklet
   onset (the worklet already applies its own gap gate, so they are always equal in the
   worklet path). The distinction adds confusion without value. Consider dropping one.

7. **Effect dependency arrays are incomplete** — `startListening` / `stopListening` /
   `calibrateMic` are referenced inside effects but not listed as dependencies. This is
   safe only because they are recreated on every render and the effects do not close over
   their identity, but it should be documented or the functions should be stabilised with
   `useCallback`.

8. **`scheduleNextEmulatedBeat` recursive timeout** — captures `emulationEnabled`,
   `emulationBpm`, `emulationJitterMs` at schedule time. If the user changes BPM the
   already-running timeout chain still uses the old value until the effect tears it down
   and restarts. The effect does restart on those deps, so this is mostly harmless but
   results in one off-beat interval on every BPM change.

### Minor Issues

9. `median` defined at module level — fine, but not exported so it cannot be tested.
10. `DEFAULT_INTERVAL_MS`, `MIN_INTERVAL_MS`, etc. live at module top — move to a
    dedicated constants file.
11. The `calibrationInfo` initial value `'Not calibrated'` is set in state initialiser;
    it does not need to be a magic string scattered through the code.

---

## Proposed File Structure

```
src/
  types.ts                  — OffsetSample, DeviceOption, Status
  constants.ts              — all numeric/string constants
  utils.ts                  — median(), colorForOffset(offsetMs, yRangeMs)
  audio/
    micUtils.ts             — buildMicConstraints(), requestMicStream()
    calibration.ts          — captureCalibrationRms(), calibrateMic logic
  hooks/
    useAudioContext.ts       — AudioContext singleton + ensureAudioContext()
    useAudioDevices.ts       — device enumeration, refreshDevices()
    useBeatEngine.ts         — beat state, registerBeat (stale-closure-safe),
                               resetFreeIntervalTracking, emulation
    useMicListening.ts       — mic stream + worklet setup, energy meter,
                               workletOnsetCount
  components/
    BeatGraph.tsx            — SVG graph + all its internal memos
    ControlPanel.tsx         — the form controls section
    DebugPanel.tsx           — debug textarea + copy button
  App.tsx                   — thin orchestration layer (~120 lines)
  App.css / index.css       — unchanged
```

### Responsibility boundaries

| Layer | Owns |
|---|---|
| `useBeatEngine` | `offsetSamples`, `intervalSamples`, `retainedBeatCount`, `registerBeat`, `resetFreeIntervalTracking`, `detectedBeatCount`, `emulatedBeatCount`, emulation scheduling |
| `useMicListening` | audio nodes, `energy`, `workletOnsetCount`, `startListening`, `stopListening` |
| `useAudioContext` | `audioContextRef`, `ensureAudioContext()` |
| `useAudioDevices` | `inputDevices`, `selectedInputId`, `deviceError`, `refreshDevices()` |
| `BeatGraph` | all graph layout memos, SVG rendering |
| `ControlPanel` | renders controls, fires callbacks upward |
| `DebugPanel` | renders debug textarea, fires copy callback |
| `App.tsx` | composes hooks, owns calibration state, hands props to components |

---

## Stale-closure Fix (key detail)

```typescript
// Inside useBeatEngine:
const intervalSamplesRef = useRef<number[]>([])

// Keep ref in sync with state on every render:
intervalSamplesRef.current = intervalSamples

// registerBeat reads from ref, not closure:
const registerBeat = useCallback((beatTimeSeconds: number, source: 'mic' | 'key' | 'emu') => {
  const currentSamples = intervalSamplesRef.current
  // ... use currentSamples for outlier rejection
}, [audioContextRef])   // stable — no state deps
```

---

## Implementation order

1. `src/types.ts` + `src/constants.ts` + `src/utils.ts`
2. `src/audio/micUtils.ts`
3. `src/hooks/useAudioContext.ts` + `src/hooks/useAudioDevices.ts`
4. `src/hooks/useBeatEngine.ts` (includes stale-closure fix)
5. `src/hooks/useMicListening.ts`
6. `src/components/BeatGraph.tsx`
7. `src/components/ControlPanel.tsx`
8. `src/components/DebugPanel.tsx`
9. `src/App.tsx` — replace with thin orchestration layer
