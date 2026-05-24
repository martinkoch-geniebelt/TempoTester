interface DebugPanelProps {
  debugSnapshot: string
  debugCopyStatus: 'idle' | 'copied' | 'failed'
  onCopy: () => void
}

export function DebugPanel({ debugSnapshot, debugCopyStatus, onCopy }: DebugPanelProps) {
  return (
    <section className="panel debug-panel">
      <h2>Debug export</h2>
      <textarea
        readOnly
        value={debugSnapshot}
        rows={10}
        aria-label="Debug snapshot export"
        className="debug-export-textarea"
      />
      <div className="debug-export-actions">
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
    </section>
  )
}
