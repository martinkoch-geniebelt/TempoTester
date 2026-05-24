import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { GRAPH_HISTORY_MS, NOW_ANCHOR_RATIO } from './constants'
import { captureCalibrationRms } from './audio/calibration'
import { useAudioContext } from './hooks/useAudioContext'
import { useAudioDevices } from './hooks/useAudioDevices'
import { useBeatEngine } from './hooks/useBeatEngine'
import { useMicListening } from './hooks/useMicListening'
import { BeatGraph } from './components/BeatGraph'
import { ControlPanel } from './components/ControlPanel'
import { DebugPanel } from './components/DebugPanel'

function App() {
  const [detectionMode, setDetectionMode] = useState<'standard' | 'precision'>('precision')
  const [inputMode, setInputMode] = useState<'mic' | 'key'>('key')
  const [listening, setListening] = useState(false)
  const [permissionError, setPermissionError] = useState<string | null>(null)
  const [calibrating, setCalibrating] = useState(false)
  const [calibrationInfo, setCalibrationInfo] = useState('Not calibrated')
  const [calibrationFactor, setCalibrationFactor] = useState(2.5)
  const [status] = useState<'idle'>('idle')
  const [graphNowMs, setGraphNowMs] = useState(() => performance.now())
  const [debugCopyStatus, setDebugCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [showDebugPanel, setShowDebugPanel] = useState(false)
  const [keyFlashCount, setKeyFlashCount] = useState(0)

  const debugCopyResetTimeoutRef = useRef<number | null>(null)

  const { audioContextRef, ensureAudioContext } = useAudioContext()
  const { inputDevices, selectedInputId, setSelectedInputId, deviceError, refreshDevices } = useAudioDevices()
  const {
    offsetSamples,
    bpmHistorySamples,
    intervalSamples,
    intervalStats,
    detectedBeatCount,
    emulatedBeatCount,
    rawIntervalMs,
    acceptedIntervalMs,
    rejectedIntervalCount,
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
    registerBeat,
    resetFreeIntervalTracking,
    resetBeatCounters,
  } = useBeatEngine(audioContextRef, ensureAudioContext)
  const { energy, workletOnsetCount, startListening, stopListening, recentDetectedBeatEnergyPctRef } = useMicListening(
    {
      audioContextRef,
      ensureAudioContext,
      registerBeat,
      refreshDevices,
      setPermissionError,
      setCalibrationInfo,
      setListening,
    },
  )

  const statusText = useMemo(() => {
    if (intervalSamples.length === 0) {
      return 'Waiting for beat input'
    }
    const avgIntervalMs = intervalSamples.reduce((acc, value) => acc + value, 0) / intervalSamples.length
    const bpmEstimate = avgIntervalMs > 0 ? 60000 / avgIntervalMs : 0
    return `Interval avg ${avgIntervalMs.toFixed(1)} ms (${bpmEstimate.toFixed(2)} BPM)`
  }, [intervalSamples])

  const visibleSamplesCount = useMemo(() => {
    const lastSampleAt = offsetSamples.length > 0 ? offsetSamples[offsetSamples.length - 1].at : 0
    const windowNowMs = Math.max(graphNowMs, lastSampleAt)
    const visiblePastMs = GRAPH_HISTORY_MS * NOW_ANCHOR_RATIO
    return offsetSamples.filter((s) => s.at >= windowNowMs - visiblePastMs).length
  }, [offsetSamples, graphNowMs])

  const debugSnapshot = useMemo(() => {
    const fmt = (value: number | null, digits = 2) => (value === null ? '--' : value.toFixed(digits))
    const recentIntervals = intervalSamples.slice(-10).map((value) => value.toFixed(1)).join(', ')
    const maxRecentEnergyPct =
      recentDetectedBeatEnergyPctRef.current.length > 0 ? Math.max(...recentDetectedBeatEnergyPctRef.current) : null

    return [
      'BeatSync Debug Snapshot',
      `timestamp=${new Date().toISOString()}`,
      `input_mode=${inputMode}`,
      `detection_mode=${detectionMode}`,
      `listening=${listening ? 'true' : 'false'}`,
      `selected_input_id=${selectedInputId || 'default'}`,
      `calibration_factor=${calibrationFactor.toFixed(3)}`,
      `energy_pct=${(energy * 100).toFixed(1)}`,
      `max_recent_energy_pct_10=${fmt(maxRecentEnergyPct, 1)}`,
      `detected_beats=${detectedBeatCount}`,
      `worklet_onsets=${workletOnsetCount}`,
      `emulation_enabled=${emulationEnabled ? 'true' : 'false'}`,
      `emulation_bpm=${emulationBpm}`,
      `emulation_jitter_ms=${emulationJitterMs}`,
      `emulated_beats=${emulatedBeatCount}`,
      `raw_interval_ms=${fmt(rawIntervalMs, 1)}`,
      `accepted_interval_ms=${fmt(acceptedIntervalMs, 1)}`,
      `rejected_intervals=${rejectedIntervalCount}`,
      `target_bpm_enabled=${targetBpmEnabled ? 'true' : 'false'}`,
      `target_bpm=${targetBpm}`,
      `visible_samples=${visibleSamplesCount}`,
      `stored_samples=${offsetSamples.length}`,
      `interval_count=${intervalSamples.length}`,
      `interval_avg_ms=${intervalStats ? intervalStats.avgIntervalMs.toFixed(2) : '--'}`,
      `interval_std_ms=${intervalStats ? intervalStats.stdMs.toFixed(2) : '--'}`,
      `interval_last_ms=${intervalStats ? intervalStats.lastIntervalMs.toFixed(2) : '--'}`,
      `interval_bpm_est=${intervalStats ? intervalStats.bpmEstimate.toFixed(3) : '--'}`,
      `recent_intervals_ms=[${recentIntervals}]`,
    ].join('\n')
  }, [
    inputMode,
    detectionMode,
    listening,
    selectedInputId,
    calibrationFactor,
    energy,
    detectedBeatCount,
    workletOnsetCount,
    emulationEnabled,
    emulationBpm,
    emulationJitterMs,
    emulatedBeatCount,
    rawIntervalMs,
    acceptedIntervalMs,
    rejectedIntervalCount,
    targetBpmEnabled,
    targetBpm,
    visibleSamplesCount,
    offsetSamples.length,
    intervalSamples,
    intervalStats,
  ])

  const copyDebugSnapshot = async () => {
    if (debugCopyResetTimeoutRef.current !== null) {
      window.clearTimeout(debugCopyResetTimeoutRef.current)
      debugCopyResetTimeoutRef.current = null
    }
    try {
      await navigator.clipboard.writeText(debugSnapshot)
      setDebugCopyStatus('copied')
    } catch {
      setDebugCopyStatus('failed')
    }
    debugCopyResetTimeoutRef.current = window.setTimeout(() => {
      setDebugCopyStatus('idle')
      debugCopyResetTimeoutRef.current = null
    }, 2000)
  }

  const calibrateMic = async () => {
    setCalibrating(true)
    setPermissionError(null)
    setCalibrationInfo('Calibrating for ambient noise... stay quiet')
    try {
      const context = await ensureAudioContext()
      const rmsSamples = await captureCalibrationRms(context, selectedInputId)
      if (rmsSamples.length === 0) {
        setCalibrationInfo('Calibration failed, no audio samples captured')
        return
      }
      const sorted = [...rmsSamples].sort((a, b) => a - b)
      const med = sorted[Math.floor(sorted.length * 0.5)]
      const q90 = sorted[Math.floor(sorted.length * 0.9)]
      const dynamic = q90 / Math.max(med, 0.0005)
      const nextFactor = Math.max(1.8, Math.min(4, dynamic + 0.9))
      setCalibrationFactor(nextFactor)
      setCalibrationInfo(`Calibrated: noise floor ${(med * 100).toFixed(2)}%, sensitivity x${nextFactor.toFixed(2)}`)
    } catch {
      setPermissionError('Calibration failed. Please allow mic access and try again.')
      setCalibrationInfo('Calibration failed')
    } finally {
      setCalibrating(false)
    }
  }

  // Advance the graph clock each animation frame.
  useEffect(() => {
    let rafId = 0
    const frame = () => {
      setGraphNowMs(performance.now())
      rafId = requestAnimationFrame(frame)
    }
    rafId = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(rafId)
    }
  }, [])

  // Initial reset on mount.
  useEffect(() => {
    resetFreeIntervalTracking()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Start / stop mic listening when relevant state changes.
  useEffect(() => {
    if (listening && inputMode === 'mic') {
      void startListening(detectionMode, calibrationFactor, selectedInputId)
    } else {
      stopListening()
      resetBeatCounters()
    }
    return () => {
      stopListening()
      resetBeatCounters()
    }
  }, [listening, inputMode, calibrationFactor, selectedInputId, detectionMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard tap input.
  useEffect(() => {
    if (inputMode !== 'key') return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return

      const key = event.key.toLowerCase()
      const isBeatKey =
        event.code === 'Space' ||
        event.code === 'Enter' ||
        event.code === 'KeyF' ||
        key === ' ' ||
        key === 'enter' ||
        key === 'f'

      if (!isBeatKey) return

      // Allow tapping from most focused elements, but avoid hijacking editable text fields.
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLButtonElement
      ) {
        return
      }

      event.preventDefault()
      setKeyFlashCount((n) => n + 1)
      void ensureAudioContext().then((context) => {
        registerBeat(context.currentTime, 'key')
      })
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [inputMode, ensureAudioContext, registerBeat])

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (debugCopyResetTimeoutRef.current !== null) {
        window.clearTimeout(debugCopyResetTimeoutRef.current)
        debugCopyResetTimeoutRef.current = null
      }
      void audioContextRef.current?.close()
      audioContextRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className={`app-shell${showDebugPanel ? '' : ' debug-hidden'}`}>
      <div className="main-column">
        <BeatGraph
          offsetSamples={offsetSamples}
          bpmHistorySamples={bpmHistorySamples}
          graphNowMs={graphNowMs}
          energy={energy}
          inputMode={inputMode}
          keyFlashCount={keyFlashCount}
          targetBpmEnabled={targetBpmEnabled}
          targetBpm={targetBpm}
        />
        <ControlPanel
          inputMode={inputMode}
          setInputMode={setInputMode}
          detectionMode={detectionMode}
          setDetectionMode={setDetectionMode}
          selectedInputId={selectedInputId}
          setSelectedInputId={setSelectedInputId}
          inputDevices={inputDevices}
          listening={listening}
          setListening={setListening}
          calibrating={calibrating}
          calibrationInfo={calibrationInfo}
          targetBpmEnabled={targetBpmEnabled}
          setTargetBpmEnabled={setTargetBpmEnabled}
          targetBpm={targetBpm}
          setTargetBpm={setTargetBpm}
          permissionError={permissionError}
          deviceError={deviceError}
          status={status}
          statusText={statusText}
          energy={energy}
          showDebugPanel={showDebugPanel}
          setShowDebugPanel={setShowDebugPanel}
          detectedBeatCount={detectedBeatCount}
          workletOnsetCount={workletOnsetCount}
          emulatedBeatCount={emulatedBeatCount}
          offsetSamplesLength={offsetSamples.length}
          visibleSamplesCount={visibleSamplesCount}
          onRefreshDevices={refreshDevices}
          onCalibrateMic={calibrateMic}
          keyFlashCount={keyFlashCount}
        />
      </div>
      {showDebugPanel ? (
        <DebugPanel
          debugSnapshot={debugSnapshot}
          debugCopyStatus={debugCopyStatus}
          emulationEnabled={emulationEnabled}
          setEmulationEnabled={setEmulationEnabled}
          emulationBpm={emulationBpm}
          setEmulationBpm={setEmulationBpm}
          emulationJitterMs={emulationJitterMs}
          setEmulationJitterMs={setEmulationJitterMs}
          onCopy={copyDebugSnapshot}
        />
      ) : null}
    </main>
  )
}

export default App
