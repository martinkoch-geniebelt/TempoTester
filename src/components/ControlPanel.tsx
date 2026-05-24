import type { DeviceOption, Status } from '../types'

interface IntervalStats {
  count: number
  avgIntervalMs: number
  lastIntervalMs: number
  stdMs: number
  bpmEstimate: number
}

interface ControlPanelProps {
  inputMode: 'mic' | 'key'
  setInputMode: (val: 'mic' | 'key') => void
  detectionMode: 'standard' | 'precision'
  setDetectionMode: (val: 'standard' | 'precision') => void
  selectedInputId: string
  setSelectedInputId: (val: string) => void
  inputDevices: DeviceOption[]
  listening: boolean
  setListening: (val: boolean | ((prev: boolean) => boolean)) => void
  calibrating: boolean
  calibrationInfo: string
  targetBpmEnabled: boolean
  setTargetBpmEnabled: (val: boolean) => void
  targetBpm: number
  setTargetBpm: (val: number) => void
  emulationEnabled: boolean
  setEmulationEnabled: (val: boolean) => void
  emulationBpm: number
  setEmulationBpm: (val: number) => void
  emulationJitterMs: number
  setEmulationJitterMs: (val: number) => void
  permissionError: string | null
  deviceError: string | null
  status: Status
  statusText: string
  energy: number
  showDebugPanel: boolean
  setShowDebugPanel: (val: boolean | ((prev: boolean) => boolean)) => void
  debugCopyStatus: 'idle' | 'copied' | 'failed'
  detectedBeatCount: number
  workletOnsetCount: number
  emulatedBeatCount: number
  offsetSamplesLength: number
  visibleSamplesCount: number
  rawIntervalMs: number | null
  acceptedIntervalMs: number | null
  rejectedIntervalCount: number
  intervalStats: IntervalStats | null
  metronomeBpm: number | null
  metronomeSource: 'target' | 'detected'
  metronomeDotPct: number | null
  metronomeCountdownMs: number | null
  metronomeBeatNow: boolean
  onRefreshDevices: () => void
  onCalibrateMic: () => void
  onCopyDebug: () => void
  keyFlashCount: number
}

export function ControlPanel({
  inputMode,
  setInputMode,
  detectionMode,
  setDetectionMode,
  selectedInputId,
  setSelectedInputId,
  inputDevices,
  listening,
  setListening,
  calibrating,
  calibrationInfo,
  targetBpmEnabled,
  setTargetBpmEnabled,
  targetBpm,
  setTargetBpm,
  emulationEnabled,
  setEmulationEnabled,
  emulationBpm,
  setEmulationBpm,
  emulationJitterMs,
  setEmulationJitterMs,
  permissionError,
  deviceError,
  status,
  statusText,
  energy,
  showDebugPanel,
  setShowDebugPanel,
  debugCopyStatus,
  detectedBeatCount,
  workletOnsetCount,
  emulatedBeatCount,
  offsetSamplesLength,
  visibleSamplesCount,
  rawIntervalMs,
  acceptedIntervalMs,
  rejectedIntervalCount,
  intervalStats,
  metronomeBpm,
  metronomeSource,
  metronomeDotPct,
  metronomeCountdownMs,
  metronomeBeatNow,
  onRefreshDevices,
  onCalibrateMic,
  onCopyDebug,
  keyFlashCount,
}: ControlPanelProps) {
  return (
    <section className="panel control-panel">
      <h1>BeatSync Lab</h1>
      <p className="lede">Use your external metronome and track detected beat intervals in real time.</p>

      <div className="control-grid">
        <label htmlFor="input-mode">Input source</label>
        <select
          id="input-mode"
          value={inputMode}
          onChange={(event) => setInputMode(event.target.value as 'mic' | 'key')}
        >
          <option value="mic">Microphone</option>
          <option value="key">Keyboard Tap</option>
        </select>

        <label htmlFor="detection-mode">Detection engine</label>
        <select
          id="detection-mode"
          value={detectionMode}
          onChange={(event) => setDetectionMode(event.target.value as 'standard' | 'precision')}
          disabled={inputMode !== 'mic'}
        >
          <option value="precision">Precision (AudioWorklet)</option>
          <option value="standard">Standard (Analyser)</option>
        </select>

        <label htmlFor="input-device">Input device</label>
        <select
          id="input-device"
          value={selectedInputId}
          onChange={(event) => setSelectedInputId(event.target.value)}
          disabled={inputDevices.length === 0}
        >
          {inputDevices.length === 0 ? <option value="">No input devices found</option> : null}
          {inputDevices.map((device) => (
            <option key={device.id} value={device.id}>
              {device.label}
            </option>
          ))}
        </select>

        <button type="button" onClick={onRefreshDevices}>
          Refresh Devices
        </button>

        <label htmlFor="emulation-enabled">Emulated metronome input</label>
        <select
          id="emulation-enabled"
          value={emulationEnabled ? 'on' : 'off'}
          onChange={(event) => setEmulationEnabled(event.target.value === 'on')}
        >
          <option value="off">Off</option>
          <option value="on">On</option>
        </select>

        <label htmlFor="target-bpm-enabled">Target BPM mode</label>
        <select
          id="target-bpm-enabled"
          value={targetBpmEnabled ? 'on' : 'off'}
          onChange={(event) => setTargetBpmEnabled(event.target.value === 'on')}
        >
          <option value="off">Off</option>
          <option value="on">On</option>
        </select>

        {targetBpmEnabled ? (
          <>
            <label htmlFor="target-bpm">Target tempo: {targetBpm} BPM</label>
            <input
              id="target-bpm"
              type="range"
              min={40}
              max={220}
              value={targetBpm}
              onChange={(event) => setTargetBpm(Number(event.target.value))}
            />
          </>
        ) : null}

        {emulationEnabled ? (
          <>
            <label htmlFor="emulation-bpm">Emulation tempo: {emulationBpm} BPM</label>
            <input
              id="emulation-bpm"
              type="range"
              min={40}
              max={220}
              value={emulationBpm}
              onChange={(event) => setEmulationBpm(Number(event.target.value))}
            />

            <label htmlFor="emulation-jitter">Emulation jitter: ±{emulationJitterMs} ms</label>
            <input
              id="emulation-jitter"
              type="range"
              min={0}
              max={60}
              value={emulationJitterMs}
              onChange={(event) => setEmulationJitterMs(Number(event.target.value))}
            />
          </>
        ) : null}

        {inputMode === 'mic' ? (
          <>
            <button type="button" onClick={() => setListening((active) => !active)}>
              {listening ? 'Stop Listening' : 'Enable Mic Input'}
            </button>
            <button type="button" onClick={onCalibrateMic} disabled={calibrating}>
              {calibrating ? 'Calibrating...' : 'Calibrate Mic'}
            </button>
          </>
        ) : (
          <p className="key-hint">
            Tap Space, Enter, or F on each beat.
            {keyFlashCount > 0 ? <span key={keyFlashCount} className="tap-flash-dot" aria-hidden="true" /> : null}
          </p>
        )}
      </div>

      {permissionError ? <p className="error">{permissionError}</p> : null}
      {deviceError ? <p className="error">{deviceError}</p> : null}

      <div className="status-row">
        <span className={`status-pill ${status}`}>{statusText}</span>
        <div className="status-actions">
          {inputMode === 'mic' ? (
            <span className="subtle">Mic energy: {(energy * 100).toFixed(0)}%</span>
          ) : (
            <span className="subtle">Keyboard mode active</span>
          )}
          <button
            type="button"
            className="copy-debug-inline"
            onClick={() => setShowDebugPanel((value) => !value)}
          >
            {showDebugPanel ? 'Hide Debug Panel' : 'Show Debug Panel'}
          </button>
          <button type="button" className="copy-debug-inline" onClick={onCopyDebug}>
            {debugCopyStatus === 'copied'
              ? 'Copied'
              : debugCopyStatus === 'failed'
                ? 'Copy failed'
                : 'Copy Debug Data'}
          </button>
        </div>
      </div>

      {metronomeDotPct !== null && metronomeCountdownMs !== null ? (
        <div
          className={`metronome-visual${metronomeBeatNow ? ' beat-now' : ''}`}
          role="img"
          aria-label="Visual metronome dot and countdown to next beat"
        >
          <div className="metronome-head">
            <span>Visual metronome ({metronomeSource})</span>
            <span>{metronomeBpm ? `${metronomeBpm.toFixed(2)} BPM` : '--'}</span>
          </div>
          <div className="metronome-track">
            <div
              className={`metronome-dot${metronomeBeatNow ? ' beat-now' : ''}`}
              style={{ left: `${metronomeDotPct.toFixed(2)}%` }}
            />
          </div>
          <p className="calibration-info">Next beat in {Math.max(0, Math.round(metronomeCountdownMs))} ms</p>
        </div>
      ) : null}

      {inputMode === 'mic' ? <p className="calibration-info">{calibrationInfo}</p> : null}
      {inputMode === 'mic' ? (
        <p className="calibration-info">
          Detector {detectionMode} | beats detected {detectedBeatCount} | plotted {visibleSamplesCount} | stored{' '}
          {offsetSamplesLength} | emulated {emulatedBeatCount} | worklet onsets {workletOnsetCount}
        </p>
      ) : null}
      <p className="calibration-info">
        Detector debug: raw {rawIntervalMs !== null ? `${rawIntervalMs.toFixed(1)} ms` : '--'} | accepted{' '}
        {acceptedIntervalMs !== null ? `${acceptedIntervalMs.toFixed(1)} ms` : '--'} | rejected {rejectedIntervalCount}
      </p>
      <p className="calibration-info">
        Target mode: {targetBpmEnabled ? `on (${targetBpm} BPM)` : 'off'}
      </p>
      <p className="calibration-info">External metronome mode: internal click disabled.</p>
      <p className="calibration-info">
        {intervalStats
          ? `Free interval: last ${intervalStats.lastIntervalMs.toFixed(1)} ms | avg ${intervalStats.avgIntervalMs.toFixed(1)} ms | est ${intervalStats.bpmEstimate.toFixed(2)} BPM | std ${intervalStats.stdMs.toFixed(1)} ms | n=${intervalStats.count}`
          : 'Free interval: waiting for at least two beats...'}
      </p>
    </section>
  )
}
