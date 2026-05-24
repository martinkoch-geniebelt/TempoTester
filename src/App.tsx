import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

type Status = 'idle'

type OffsetSample = {
  valueMs: number
  at: number
  source: 'mic' | 'key' | 'emu'
}

type DeviceOption = {
  id: string
  label: string
}

const GRAPH_HISTORY_MS = 12000
const GRAPH_WIDTH = 920
const GRAPH_HEIGHT = 220
const GRAPH_PADDING_LEFT = 156
const GRAPH_PADDING_RIGHT = 22
const GRAPH_PADDING_TOP = 14
const GRAPH_PADDING_BOTTOM = 30
const NOW_ANCHOR_RATIO = 0.82
const DETECTOR_MIN_GAP_SECONDS = 0.09
const DEFAULT_INTERVAL_MS = 600
const MIN_INTERVAL_MS = 80
const MAX_INTERVAL_MS = 3000
const OUTLIER_RATIO = 0.34
const STANDARD_NOISE_FLOOR_GATE = 0.01

const median = (values: number[]) => {
  if (values.length === 0) {
    return 0
  }
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2
  }
  return sorted[mid]
}

function App() {
  const [detectionMode, setDetectionMode] = useState<'standard' | 'precision'>('precision')
  const [inputMode, setInputMode] = useState<'mic' | 'key'>('mic')
  const [listening, setListening] = useState(false)
  const [permissionError, setPermissionError] = useState<string | null>(null)
  const [deviceError, setDeviceError] = useState<string | null>(null)
  const [inputDevices, setInputDevices] = useState<DeviceOption[]>([])
  const [selectedInputId, setSelectedInputId] = useState('')
  const [calibrating, setCalibrating] = useState(false)
  const [calibrationInfo, setCalibrationInfo] = useState('Not calibrated')
  const [calibrationFactor, setCalibrationFactor] = useState(2.5)
  const [energy, setEnergy] = useState(0)
  const [status, setStatus] = useState<Status>('idle')
  const [offsetSamples, setOffsetSamples] = useState<OffsetSample[]>([])
  const [graphNowMs, setGraphNowMs] = useState(() => performance.now())
  const [intervalSamples, setIntervalSamples] = useState<number[]>([])
  const [detectedBeatCount, setDetectedBeatCount] = useState(0)
  const [workletOnsetCount, setWorkletOnsetCount] = useState(0)
  const [emulationEnabled, setEmulationEnabled] = useState(false)
  const [emulationBpm, setEmulationBpm] = useState(120)
  const [emulationJitterMs, setEmulationJitterMs] = useState(0)
  const [emulatedBeatCount, setEmulatedBeatCount] = useState(0)
  const [rawIntervalMs, setRawIntervalMs] = useState<number | null>(null)
  const [acceptedIntervalMs, setAcceptedIntervalMs] = useState<number | null>(null)
  const [rejectedIntervalCount, setRejectedIntervalCount] = useState(0)
  const [debugCopyStatus, setDebugCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [showDebugPanel, setShowDebugPanel] = useState(true)

  const audioContextRef = useRef<AudioContext | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const workletNodeRef = useRef<AudioWorkletNode | null>(null)
  const workletMonitorGainRef = useRef<GainNode | null>(null)
  const workletLoadedRef = useRef(false)
  const rafRef = useRef<number | null>(null)
  const energyFloorRef = useRef(0)
  const prevEnergyRef = useRef(0)
  const lastDetectedBeatRef = useRef(0)
  const displayedEnergyRef = useRef(0)
  const lastFreeBeatRef = useRef<number | null>(null)
  const emulationTimeoutRef = useRef<number | null>(null)
  const emulationNextBeatRef = useRef(0)
  const debugCopyResetTimeoutRef = useRef<number | null>(null)
  const recentDetectedBeatEnergyPctRef = useRef<number[]>([])

  const retainedBeatCount = useMemo(() => {
    const windowMs = GRAPH_HISTORY_MS
    let estimatedIntervalMs = DEFAULT_INTERVAL_MS

    if (intervalSamples.length > 0) {
      estimatedIntervalMs = intervalSamples.reduce((acc, value) => acc + value, 0) / intervalSamples.length
    }

    const beatsInWindow = windowMs / Math.max(estimatedIntervalMs, 1)
    return Math.max(24, Math.ceil(beatsInWindow * 2))
  }, [intervalSamples])

  const statusText = useMemo(() => {
    if (intervalSamples.length === 0) {
      return 'Waiting for beat input'
    }
    const avgIntervalMs = intervalSamples.reduce((acc, value) => acc + value, 0) / intervalSamples.length
    const bpmEstimate = avgIntervalMs > 0 ? 60000 / avgIntervalMs : 0
    return `Interval avg ${avgIntervalMs.toFixed(1)} ms (${bpmEstimate.toFixed(2)} BPM)`
  }, [intervalSamples])

  const intervalStats = useMemo(() => {
    if (intervalSamples.length === 0) {
      return null
    }
    const avgIntervalMs = intervalSamples.reduce((acc, value) => acc + value, 0) / intervalSamples.length
    const lastIntervalMs = intervalSamples[intervalSamples.length - 1]
    const variance =
      intervalSamples.reduce((acc, value) => acc + (value - avgIntervalMs) ** 2, 0) / intervalSamples.length
    const bpmEstimate = avgIntervalMs > 0 ? 60000 / avgIntervalMs : 0
    return {
      count: intervalSamples.length,
      avgIntervalMs,
      lastIntervalMs,
      stdMs: Math.sqrt(variance),
      bpmEstimate,
    }
  }, [intervalSamples])

  const graphUsableWidth = GRAPH_WIDTH - GRAPH_PADDING_LEFT - GRAPH_PADDING_RIGHT
  const graphUsableHeight = GRAPH_HEIGHT - GRAPH_PADDING_TOP - GRAPH_PADDING_BOTTOM
  const zeroY = GRAPH_PADDING_TOP + graphUsableHeight / 2
  const nowX = GRAPH_PADDING_LEFT + graphUsableWidth * NOW_ANCHOR_RATIO
  const visiblePastMs = GRAPH_HISTORY_MS * NOW_ANCHOR_RATIO
  const graphTitle = 'Beat Interval'
  const graphAriaLabel = 'Beat interval graph over time'
  const graphCaption = 'Now stays fixed, history scrolls left. Y-axis shows beat interval duration.'

  const windowNowMs = useMemo(() => {
    const lastSampleAt = offsetSamples.length > 0 ? offsetSamples[offsetSamples.length - 1].at : 0
    return Math.max(graphNowMs, lastSampleAt)
  }, [graphNowMs, offsetSamples])

  const visibleGraphSamples = useMemo(() => {
    const minTime = windowNowMs - visiblePastMs
    return offsetSamples.filter((sample) => sample.at >= minTime)
  }, [offsetSamples, windowNowMs, visiblePastMs])

  const graphCenterMs = useMemo(() => {
    if (visibleGraphSamples.length === 0) {
      return 0
    }
    const sum = visibleGraphSamples.reduce((acc, sample) => acc + sample.valueMs, 0)
    return sum / visibleGraphSamples.length
  }, [visibleGraphSamples])

  const yRangeMs = useMemo(() => {
    if (visibleGraphSamples.length === 0) {
      return 10
    }

    const peakAbs = visibleGraphSamples.reduce((peak, sample) => {
      const centeredValue = sample.valueMs - graphCenterMs
      return Math.max(peak, Math.abs(centeredValue))
    }, 0)

    const padded = peakAbs * 1.22
    return Math.max(10, Math.min(520, padded))
  }, [visibleGraphSamples, graphCenterMs])

  const graphPoints = useMemo(() => {
    return visibleGraphSamples.map((sample) => {
      const ageMs = windowNowMs - sample.at
      const x = nowX - (ageMs / visiblePastMs) * graphUsableWidth
      const centeredValue = sample.valueMs - graphCenterMs
      const clampedOffset = Math.max(Math.min(centeredValue, yRangeMs), -yRangeMs)
      const y = zeroY + (clampedOffset / yRangeMs) * (graphUsableHeight / 2)
      return {
        x,
        y,
        source: sample.source,
        valueMs: sample.valueMs,
        centeredValueMs: centeredValue,
      }
    })
  }, [visibleGraphSamples, windowNowMs, nowX, visiblePastMs, graphUsableWidth, yRangeMs, zeroY, graphUsableHeight, graphCenterMs])

  const graphPolyline = useMemo(() => {
    return graphPoints.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ')
  }, [graphPoints])

  const visibleExtremes = useMemo(() => {
    if (visibleGraphSamples.length === 0) {
      return null
    }

    let maxOffset = -Infinity
    let minOffset = Infinity

    for (const sample of visibleGraphSamples) {
      if (sample.valueMs > maxOffset) {
        maxOffset = sample.valueMs
      }
      if (sample.valueMs < minOffset) {
        minOffset = sample.valueMs
      }
    }

    const maxCentered = maxOffset - graphCenterMs
    const minCentered = minOffset - graphCenterMs
    const clampedMax = Math.max(Math.min(maxCentered, yRangeMs), -yRangeMs)
    const clampedMin = Math.max(Math.min(minCentered, yRangeMs), -yRangeMs)

    return {
      maxValue: maxOffset,
      minValue: minOffset,
      maxDeltaFromCenter: Math.abs(maxOffset - graphCenterMs),
      minDeltaFromCenter: Math.abs(minOffset - graphCenterMs),
      maxDeltaPct: graphCenterMs > 0 ? (Math.abs(maxOffset - graphCenterMs) / graphCenterMs) * 100 : 0,
      minDeltaPct: graphCenterMs > 0 ? (Math.abs(minOffset - graphCenterMs) / graphCenterMs) * 100 : 0,
      maxY: zeroY + (clampedMax / yRangeMs) * (graphUsableHeight / 2),
      minY: zeroY + (clampedMin / yRangeMs) * (graphUsableHeight / 2),
    }
  }, [visibleGraphSamples, yRangeMs, zeroY, graphUsableHeight, graphCenterMs])

  const colorForOffset = (offsetMs: number) => {
    const amount = Math.min(Math.abs(offsetMs) / yRangeMs, 1)
    const start = { r: 92, g: 230, b: 152 }
    const end = offsetMs >= 0 ? { r: 255, g: 108, b: 92 } : { r: 92, g: 170, b: 255 }
    const r = Math.round(start.r + (end.r - start.r) * amount)
    const g = Math.round(start.g + (end.g - start.g) * amount)
    const b = Math.round(start.b + (end.b - start.b) * amount)
    return `rgb(${r}, ${g}, ${b})`
  }

  const graphSegments = useMemo(() => {
    const segments: Array<{ x1: number; y1: number; x2: number; y2: number; color: string }> = []
    for (let i = 1; i < graphPoints.length; i += 1) {
      const from = graphPoints[i - 1]
      const to = graphPoints[i]
      const midpointOffset = (from.centeredValueMs + to.centeredValueMs) / 2
      segments.push({
        x1: from.x,
        y1: from.y,
        x2: to.x,
        y2: to.y,
        color: colorForOffset(midpointOffset),
      })
    }
    return segments
  }, [graphPoints, yRangeMs])

  const timeGrid = useMemo(() => {
    const lines: Array<{ x: number; label: string }> = []
    for (let age = 0; age <= GRAPH_HISTORY_MS; age += 2000) {
      const x = nowX - (age / GRAPH_HISTORY_MS) * graphUsableWidth
      if (x >= GRAPH_PADDING_LEFT) {
        lines.push({ x, label: age === 0 ? 'now' : `-${(age / 1000).toFixed(0)}s` })
      }
    }
    return lines
  }, [nowX, graphUsableWidth])

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
      `graph_center_ms=${graphCenterMs.toFixed(2)}`,
      `graph_range_ms=${yRangeMs.toFixed(2)}`,
      `visible_samples=${visibleGraphSamples.length}`,
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
    graphCenterMs,
    yRangeMs,
    visibleGraphSamples.length,
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

  const recordEnergySample = (normalizedEnergy: number) => {
    const next = [...recentDetectedBeatEnergyPctRef.current, normalizedEnergy * 100]
    recentDetectedBeatEnergyPctRef.current = next.slice(-10)
  }

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

  const ensureAudioContext = async () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext()
    }

    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume()
    }

    return audioContextRef.current
  }

  const refreshDevices = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()

      const inputs = devices
        .filter((device) => device.kind === 'audioinput')
        .map((device, index) => ({
          id: device.deviceId,
          label: device.label || `Microphone ${index + 1}`,
        }))

      setInputDevices(inputs)

      if (!selectedInputId && inputs.length > 0) {
        setSelectedInputId(inputs[0].id)
      }
      setDeviceError(null)
    } catch {
      setDeviceError('Could not enumerate audio devices in this browser.')
    }
  }

  const stopListening = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }

    sourceRef.current?.disconnect()
    analyserRef.current?.disconnect()
    workletNodeRef.current?.disconnect()
    workletMonitorGainRef.current?.disconnect()

    sourceRef.current = null
    analyserRef.current = null
    workletNodeRef.current = null
    workletMonitorGainRef.current = null

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }

    energyFloorRef.current = 0
    prevEnergyRef.current = 0
    lastDetectedBeatRef.current = 0
    displayedEnergyRef.current = 0
    recentDetectedBeatEnergyPctRef.current = []
    setEnergy(0)
    setDetectedBeatCount(0)
    setWorkletOnsetCount(0)
    setEmulatedBeatCount(0)
    setRawIntervalMs(null)
    setAcceptedIntervalMs(null)
    setRejectedIntervalCount(0)
  }

  const stopEmulation = () => {
    if (emulationTimeoutRef.current !== null) {
      window.clearTimeout(emulationTimeoutRef.current)
      emulationTimeoutRef.current = null
    }
  }

  const resetFreeIntervalTracking = () => {
    lastFreeBeatRef.current = null
    setIntervalSamples([])
    setOffsetSamples([])
    setEmulatedBeatCount(0)
    setWorkletOnsetCount(0)
    setRawIntervalMs(null)
    setAcceptedIntervalMs(null)
    setRejectedIntervalCount(0)
  }

  const registerBeat = (beatTimeSeconds: number, source: 'mic' | 'key' | 'emu') => {
    if (!audioContextRef.current) {
      return
    }

    if (source === 'mic') {
      setDetectedBeatCount((count) => count + 1)
      recordEnergySample(displayedEnergyRef.current)
    } else if (source === 'emu') {
      setEmulatedBeatCount((count) => count + 1)
    }

    if (lastFreeBeatRef.current !== null) {
      const rawIntervalMs = (beatTimeSeconds - lastFreeBeatRef.current) * 1000
      setRawIntervalMs(rawIntervalMs)
      if (rawIntervalMs >= MIN_INTERVAL_MS && rawIntervalMs <= MAX_INTERVAL_MS) {
        let normalizedIntervalMs = rawIntervalMs
        let shouldAccept = true

        if (intervalSamples.length >= 4) {
          const recent = intervalSamples.slice(-6)
          const targetMs = median(recent)

          if (targetMs > 0) {
            const ratio = rawIntervalMs / targetMs
            const nearInteger = Math.round(ratio)

            // If a beat was likely missed, fold longer gaps back to one beat duration.
            if (nearInteger >= 2) {
              const folded = rawIntervalMs / nearInteger
              const foldedError = Math.abs(folded - targetMs) / targetMs
              if (foldedError <= OUTLIER_RATIO * 0.6) {
                normalizedIntervalMs = folded
              }
            }

            const errorRatio = Math.abs(normalizedIntervalMs - targetMs) / targetMs
            if (errorRatio > OUTLIER_RATIO) {
              // Reject sample but still advance anchor to avoid every-second-beat lock-in.
              setAcceptedIntervalMs(null)
              setRejectedIntervalCount((count) => count + 1)
              shouldAccept = false
            }
          }

          if (shouldAccept) {
            setAcceptedIntervalMs(normalizedIntervalMs)
            setIntervalSamples((samples) => [...samples, normalizedIntervalMs].slice(-retainedBeatCount))
            setOffsetSamples((samples) => {
              const next = [...samples, { valueMs: normalizedIntervalMs, at: performance.now(), source }]
              return next.slice(-retainedBeatCount)
            })
          }
        } else {
          // Bootstrap interval history before enabling outlier rejection.
          setAcceptedIntervalMs(normalizedIntervalMs)
          setIntervalSamples((samples) => [...samples, normalizedIntervalMs].slice(-retainedBeatCount))
          setOffsetSamples((samples) => {
            const next = [...samples, { valueMs: normalizedIntervalMs, at: performance.now(), source }]
            return next.slice(-retainedBeatCount)
          })
        }
      } else {
        setAcceptedIntervalMs(null)
        setRejectedIntervalCount((count) => count + 1)
      }
    }
    lastFreeBeatRef.current = beatTimeSeconds
    setStatus('idle')
    setGraphNowMs(performance.now())
  }

  const scheduleNextEmulatedBeat = () => {
    if (!audioContextRef.current || !emulationEnabled) {
      return
    }

    const context = audioContextRef.current
    const baseIntervalSeconds = 60 / Math.max(30, emulationBpm)
    const beatTime = emulationNextBeatRef.current
    const delayMs = Math.max((beatTime - context.currentTime) * 1000, 0)

    emulationTimeoutRef.current = window.setTimeout(() => {
      if (!audioContextRef.current || !emulationEnabled) {
        return
      }

      const jitterSeconds = ((Math.random() * 2 - 1) * emulationJitterMs) / 1000
      const nextIntervalSeconds = Math.max(0.04, baseIntervalSeconds + jitterSeconds)

      registerBeat(beatTime, 'emu')
      emulationNextBeatRef.current = beatTime + nextIntervalSeconds
      scheduleNextEmulatedBeat()
    }, delayMs)
  }

  const startEmulation = async () => {
    const context = await ensureAudioContext()
    stopEmulation()
    emulationNextBeatRef.current = context.currentTime + 0.12
    scheduleNextEmulatedBeat()
  }

  const captureCalibrationRms = async () => {
    const context = await ensureAudioContext()
    const stream = await requestMicStream(false)
    const source = context.createMediaStreamSource(stream)
    const analyser = context.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.75
    source.connect(analyser)

    const samples: number[] = []
    const data = new Float32Array(analyser.fftSize)
    const startAt = performance.now()

    await new Promise<void>((resolve) => {
      const run = () => {
        analyser.getFloatTimeDomainData(data)
        let sumSquares = 0
        for (let i = 0; i < data.length; i += 1) {
          const sample = data[i]
          sumSquares += sample * sample
        }
        samples.push(Math.sqrt(sumSquares / data.length))

        if (performance.now() - startAt < 2200) {
          requestAnimationFrame(run)
        } else {
          resolve()
        }
      }
      run()
    })

    source.disconnect()
    analyser.disconnect()
    stream.getTracks().forEach((track) => track.stop())

    return samples
  }

  const buildMicConstraints = (precision: boolean) => {
    const baseDevice = selectedInputId ? { deviceId: { exact: selectedInputId } } : {}
    if (!precision) {
      return selectedInputId ? { deviceId: { exact: selectedInputId } } : true
    }

    return {
      ...baseDevice,
      echoCancellation: { ideal: false },
      noiseSuppression: { ideal: false },
      autoGainControl: { ideal: false },
      channelCount: { ideal: 1 },
      latency: { ideal: 0.01 },
    }
  }

  const requestMicStream = async (precision: boolean) => {
    const primaryConstraints = buildMicConstraints(precision)
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: primaryConstraints,
      })
    } catch {
      // If selected device constraints fail (stale id / unsupported flags), fallback to default mic.
      const fallbackAudio = precision
        ? {
            echoCancellation: { ideal: false },
            noiseSuppression: { ideal: false },
            autoGainControl: { ideal: false },
            channelCount: { ideal: 1 },
            latency: { ideal: 0.01 },
          }
        : true

      return await navigator.mediaDevices.getUserMedia({
        audio: fallbackAudio,
      })
    }
  }

  const calibrateMic = async () => {
    setCalibrating(true)
    setPermissionError(null)
    setCalibrationInfo('Calibrating for ambient noise... stay quiet')

    try {
      const rmsSamples = await captureCalibrationRms()
      if (rmsSamples.length === 0) {
        setCalibrationInfo('Calibration failed, no audio samples captured')
        return
      }

      const sorted = [...rmsSamples].sort((a, b) => a - b)
      const median = sorted[Math.floor(sorted.length * 0.5)]
      const q90 = sorted[Math.floor(sorted.length * 0.9)]
      const dynamic = q90 / Math.max(median, 0.0005)
      const nextFactor = Math.max(1.8, Math.min(4, dynamic + 0.9))

      setCalibrationFactor(nextFactor)
      setCalibrationInfo(
        `Calibrated: noise floor ${(median * 100).toFixed(2)}%, sensitivity x${nextFactor.toFixed(2)}`,
      )
    } catch {
      setPermissionError('Calibration failed. Please allow mic access and try again.')
      setCalibrationInfo('Calibration failed')
    } finally {
      setCalibrating(false)
    }
  }

  const startListening = async () => {
    try {
      const context = await ensureAudioContext()
      const stream = await requestMicStream(detectionMode === 'precision')

      streamRef.current = stream
      const source = context.createMediaStreamSource(stream)

      sourceRef.current = source
      energyFloorRef.current = 0
      prevEnergyRef.current = 0
      lastDetectedBeatRef.current = 0
      setPermissionError(null)
      await refreshDevices()

      if (detectionMode === 'precision' && 'audioWorklet' in context) {
        try {
          if (!workletLoadedRef.current) {
            await context.audioWorklet.addModule('/onset-detector-worklet.js')
            workletLoadedRef.current = true
          }

          const detectorNode = new AudioWorkletNode(context, 'onset-detector-processor', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            channelCount: 1,
            outputChannelCount: [1],
          })

          const monitorGain = context.createGain()
          monitorGain.gain.value = 0

          source.connect(detectorNode)
          detectorNode.connect(monitorGain)
          monitorGain.connect(context.destination)
          workletNodeRef.current = detectorNode
          workletMonitorGainRef.current = monitorGain

          detectorNode.port.postMessage({
            type: 'config',
            sensitivity: Math.max(0.95, calibrationFactor * 0.52),
            minGapSeconds: DETECTOR_MIN_GAP_SECONDS,
          })

          detectorNode.port.onmessage = (event: MessageEvent) => {
            if (!audioContextRef.current) {
              return
            }

            if (event.data?.type === 'meter') {
              const rms = Number(event.data.rms) || 0
              const instantEnergy = Math.min(rms * 24, 1)
              const decayed = displayedEnergyRef.current * 0.72
              const nextDisplay = Math.max(instantEnergy, decayed)
              displayedEnergyRef.current = nextDisplay
              setEnergy(nextDisplay)
              return
            }

            if (event.data?.type !== 'onset') {
              return
            }

            const onsetTimeSeconds = Number(event.data.time)
            if (!Number.isFinite(onsetTimeSeconds)) {
              return
            }

            setWorkletOnsetCount((count) => count + 1)

            lastDetectedBeatRef.current = onsetTimeSeconds
            registerBeat(onsetTimeSeconds, 'mic')
          }

          return
        } catch {
          setCalibrationInfo('Precision detector unavailable, using standard detector')
        }
      }

      const analyser = context.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0.7

      source.connect(analyser)
      analyserRef.current = analyser

      const data = new Float32Array(analyser.fftSize)

      const loop = () => {
        if (!audioContextRef.current || !analyserRef.current) {
          return
        }

        analyserRef.current.getFloatTimeDomainData(data)

        let sumSquares = 0
        let peakAbs = 0
        let peakIndex = 0
        for (let i = 0; i < data.length; i += 1) {
          const sample = data[i]
          sumSquares += sample * sample
          const abs = Math.abs(sample)
          if (abs > peakAbs) {
            peakAbs = abs
            peakIndex = i
          }
        }

        const rms = Math.sqrt(sumSquares / data.length)
        const floor = energyFloorRef.current * 0.96 + rms * 0.04
        energyFloorRef.current = floor

        const sensitivity = calibrationFactor
        const adaptiveThreshold = floor * sensitivity
        const triggerThreshold = adaptiveThreshold * 0.78
        const slope = rms - prevEnergyRef.current
        prevEnergyRef.current = rms
        const instantEnergy = Math.min(rms * 14, 1)
        const decayed = displayedEnergyRef.current * 0.9
        const nextDisplay = Math.max(instantEnergy, decayed)
        displayedEnergyRef.current = nextDisplay
        setEnergy(nextDisplay)

        const now = audioContextRef.current.currentTime
        const sampleRate = audioContextRef.current.sampleRate
        const peakAgeSeconds = (data.length - 1 - peakIndex) / sampleRate
        const estimatedOnsetTime = now - peakAgeSeconds
        const minGap = DETECTOR_MIN_GAP_SECONDS
        const floorGate = Math.max(STANDARD_NOISE_FLOOR_GATE, floor * 2.2)
        const peakGate = Math.max(0.03, triggerThreshold * 6.5)

        if (
          rms > triggerThreshold &&
          rms > floorGate &&
          slope > 0.0023 &&
          peakAbs > peakGate &&
          estimatedOnsetTime - lastDetectedBeatRef.current > minGap
        ) {
          lastDetectedBeatRef.current = estimatedOnsetTime

          registerBeat(estimatedOnsetTime, 'mic')
        }

        rafRef.current = requestAnimationFrame(loop)
      }

      rafRef.current = requestAnimationFrame(loop)
    } catch {
      setPermissionError('Microphone permission was denied or unavailable.')
      setListening(false)
    }
  }

  useEffect(() => {
    resetFreeIntervalTracking()
  }, [])

  useEffect(() => {
    setOffsetSamples((samples) => {
      if (samples.length <= retainedBeatCount) {
        return samples
      }
      return samples.slice(-retainedBeatCount)
    })
    setIntervalSamples((samples) => {
      if (samples.length <= retainedBeatCount) {
        return samples
      }
      return samples.slice(-retainedBeatCount)
    })
  }, [retainedBeatCount])

  useEffect(() => {
    void refreshDevices()

    const onDeviceChange = () => {
      void refreshDevices()
    }

    navigator.mediaDevices.addEventListener('devicechange', onDeviceChange)
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange)
    }
  }, [])

  useEffect(() => {
    if (listening && inputMode === 'mic') {
      void startListening()
    } else {
      stopListening()
    }

    return () => {
      stopListening()
    }
  }, [
    listening,
    inputMode,
    calibrationFactor,
    selectedInputId,
    detectionMode,
  ])

  useEffect(() => {
    if (emulationEnabled) {
      void startEmulation()
    } else {
      stopEmulation()
    }

    return () => {
      stopEmulation()
    }
  }, [emulationEnabled, emulationBpm, emulationJitterMs])

  useEffect(() => {
    if (inputMode !== 'key') {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      const key = event.key.toLowerCase()
      const isBeatKey =
        event.code === 'Space' ||
        event.code === 'Enter' ||
        event.code === 'KeyF' ||
        key === ' ' ||
        key === 'enter' ||
        key === 'f'

      if (!isBeatKey) {
        return
      }

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
      void ensureAudioContext().then((context) => {
        registerBeat(context.currentTime, 'key')
      })
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [inputMode, retainedBeatCount, intervalSamples])

  useEffect(() => {
    return () => {
      if (debugCopyResetTimeoutRef.current !== null) {
        window.clearTimeout(debugCopyResetTimeoutRef.current)
        debugCopyResetTimeoutRef.current = null
      }

      stopEmulation()
      stopListening()
      void audioContextRef.current?.close()
      audioContextRef.current = null
    }
  }, [])

  return (
    <main className={`app-shell${showDebugPanel ? '' : ' debug-hidden'}`}>
      <div className="main-column">
        <section className="panel visual-panel">
          <h2>{graphTitle}</h2>
          <div className="offset-graph-wrap" role="img" aria-label={graphAriaLabel}>
            <svg className="offset-graph" viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}>
            <defs>
              <clipPath id="plot-clip">
                <rect
                  x={GRAPH_PADDING_LEFT}
                  y={GRAPH_PADDING_TOP}
                  width={graphUsableWidth}
                  height={graphUsableHeight}
                />
              </clipPath>
            </defs>

            <rect
              x={GRAPH_PADDING_LEFT}
              y={GRAPH_PADDING_TOP}
              width={graphUsableWidth}
              height={graphUsableHeight}
              className="graph-plot"
            />

            {timeGrid.map((line) => (
              <g key={line.label}>
                <line
                  x1={line.x}
                  y1={GRAPH_PADDING_TOP}
                  x2={line.x}
                  y2={GRAPH_HEIGHT - GRAPH_PADDING_BOTTOM}
                  className="graph-time-line"
                />
                <text x={line.x} y={GRAPH_HEIGHT - 10} className="graph-time-label">
                  {line.label}
                </text>
              </g>
            ))}

            <line
              x1={GRAPH_PADDING_LEFT}
              y1={zeroY}
              x2={GRAPH_WIDTH - GRAPH_PADDING_RIGHT}
              y2={zeroY}
              className="graph-zero-line"
            />

            {visibleExtremes ? (
              <>
                <line
                  x1={GRAPH_PADDING_LEFT}
                  y1={visibleExtremes.maxY}
                  x2={GRAPH_WIDTH - GRAPH_PADDING_RIGHT}
                  y2={visibleExtremes.maxY}
                  className="graph-extreme-line graph-extreme-max"
                />
                <line
                  x1={GRAPH_PADDING_LEFT}
                  y1={visibleExtremes.minY}
                  x2={GRAPH_WIDTH - GRAPH_PADDING_RIGHT}
                  y2={visibleExtremes.minY}
                  className="graph-extreme-line graph-extreme-min"
                />

                <text
                  x={GRAPH_WIDTH - GRAPH_PADDING_RIGHT - 6}
                  y={visibleExtremes.maxY - 4}
                  className="graph-extreme-label graph-extreme-max-label"
                  textAnchor="end"
                >
                  {`max ${visibleExtremes.maxValue.toFixed(1)} ms (|Δ| ${visibleExtremes.maxDeltaFromCenter.toFixed(1)} ms, ${visibleExtremes.maxDeltaPct.toFixed(1)}%)`}
                </text>
                <text
                  x={GRAPH_WIDTH - GRAPH_PADDING_RIGHT - 6}
                  y={visibleExtremes.minY - 4}
                  className="graph-extreme-label graph-extreme-min-label"
                  textAnchor="end"
                >
                  {`min ${visibleExtremes.minValue.toFixed(1)} ms (|Δ| ${visibleExtremes.minDeltaFromCenter.toFixed(1)} ms, ${visibleExtremes.minDeltaPct.toFixed(1)}%)`}
                </text>
              </>
            ) : null}

            <line
              x1={nowX}
              y1={GRAPH_PADDING_TOP}
              x2={nowX}
              y2={GRAPH_HEIGHT - GRAPH_PADDING_BOTTOM}
              className="graph-now-line"
            />

            <text x={GRAPH_PADDING_LEFT - 10} y={GRAPH_PADDING_TOP + 10} className="graph-y-label" textAnchor="end">
              {(graphCenterMs + yRangeMs).toFixed(0)} ms
            </text>
            <text x={GRAPH_PADDING_LEFT - 10} y={zeroY + 4} className="graph-y-label" textAnchor="end">
              {`${graphCenterMs.toFixed(1)} ms (${(graphCenterMs > 0 ? 60000 / graphCenterMs : 0).toFixed(2)} BPM)`}
            </text>
            <text
              x={GRAPH_PADDING_LEFT - 10}
              y={GRAPH_HEIGHT - GRAPH_PADDING_BOTTOM}
              className="graph-y-label"
              textAnchor="end"
            >
              {(graphCenterMs - yRangeMs).toFixed(0)} ms
            </text>

            <g clipPath="url(#plot-clip)">
              {graphSegments.map((segment, index) => (
                <line
                  key={`${segment.x1}-${segment.y1}-${index}`}
                  x1={segment.x1}
                  y1={segment.y1}
                  x2={segment.x2}
                  y2={segment.y2}
                  stroke={segment.color}
                  className="graph-segment"
                />
              ))}

              {graphPolyline ? <polyline className="graph-trace" points={graphPolyline} /> : null}

              {graphPoints.map((point, index) => (
                <circle
                  key={`${point.x}-${point.y}-${index}`}
                  cx={point.x}
                  cy={point.y}
                  r={4}
                  className={`graph-point graph-point-${point.source}`}
                  style={{ fill: colorForOffset(point.centeredValueMs) }}
                >
                  <title>
                    {`${point.source === 'mic' ? 'Mic' : point.source === 'key' ? 'Key' : 'Emu'} ${point.valueMs.toFixed(1)} ms`}
                  </title>
                </circle>
              ))}
            </g>
            </svg>
            <div className="graph-caption">{graphCaption}</div>
          </div>

          <div className="meter-wrap">
            <div className="meter-track">
              <div className="meter-fill" style={{ width: `${energy * 100}%` }} />
            </div>
            <span>{inputMode === 'mic' ? 'Input Pulse Strength' : 'Pulse meter is mic-only'}</span>
          </div>

        </section>

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

          <button type="button" onClick={() => void refreshDevices()}>
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
              <button type="button" onClick={() => void calibrateMic()} disabled={calibrating}>
                {calibrating ? 'Calibrating...' : 'Calibrate Mic'}
              </button>
            </>
          ) : (
            <p className="key-hint">Tap Space, Enter, or F on each beat.</p>
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
            <button type="button" className="copy-debug-inline" onClick={() => setShowDebugPanel((value) => !value)}>
              {showDebugPanel ? 'Hide Debug Panel' : 'Show Debug Panel'}
            </button>
            <button type="button" className="copy-debug-inline" onClick={() => void copyDebugSnapshot()}>
              {debugCopyStatus === 'copied'
                ? 'Copied'
                : debugCopyStatus === 'failed'
                  ? 'Copy failed'
                  : 'Copy Debug Data'}
            </button>
          </div>
        </div>
        {inputMode === 'mic' ? <p className="calibration-info">{calibrationInfo}</p> : null}
        {inputMode === 'mic' ? (
          <p className="calibration-info">
            Detector {detectionMode} | beats detected {detectedBeatCount} | plotted {visibleGraphSamples.length} |
            stored {offsetSamples.length} | emulated {emulatedBeatCount} | worklet onsets {workletOnsetCount}
          </p>
        ) : null}
        <p className="calibration-info">
          Detector debug: raw {rawIntervalMs !== null ? `${rawIntervalMs.toFixed(1)} ms` : '--'} | accepted{' '}
          {acceptedIntervalMs !== null ? `${acceptedIntervalMs.toFixed(1)} ms` : '--'} | rejected {rejectedIntervalCount}
        </p>
        <p className="calibration-info">External metronome mode: internal click disabled.</p>
        <p className="calibration-info">
          {intervalStats
            ? `Free interval: last ${intervalStats.lastIntervalMs.toFixed(1)} ms | avg ${intervalStats.avgIntervalMs.toFixed(1)} ms | est ${intervalStats.bpmEstimate.toFixed(2)} BPM | std ${intervalStats.stdMs.toFixed(1)} ms | n=${intervalStats.count}`
            : 'Free interval: waiting for at least two beats...'}
        </p>
        </section>
      </div>

      {showDebugPanel ? (
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
            <button type="button" onClick={() => void copyDebugSnapshot()}>
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
      ) : null}
    </main>
  )
}

export default App
