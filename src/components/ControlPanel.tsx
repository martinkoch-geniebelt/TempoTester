import type { DeviceOption, Status } from '../types'

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
  permissionError: string | null
  deviceError: string | null
  status: Status
  statusText: string
  energy: number
  showDebugPanel: boolean
  setShowDebugPanel: (val: boolean | ((prev: boolean) => boolean)) => void
  detectedBeatCount: number
  workletOnsetCount: number
  emulatedBeatCount: number
  offsetSamplesLength: number
  visibleSamplesCount: number
  onRefreshDevices: () => void
  onCalibrateMic: () => void
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
  permissionError,
  deviceError,
  status,
  statusText,
  energy,
  showDebugPanel,
  setShowDebugPanel,
  detectedBeatCount,
  workletOnsetCount,
  emulatedBeatCount,
  offsetSamplesLength,
  visibleSamplesCount,
  onRefreshDevices,
  onCalibrateMic,
  keyFlashCount,
}: ControlPanelProps) {
  return (
    <section className="panel control-panel">
      <div className="settings-stack">
        <section className="settings-group">
          <h2 className="settings-heading">Input</h2>
          <div className="settings-grid two-up">
            <label className="setting-field" htmlFor="input-mode">
              <span className="setting-label">Input source</span>
              <select
                id="input-mode"
                value={inputMode}
                onChange={(event) => setInputMode(event.target.value as 'mic' | 'key')}
              >
                <option value="mic">Microphone</option>
                <option value="key">Keyboard Tap</option>
              </select>
            </label>

            <label className="setting-field" htmlFor="detection-mode">
              <span className="setting-label">Detection engine</span>
              <select
                id="detection-mode"
                value={detectionMode}
                onChange={(event) => setDetectionMode(event.target.value as 'standard' | 'precision')}
                disabled={inputMode !== 'mic'}
              >
                <option value="precision">Precision (AudioWorklet)</option>
                <option value="standard">Standard (Analyser)</option>
              </select>
            </label>

            {inputMode === 'mic' ? (
              <label className="setting-field setting-field-wide" htmlFor="input-device">
                <span className="setting-label">Input device</span>
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
              </label>
            ) : null}
          </div>
          <div className="settings-actions">
            {inputMode === 'mic' ? (
              <>
                <button type="button" onClick={onRefreshDevices}>
                  Refresh Devices
                </button>
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
        </section>

        <section className="settings-group">
          <h2 className="settings-heading">Tempo Assistance</h2>
          <div className="settings-grid two-up">
            <label className="setting-field" htmlFor="target-bpm-enabled">
              <span className="setting-label">Target BPM mode</span>
              <select
                id="target-bpm-enabled"
                value={targetBpmEnabled ? 'on' : 'off'}
                onChange={(event) => setTargetBpmEnabled(event.target.value === 'on')}
              >
                <option value="off">Off</option>
                <option value="on">On</option>
              </select>
            </label>

            {targetBpmEnabled ? (
              <label className="setting-field setting-field-wide" htmlFor="target-bpm">
                <span className="setting-label">Target tempo: {targetBpm} BPM</span>
                <input
                  id="target-bpm"
                  type="range"
                  min={40}
                  max={220}
                  value={targetBpm}
                  onChange={(event) => setTargetBpm(Number(event.target.value))}
                />
              </label>
            ) : null}
          </div>
        </section>
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
        </div>
      </div>

      {inputMode === 'mic' ? <p className="calibration-info">{calibrationInfo}</p> : null}
      {inputMode === 'mic' ? (
        <p className="calibration-info">
          Detector {detectionMode} | beats detected {detectedBeatCount} | plotted {visibleSamplesCount} | stored{' '}
          {offsetSamplesLength} | emulated {emulatedBeatCount} | worklet onsets {workletOnsetCount}
        </p>
      ) : null}
    </section>
  )
}
