interface DebugPanelProps {
  debugSnapshot: string
  debugCopyStatus: 'idle' | 'copied' | 'failed'
  emulationEnabled: boolean
  setEmulationEnabled: (val: boolean) => void
  emulationBpm: number
  setEmulationBpm: (val: number) => void
  emulationJitterMs: number
  setEmulationJitterMs: (val: number) => void
  onCopy: () => void
}

export function DebugPanel({
  debugSnapshot,
  debugCopyStatus,
  emulationEnabled,
  setEmulationEnabled,
  emulationBpm,
  setEmulationBpm,
  emulationJitterMs,
  setEmulationJitterMs,
  onCopy,
}: DebugPanelProps) {
  return (
    <section className="panel debug-panel">
      <div className="debug-panel-head">
        <h2>Debug export</h2>
        <div className="debug-export-actions debug-export-actions-top">
          <button type="button" onClick={onCopy}>
            Copy Debug Snapshot
          </button>
          <span className="debug-export-hint">
            {debugCopyStatus === 'copied'
              ? 'Copied'
              : debugCopyStatus === 'failed'
                ? 'Copy failed (clipboard blocked)'
                : 'Paste this into chat for debugging'}
          </span>
        </div>
      </div>
      <div className="debug-controls">
        <label className="setting-field" htmlFor="debug-emulation-enabled">
          <span className="setting-label">Emulated metronome input</span>
          <select
            id="debug-emulation-enabled"
            value={emulationEnabled ? 'on' : 'off'}
            onChange={(event) => setEmulationEnabled(event.target.value === 'on')}
          >
            <option value="off">Off</option>
            <option value="on">On</option>
          </select>
        </label>

        {emulationEnabled ? (
          <>
            <label className="setting-field" htmlFor="debug-emulation-bpm">
              <span className="setting-label">Emulation tempo: {emulationBpm} BPM</span>
              <input
                id="debug-emulation-bpm"
                type="range"
                min={40}
                max={220}
                value={emulationBpm}
                onChange={(event) => setEmulationBpm(Number(event.target.value))}
              />
            </label>

            <label className="setting-field" htmlFor="debug-emulation-jitter">
              <span className="setting-label">Emulation jitter: ±{emulationJitterMs} ms</span>
              <input
                id="debug-emulation-jitter"
                type="range"
                min={0}
                max={60}
                value={emulationJitterMs}
                onChange={(event) => setEmulationJitterMs(Number(event.target.value))}
              />
            </label>
          </>
        ) : null}
      </div>
      <textarea
        readOnly
        value={debugSnapshot}
        rows={10}
        aria-label="Debug snapshot export"
        className="debug-export-textarea"
      />
    </section>
  )
}
