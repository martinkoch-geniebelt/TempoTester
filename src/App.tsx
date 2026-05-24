import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

type Status = 'idle' | 'ahead' | 'behind' | 'on'

type OffsetSample = {
  valueMs: number
  at: number
  source: 'mic' | 'key' | 'sim'
}

type DeviceOption = {
  id: string
  label: string
}

type SoundProfile = 'soft-pulse' | 'muted-wood' | 'pure-beep'

const GRAPH_HISTORY_MS = 12000
const GRAPH_WIDTH = 920
const GRAPH_HEIGHT = 220
const GRAPH_PADDING_LEFT = 156
const GRAPH_PADDING_RIGHT = 22
const GRAPH_PADDING_TOP = 14
const GRAPH_PADDING_BOTTOM = 30
const NOW_ANCHOR_RATIO = 0.82
const MAX_TICK_TIMES = 32

function App() {
  const [bpm, setBpm] = useState(110)
  const [detectionMode, setDetectionMode] = useState<'standard' | 'precision'>('precision')
  const [timingMode, setTimingMode] = useState<'sync' | 'free'>('sync')
  const [metronomeEnabled, setMetronomeEnabled] = useState(false)
  const [inputMode, setInputMode] = useState<'mic' | 'key'>('mic')
  const [listening, setListening] = useState(false)
  const [permissionError, setPermissionError] = useState<string | null>(null)
  const [deviceError, setDeviceError] = useState<string | null>(null)
  const [inputDevices, setInputDevices] = useState<DeviceOption[]>([])
  const [outputDevices, setOutputDevices] = useState<DeviceOption[]>([])
  const [selectedInputId, setSelectedInputId] = useState('')
  const [selectedOutputId, setSelectedOutputId] = useState('')
  const [supportsOutputSelect, setSupportsOutputSelect] = useState(false)
  const [calibrating, setCalibrating] = useState(false)
  const [calibrationInfo, setCalibrationInfo] = useState('Not calibrated')
  const [calibrationFactor, setCalibrationFactor] = useState(2.5)
  const [energy, setEnergy] = useState(0)
  const [status, setStatus] = useState<Status>('idle')
  const [offsetSamples, setOffsetSamples] = useState<OffsetSample[]>([])
  const [measuredTempoBpm, setMeasuredTempoBpm] = useState(0)
  const [measuredJitterMs, setMeasuredJitterMs] = useState(0)
  const [measuredTickCount, setMeasuredTickCount] = useState(0)
  const [outputLatencyMs, setOutputLatencyMs] = useState<number | null>(null)
  const [graphNowMs, setGraphNowMs] = useState(() => performance.now())
  const [testModeEnabled, setTestModeEnabled] = useState(false)
  const [simJitterMs, setSimJitterMs] = useState(18)
  const [soundProfile, setSoundProfile] = useState<SoundProfile>('pure-beep')
  const [metronomeVolume, setMetronomeVolume] = useState(1.4)
  const [audioTestMessage, setAudioTestMessage] = useState('')
  const [intervalSamples, setIntervalSamples] = useState<number[]>([])

  const audioContextRef = useRef<AudioContext | null>(null)
  const clickBufferRef = useRef<AudioBuffer | null>(null)
  const masterGainRef = useRef<GainNode | null>(null)
  const metronomeOutputRef = useRef<MediaStreamAudioDestinationNode | null>(null)
  const outputAudioRef = useRef<HTMLAudioElement | null>(null)
  const sinkRoutingActiveRef = useRef(false)
  const metronomeTimerRef = useRef<number | null>(null)
  const nextTickTimeRef = useRef(0)
  const metronomeStartRef = useRef(0)
  const beatIndexRef = useRef(0)
  const tickTimesRef = useRef<number[]>([])
  const simTimeoutRef = useRef<number | null>(null)
  const simBeatIndexRef = useRef(0)

  const streamRef = useRef<MediaStream | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const workletNodeRef = useRef<AudioWorkletNode | null>(null)
  const workletLoadedRef = useRef(false)
  const rafRef = useRef<number | null>(null)
  const energyFloorRef = useRef(0)
  const prevEnergyRef = useRef(0)
  const lastDetectedBeatRef = useRef(0)
  const displayedEnergyRef = useRef(0)
  const metronomeVolumeRef = useRef(metronomeVolume)
  const lastFreeBeatRef = useRef<number | null>(null)

  const beatInterval = 60 / bpm
  const freeModeActive = timingMode === 'free'
  const retainedBeatCount = useMemo(() => {
    const windowMs = GRAPH_HISTORY_MS
    let estimatedIntervalMs = beatInterval * 1000

    if (freeModeActive && intervalSamples.length > 0) {
      estimatedIntervalMs = intervalSamples.reduce((acc, value) => acc + value, 0) / intervalSamples.length
    }

    const beatsInWindow = windowMs / Math.max(estimatedIntervalMs, 1)
    return Math.max(24, Math.ceil(beatsInWindow * 2))
  }, [beatInterval, freeModeActive, intervalSamples])

  const averageOffsetMs = useMemo(() => {
    if (offsetSamples.length === 0) {
      return 0
    }
    const sum = offsetSamples.reduce((acc, sample) => acc + sample.valueMs, 0)
    return sum / offsetSamples.length
  }, [offsetSamples])

  const statusText = useMemo(() => {
    if (freeModeActive) {
      if (intervalSamples.length === 0) {
        return 'Waiting for beat input'
      }
      const avgIntervalMs = intervalSamples.reduce((acc, value) => acc + value, 0) / intervalSamples.length
      const bpmEstimate = avgIntervalMs > 0 ? 60000 / avgIntervalMs : 0
      return `Interval avg ${avgIntervalMs.toFixed(1)} ms (${bpmEstimate.toFixed(2)} BPM)`
    }

    const absMs = Math.abs(averageOffsetMs)
    if (offsetSamples.length === 0) {
      return 'Waiting for beat input'
    }
    if (absMs < 20) {
      return `Locked in (${absMs.toFixed(0)} ms)`
    }
    return averageOffsetMs < 0
      ? `Ahead by ${absMs.toFixed(0)} ms`
      : `Behind by ${absMs.toFixed(0)} ms`
  }, [freeModeActive, intervalSamples, averageOffsetMs, offsetSamples.length])

  const simStats = useMemo(() => {
    const simulated = offsetSamples.filter((sample) => sample.source === 'sim')
    if (simulated.length < 2) {
      return null
    }

    const values = simulated.map((sample) => sample.valueMs)
    const avg = values.reduce((acc, value) => acc + value, 0) / values.length
    const variance = values.reduce((acc, value) => acc + (value - avg) ** 2, 0) / values.length
    return {
      count: values.length,
      avg,
      std: Math.sqrt(variance),
    }
  }, [offsetSamples])

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
  const graphTitle = freeModeActive ? 'Beat Interval' : 'Timing Offset'
  const graphAriaLabel = freeModeActive ? 'Beat interval graph over time' : 'Offset graph over time'
  const graphCaption = freeModeActive
    ? 'Now stays fixed, history scrolls left. Y-axis shows beat interval duration.'
    : 'Now stays fixed, history scrolls left. Y-axis is offset from beat.'

  const metronomeDiagnostic = useMemo(() => {
    if (!metronomeEnabled || measuredTickCount < 4) {
      return 'Metronome diagnostics: collecting ticks...'
    }

    const delta = measuredTempoBpm - bpm
    const sign = delta >= 0 ? '+' : ''
    return `Metronome diagnostics: ${measuredTempoBpm.toFixed(2)} BPM (${sign}${delta.toFixed(2)}) | jitter ${measuredJitterMs.toFixed(2)} ms`
  }, [metronomeEnabled, measuredTickCount, measuredTempoBpm, bpm, measuredJitterMs])

  const outputLatencyDiagnostic = useMemo(() => {
    if (outputLatencyMs === null) {
      return 'Output latency estimate: unavailable in this browser'
    }
    return `Output latency estimate: ${outputLatencyMs.toFixed(1)} ms (browser-reported)`
  }, [outputLatencyMs])

  const windowNowMs = useMemo(() => {
    const lastSampleAt = offsetSamples.length > 0 ? offsetSamples[offsetSamples.length - 1].at : 0
    return Math.max(graphNowMs, lastSampleAt)
  }, [graphNowMs, offsetSamples])

  const visibleGraphSamples = useMemo(() => {
    const minTime = windowNowMs - visiblePastMs
    return offsetSamples.filter((sample) => sample.at >= minTime)
  }, [offsetSamples, windowNowMs, visiblePastMs])

  const graphCenterMs = useMemo(() => {
    if (!freeModeActive || visibleGraphSamples.length === 0) {
      return 0
    }
    const sum = visibleGraphSamples.reduce((acc, sample) => acc + sample.valueMs, 0)
    return sum / visibleGraphSamples.length
  }, [freeModeActive, visibleGraphSamples])

  const yRangeMs = useMemo(() => {
    if (visibleGraphSamples.length === 0) {
      return 10
    }

    const peakAbs = visibleGraphSamples.reduce((peak, sample) => {
      const centeredValue = freeModeActive ? sample.valueMs - graphCenterMs : sample.valueMs
      return Math.max(peak, Math.abs(centeredValue))
    }, 0)

    const padded = peakAbs * 1.22
    return Math.max(10, Math.min(520, padded))
  }, [visibleGraphSamples, freeModeActive, graphCenterMs])

  const graphPoints = useMemo(() => {
    return visibleGraphSamples.map((sample) => {
      const ageMs = windowNowMs - sample.at
      const x = nowX - (ageMs / visiblePastMs) * graphUsableWidth
      const centeredValue = freeModeActive ? sample.valueMs - graphCenterMs : sample.valueMs
      const clampedOffset = Math.max(Math.min(centeredValue, yRangeMs), -yRangeMs)
      const y = zeroY + (clampedOffset / yRangeMs) * (graphUsableHeight / 2)
      return {
        x,
        y,
        source: sample.source,
        valueMs: sample.valueMs,
      }
    })
  }, [visibleGraphSamples, windowNowMs, nowX, visiblePastMs, graphUsableWidth, yRangeMs, zeroY, graphUsableHeight, freeModeActive, graphCenterMs])

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

    const maxCentered = freeModeActive ? maxOffset - graphCenterMs : maxOffset
    const minCentered = freeModeActive ? minOffset - graphCenterMs : minOffset
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
  }, [visibleGraphSamples, yRangeMs, zeroY, graphUsableHeight, freeModeActive, graphCenterMs])

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
      const midpointOffset = (from.valueMs + to.valueMs) / 2
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

  const createClickBuffer = (context: AudioContext, profile: SoundProfile) => {
    const durationSeconds =
      profile === 'pure-beep'
        ? 0.1
        : profile === 'muted-wood'
          ? 0.06
          : 0.12
    const length = Math.floor(context.sampleRate * durationSeconds)
    const buffer = context.createBuffer(1, length, context.sampleRate)
    const channel = buffer.getChannelData(0)

    if (profile === 'pure-beep') {
      const f = 700
      for (let i = 0; i < length; i += 1) {
        const t = i / context.sampleRate
        const attack = Math.min(1, i / (length * 0.1))
        const decay = Math.exp(-i / (length * 0.55))
        channel[i] = Math.sin(2 * Math.PI * f * t) * attack * decay * 0.26
      }
      return buffer
    }

    if (profile === 'muted-wood') {
      let seed = 1640531527
      for (let i = 0; i < length; i += 1) {
        seed ^= seed << 13
        seed ^= seed >>> 17
        seed ^= seed << 5
        const white = ((seed >>> 0) / 4294967295) * 2 - 1
        const previous = i > 0 ? channel[i - 1] : 0
        const lowPassed = previous * 0.8 + white * 0.2
        const envelope = Math.exp(-i / (length * 0.32))
        channel[i] = lowPassed * envelope * 0.32
      }
      return buffer
    }

    // Default soft pulse: single stable fundamental with very light harmonic content.
    const f1 = 720
    const f2 = 1440
    for (let i = 0; i < length; i += 1) {
      const t = i / context.sampleRate
      const attack = Math.min(1, i / (length * 0.12))
      const decay = Math.exp(-i / (length * 0.48))
      const envelope = attack * decay

      const tone = Math.sin(2 * Math.PI * f1 * t) * 0.9 + Math.sin(2 * Math.PI * f2 * t) * 0.1

      channel[i] = tone * envelope * 0.34
    }

    return buffer
  }

  const refreshOutputLatencyEstimate = () => {
    if (!audioContextRef.current) {
      setOutputLatencyMs(null)
      return
    }

    const context = audioContextRef.current
    const reportedOutput = 'outputLatency' in context ? context.outputLatency : 0
    const total = (context.baseLatency ?? 0) + (reportedOutput ?? 0)

    if (Number.isFinite(total) && total > 0) {
      setOutputLatencyMs(total * 1000)
    } else {
      setOutputLatencyMs(null)
    }
  }

  const shouldUseSinkRouting = (deviceId: string) => {
    return (
      !!deviceId &&
      deviceId !== 'default' &&
      deviceId !== 'communications' &&
      typeof outputAudioRef.current?.setSinkId === 'function'
    )
  }

  const applyRoutingTopology = (deviceId: string) => {
    if (!audioContextRef.current || !masterGainRef.current) {
      return
    }

    const master = masterGainRef.current
    try {
      master.disconnect()
    } catch {
      // Ignore if there is nothing connected yet.
    }

    if (shouldUseSinkRouting(deviceId) && metronomeOutputRef.current) {
      master.connect(metronomeOutputRef.current)
    } else {
      master.connect(audioContextRef.current.destination)
    }
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

    if (!masterGainRef.current) {
      const master = audioContextRef.current.createGain()
      master.gain.value = 1
      masterGainRef.current = master

      clickBufferRef.current = createClickBuffer(audioContextRef.current, soundProfile)

      const outputNode = audioContextRef.current.createMediaStreamDestination()
      master.connect(outputNode)
      metronomeOutputRef.current = outputNode

      const sinkAudio = new Audio()
      sinkAudio.autoplay = true
      sinkAudio.srcObject = outputNode.stream
      outputAudioRef.current = sinkAudio
      setSupportsOutputSelect(typeof sinkAudio.setSinkId === 'function')

      applyRoutingTopology(selectedOutputId)
    }

    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume()
    }

    if (outputAudioRef.current) {
      try {
        await outputAudioRef.current.play()
      } catch {
        // Some browsers require a direct user gesture to begin playback.
      }
    }

    refreshOutputLatencyEstimate()

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

      const outputs = devices
        .filter((device) => device.kind === 'audiooutput')
        .map((device, index) => ({
          id: device.deviceId,
          label: device.label || `Output ${index + 1}`,
        }))

      setInputDevices(inputs)
      setOutputDevices(outputs)

      if (!selectedInputId && inputs.length > 0) {
        setSelectedInputId(inputs[0].id)
      }
      if (!selectedOutputId && outputs.length > 0) {
        setSelectedOutputId(outputs[0].id)
      }
      if (selectedOutputId && !outputs.some((device) => device.id === selectedOutputId)) {
        setSelectedOutputId('')
      }
      setDeviceError(null)
    } catch {
      setDeviceError('Could not enumerate audio devices in this browser.')
    }
  }

  const applyOutputDevice = async (deviceId: string) => {
    if (!shouldUseSinkRouting(deviceId)) {
      sinkRoutingActiveRef.current = false
      applyRoutingTopology(deviceId)
      setDeviceError(null)
      return
    }

    if (!outputAudioRef.current || typeof outputAudioRef.current.setSinkId !== 'function') {
      sinkRoutingActiveRef.current = false
      applyRoutingTopology('')
      setDeviceError('Output device selection is not supported by this browser.')
      return
    }

    try {
      await outputAudioRef.current.setSinkId(deviceId)
      await outputAudioRef.current.play()
      sinkRoutingActiveRef.current = true
      applyRoutingTopology(deviceId)
      setDeviceError(null)
    } catch {
      sinkRoutingActiveRef.current = false
      applyRoutingTopology('')
      setDeviceError('Unable to switch output device. Check browser permissions.')
    }
  }

  const testOutputBeep = async () => {
    const context = await ensureAudioContext()
    const osc = context.createOscillator()
    const gain = context.createGain()

    osc.type = 'sine'
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.0001, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.22, context.currentTime + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18)

    osc.connect(gain)
    gain.connect(context.destination)
    osc.start(context.currentTime)
    osc.stop(context.currentTime + 0.2)

    setAudioTestMessage('Played test beep on current output path')
  }

  const playTick = (context: AudioContext, when: number, _accent: boolean) => {
    const source = context.createBufferSource()
    const gain = context.createGain()

    if (!clickBufferRef.current) {
      clickBufferRef.current = createClickBuffer(context, soundProfile)
    }
    source.buffer = clickBufferRef.current

    const basePeakGain = soundProfile === 'pure-beep' ? 0.34 : soundProfile === 'muted-wood' ? 0.3 : 0.28
    const peakGain = Math.min(basePeakGain * metronomeVolumeRef.current, 0.95)
    const attackSeconds = soundProfile === 'pure-beep' ? 0.01 : soundProfile === 'muted-wood' ? 0.007 : 0.012
    const releaseSeconds = soundProfile === 'pure-beep' ? 0.09 : soundProfile === 'muted-wood' ? 0.055 : 0.11
    const stopSeconds = soundProfile === 'pure-beep' ? 0.1 : soundProfile === 'muted-wood' ? 0.06 : 0.12

    gain.gain.setValueAtTime(0.0001, when)
    gain.gain.exponentialRampToValueAtTime(peakGain, when + attackSeconds)
    gain.gain.exponentialRampToValueAtTime(0.0001, when + releaseSeconds)

    source.connect(gain)
    if (sinkRoutingActiveRef.current && masterGainRef.current) {
      gain.connect(masterGainRef.current)
    } else {
      gain.connect(context.destination)
    }

    source.start(when)
    source.stop(when + stopSeconds)
  }

  useEffect(() => {
    if (!audioContextRef.current) {
      return
    }
    clickBufferRef.current = createClickBuffer(audioContextRef.current, soundProfile)
  }, [soundProfile])

  useEffect(() => {
    metronomeVolumeRef.current = metronomeVolume
  }, [metronomeVolume])

  const updateMetronomeMeasurement = (scheduledTickTime: number) => {
    const times = [...tickTimesRef.current, scheduledTickTime].slice(-MAX_TICK_TIMES)
    tickTimesRef.current = times
    setMeasuredTickCount(times.length)

    if (times.length < 4) {
      return
    }

    const intervals = times.slice(1).map((time, index) => time - times[index])
    const mean = intervals.reduce((acc, value) => acc + value, 0) / intervals.length
    const variance = intervals.reduce((acc, value) => acc + (value - mean) ** 2, 0) / intervals.length

    setMeasuredTempoBpm(60 / mean)
    setMeasuredJitterMs(Math.sqrt(variance) * 1000)
  }

  const randomBoundedJitterSeconds = () => {
    const jitterMs = (Math.random() * 2 - 1) * simJitterMs
    return jitterMs / 1000
  }

  const stopSimulation = () => {
    if (simTimeoutRef.current !== null) {
      window.clearTimeout(simTimeoutRef.current)
      simTimeoutRef.current = null
    }
    simBeatIndexRef.current = 0
  }

  const scheduleNextSimulatedBeat = () => {
    if (!audioContextRef.current || !metronomeEnabled || !testModeEnabled) {
      return
    }

    const context = audioContextRef.current
    const targetBeatTime = metronomeStartRef.current + simBeatIndexRef.current * beatInterval
    const jitterSeconds = randomBoundedJitterSeconds()
    const simulatedBeatTime = targetBeatTime + jitterSeconds
    const delayMs = Math.max((simulatedBeatTime - context.currentTime) * 1000, 0)

    simTimeoutRef.current = window.setTimeout(() => {
      if (!audioContextRef.current || !metronomeEnabled || !testModeEnabled) {
        return
      }
      registerBeat(simulatedBeatTime, 'sim')
      simBeatIndexRef.current += 1
      scheduleNextSimulatedBeat()
    }, delayMs)
  }

  const startSimulation = async () => {
    const context = await ensureAudioContext()
    if (!metronomeEnabled) {
      return
    }

    stopSimulation()
    // Start from the next metronome beat to keep simulation aligned with the clock.
    const nextBeat = Math.ceil((context.currentTime - metronomeStartRef.current) / beatInterval)
    simBeatIndexRef.current = Math.max(0, nextBeat)
    scheduleNextSimulatedBeat()
  }

  const stopMetronome = () => {
    if (metronomeTimerRef.current !== null) {
      window.clearInterval(metronomeTimerRef.current)
      metronomeTimerRef.current = null
    }
    beatIndexRef.current = 0
    stopSimulation()
    tickTimesRef.current = []
    setMeasuredTickCount(0)
  }

  const startMetronome = async () => {
    const context = await ensureAudioContext()
    stopMetronome()

    const now = context.currentTime
    nextTickTimeRef.current = now + 0.08
    metronomeStartRef.current = nextTickTimeRef.current
    beatIndexRef.current = 0
    tickTimesRef.current = []
    setMeasuredTempoBpm(0)
    setMeasuredJitterMs(0)
    setMeasuredTickCount(0)

    const lookAheadSeconds = 0.12
    const schedulePeriodMs = 20

    metronomeTimerRef.current = window.setInterval(() => {
      if (!audioContextRef.current) {
        return
      }

      while (nextTickTimeRef.current < audioContextRef.current.currentTime + lookAheadSeconds) {
        playTick(audioContextRef.current, nextTickTimeRef.current, false)
        updateMetronomeMeasurement(nextTickTimeRef.current)

        beatIndexRef.current += 1
        nextTickTimeRef.current += beatInterval
      }
    }, schedulePeriodMs)
  }

  const toggleMetronome = async () => {
    await ensureAudioContext()
    setMetronomeEnabled((active) => !active)
  }

  const stopListening = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }

    sourceRef.current?.disconnect()
    analyserRef.current?.disconnect()
    workletNodeRef.current?.disconnect()

    sourceRef.current = null
    analyserRef.current = null
    workletNodeRef.current = null

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }

    energyFloorRef.current = 0
    prevEnergyRef.current = 0
    lastDetectedBeatRef.current = 0
    displayedEnergyRef.current = 0
    setEnergy(0)
  }

  const resetFreeIntervalTracking = () => {
    lastFreeBeatRef.current = null
    setIntervalSamples([])
    setOffsetSamples([])
  }

  const registerBeat = (beatTimeSeconds: number, source: 'mic' | 'key' | 'sim') => {
    if (!audioContextRef.current) {
      return
    }

    if (!metronomeEnabled && freeModeActive) {
      if (lastFreeBeatRef.current !== null) {
        const intervalMs = (beatTimeSeconds - lastFreeBeatRef.current) * 1000
        if (intervalMs > 80 && intervalMs < 3000) {
          setIntervalSamples((samples) => [...samples, intervalMs].slice(-retainedBeatCount))
          setOffsetSamples((samples) => {
            const next = [...samples, { valueMs: intervalMs, at: performance.now(), source }]
            return next.slice(-retainedBeatCount)
          })
        }
      }
      lastFreeBeatRef.current = beatTimeSeconds
      setStatus('idle')
      setGraphNowMs(performance.now())
      return
    }

    if (!metronomeEnabled) {
      return
    }

    const beatNumber = Math.round((beatTimeSeconds - metronomeStartRef.current) / beatInterval)
    const nearestBeatTime = metronomeStartRef.current + beatNumber * beatInterval
    const offsetMs = (beatTimeSeconds - nearestBeatTime) * 1000

    setOffsetSamples((samples) => {
      const next = [...samples, { valueMs: offsetMs, at: performance.now(), source }]
      return next.slice(-retainedBeatCount)
    })
    setGraphNowMs(performance.now())
    setStatus(classifyStatus(offsetMs))
  }

  const captureCalibrationRms = async () => {
    const context = await ensureAudioContext()
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: selectedInputId ? { deviceId: { exact: selectedInputId } } : true,
    })
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
          sumSquares += data[i] * data[i]
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
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
      latency: 0,
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

  const classifyStatus = (offsetMs: number): Status => {
    const absMs = Math.abs(offsetMs)
    if (absMs < 20) {
      return 'on'
    }
    return offsetMs < 0 ? 'ahead' : 'behind'
  }

  const startListening = async () => {
    try {
      const context = await ensureAudioContext()
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: buildMicConstraints(detectionMode === 'precision'),
      })

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
            numberOfOutputs: 0,
            channelCount: 1,
          })

          source.connect(detectorNode)
          workletNodeRef.current = detectorNode

          detectorNode.port.postMessage({
            type: 'config',
            sensitivity: calibrationFactor,
            minGapSeconds: Math.max(0.14, beatInterval * 0.45),
          })

          detectorNode.port.onmessage = (event: MessageEvent) => {
            if (!audioContextRef.current) {
              return
            }

            if (event.data?.type === 'meter') {
              const rms = Number(event.data.rms) || 0
              const instantEnergy = Math.min(rms * 14, 1)
              const decayed = displayedEnergyRef.current * 0.9
              const nextDisplay = Math.max(instantEnergy, decayed)
              displayedEnergyRef.current = nextDisplay
              setEnergy(nextDisplay)
              return
            }

            if (event.data?.type !== 'onset') {
              return
            }

            if (!(metronomeEnabled || freeModeActive)) {
              return
            }

            const onsetTimeSeconds = Number(event.data.time)
            if (!Number.isFinite(onsetTimeSeconds)) {
              return
            }

            const minGap = Math.max(0.14, beatInterval * 0.45)
            if (onsetTimeSeconds - lastDetectedBeatRef.current <= minGap) {
              return
            }

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
        for (let i = 0; i < data.length; i += 1) {
          sumSquares += data[i] * data[i]
        }

        const rms = Math.sqrt(sumSquares / data.length)
        const floor = energyFloorRef.current * 0.96 + rms * 0.04
        energyFloorRef.current = floor

        const sensitivity = calibrationFactor
        const adaptiveThreshold = floor * sensitivity
        const slope = rms - prevEnergyRef.current
        prevEnergyRef.current = rms
        const instantEnergy = Math.min(rms * 14, 1)
        const decayed = displayedEnergyRef.current * 0.9
        const nextDisplay = Math.max(instantEnergy, decayed)
        displayedEnergyRef.current = nextDisplay
        setEnergy(nextDisplay)

        const now = audioContextRef.current.currentTime
        const minGap = Math.max(0.14, beatInterval * 0.45)

        if (
          (metronomeEnabled || freeModeActive) &&
          rms > adaptiveThreshold &&
          slope > 0.006 &&
          now - lastDetectedBeatRef.current > minGap
        ) {
          lastDetectedBeatRef.current = now

          registerBeat(now, 'mic')
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
  }, [timingMode])

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
    void ensureAudioContext().then(() => applyOutputDevice(selectedOutputId))
  }, [selectedOutputId, supportsOutputSelect])

  useEffect(() => {
    if (!metronomeEnabled) {
      refreshOutputLatencyEstimate()
      return
    }

    refreshOutputLatencyEstimate()
    const timer = window.setInterval(() => {
      refreshOutputLatencyEstimate()
    }, 1000)

    return () => {
      window.clearInterval(timer)
    }
  }, [metronomeEnabled, selectedOutputId])

  useEffect(() => {
    if (metronomeEnabled) {
      void startMetronome()
    } else {
      stopMetronome()
    }

    return () => {
      stopMetronome()
    }
  }, [metronomeEnabled, bpm])

  useEffect(() => {
    if (testModeEnabled && metronomeEnabled) {
      void startSimulation()
    } else {
      stopSimulation()
    }

    return () => {
      stopSimulation()
    }
  }, [testModeEnabled, metronomeEnabled, beatInterval, simJitterMs])

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
    metronomeEnabled,
    freeModeActive,
    beatInterval,
    calibrationFactor,
    selectedInputId,
    detectionMode,
  ])

  useEffect(() => {
    if (inputMode !== 'key') {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) {
        return
      }
      if (event.code !== 'Space' && event.code !== 'Enter' && event.code !== 'KeyF') {
        return
      }

      event.preventDefault()
      void ensureAudioContext().then((context) => {
        registerBeat(context.currentTime, 'key')
      })
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [inputMode, metronomeEnabled, freeModeActive, beatInterval])

  useEffect(() => {
    return () => {
      stopMetronome()
      stopListening()
      void audioContextRef.current?.close()
      audioContextRef.current = null
    }
  }, [])

  return (
    <main className="app-shell">
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
                  {freeModeActive
                    ? `max ${visibleExtremes.maxValue.toFixed(1)} ms (|Δ| ${visibleExtremes.maxDeltaFromCenter.toFixed(1)} ms, ${visibleExtremes.maxDeltaPct.toFixed(1)}%)`
                    : `max ${visibleExtremes.maxValue.toFixed(1)} ms`}
                </text>
                <text
                  x={GRAPH_WIDTH - GRAPH_PADDING_RIGHT - 6}
                  y={visibleExtremes.minY - 4}
                  className="graph-extreme-label graph-extreme-min-label"
                  textAnchor="end"
                >
                  {freeModeActive
                    ? `min ${visibleExtremes.minValue.toFixed(1)} ms (|Δ| ${visibleExtremes.minDeltaFromCenter.toFixed(1)} ms, ${visibleExtremes.minDeltaPct.toFixed(1)}%)`
                    : `min ${visibleExtremes.minValue.toFixed(1)} ms`}
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
              {freeModeActive ? `${(graphCenterMs + yRangeMs).toFixed(0)} ms` : `+${yRangeMs.toFixed(0)} ms`}
            </text>
            <text x={GRAPH_PADDING_LEFT - 10} y={zeroY + 4} className="graph-y-label" textAnchor="end">
              {freeModeActive
                ? `${graphCenterMs.toFixed(1)} ms (${(graphCenterMs > 0 ? 60000 / graphCenterMs : 0).toFixed(2)} BPM)`
                : '0 ms'}
            </text>
            <text
              x={GRAPH_PADDING_LEFT - 10}
              y={GRAPH_HEIGHT - GRAPH_PADDING_BOTTOM}
              className="graph-y-label"
              textAnchor="end"
            >
              {freeModeActive ? `${(graphCenterMs - yRangeMs).toFixed(0)} ms` : `-${yRangeMs.toFixed(0)} ms`}
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
                  style={{ fill: colorForOffset(point.valueMs) }}
                >
                  <title>
                    {`${point.source === 'mic' ? 'Mic' : point.source === 'key' ? 'Key' : 'Sim'} ${point.valueMs.toFixed(1)} ms`}
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
        <p className="lede">Calibrate your timing against a click and see if you are ahead or behind in real time.</p>

        <div className="control-grid">
          <label htmlFor="bpm">Tempo: {bpm} BPM</label>
          <input
            id="bpm"
            type="range"
            min={60}
            max={200}
            value={bpm}
            onChange={(event) => setBpm(Number(event.target.value))}
          />

          <label htmlFor="sound-profile">Metronome sound</label>
          <select
            id="sound-profile"
            value={soundProfile}
            onChange={(event) => setSoundProfile(event.target.value as SoundProfile)}
          >
            <option value="soft-pulse">Soft Pulse</option>
            <option value="muted-wood">Muted Wood</option>
            <option value="pure-beep">Pure Beep</option>
          </select>

          <label htmlFor="metronome-volume">Metronome volume: {(metronomeVolume * 100).toFixed(0)}%</label>
          <input
            id="metronome-volume"
            type="range"
            min={20}
            max={260}
            value={Math.round(metronomeVolume * 100)}
            onChange={(event) => setMetronomeVolume(Number(event.target.value) / 100)}
          />

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

          <label htmlFor="timing-mode">Timing mode</label>
          <select
            id="timing-mode"
            value={timingMode}
            onChange={(event) => setTimingMode(event.target.value as 'sync' | 'free')}
          >
            <option value="sync">Metronome Sync</option>
            <option value="free">Free Interval (no metronome)</option>
          </select>

          <label htmlFor="test-mode">Test mode</label>
          <select
            id="test-mode"
            value={testModeEnabled ? 'on' : 'off'}
            onChange={(event) => setTestModeEnabled(event.target.value === 'on')}
          >
            <option value="off">Off</option>
            <option value="on">Simulated Keyboard Input</option>
          </select>

          {testModeEnabled ? (
            <>
              <label htmlFor="sim-jitter">Simulation jitter: {simJitterMs} ms</label>
              <input
                id="sim-jitter"
                type="range"
                min={0}
                max={80}
                value={simJitterMs}
                onChange={(event) => setSimJitterMs(Number(event.target.value))}
              />
            </>
          ) : null}

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

          <label htmlFor="output-device">Output device</label>
          <select
            id="output-device"
            value={selectedOutputId}
            onChange={(event) => setSelectedOutputId(event.target.value)}
            disabled={outputDevices.length === 0}
          >
            <option value="">System Default</option>
            {outputDevices.length === 0 ? <option value="">No output devices found</option> : null}
            {outputDevices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.label}
              </option>
            ))}
          </select>

          <button type="button" onClick={() => void testOutputBeep()}>
            Test Output Beep
          </button>

          <button type="button" onClick={() => void refreshDevices()}>
            Refresh Devices
          </button>

          <button type="button" onClick={() => void toggleMetronome()}>
            {metronomeEnabled ? 'Stop Metronome' : 'Start Metronome'}
          </button>

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
        {audioTestMessage ? <p className="calibration-info">{audioTestMessage}</p> : null}

        <div className="status-row">
          <span className={`status-pill ${status}`}>{statusText}</span>
          {inputMode === 'mic' ? (
            <span className="subtle">Mic energy: {(energy * 100).toFixed(0)}%</span>
          ) : (
            <span className="subtle">Keyboard mode active</span>
          )}
        </div>
        {inputMode === 'mic' ? <p className="calibration-info">{calibrationInfo}</p> : null}
        <p className="calibration-info">{metronomeDiagnostic}</p>
        <p className="calibration-info">{outputLatencyDiagnostic}</p>
        {freeModeActive ? (
          <p className="calibration-info">
            {intervalStats
              ? `Free interval: last ${intervalStats.lastIntervalMs.toFixed(1)} ms | avg ${intervalStats.avgIntervalMs.toFixed(1)} ms | est ${intervalStats.bpmEstimate.toFixed(2)} BPM | std ${intervalStats.stdMs.toFixed(1)} ms | n=${intervalStats.count}`
              : 'Free interval: waiting for at least two beats...'}
          </p>
        ) : null}
        {testModeEnabled ? (
          <p className="calibration-info">
            {simStats
              ? `Sim test: target max jitter +/-${simJitterMs} ms | measured std ${simStats.std.toFixed(1)} ms | avg ${simStats.avg.toFixed(1)} ms | n=${simStats.count}`
              : 'Sim test: collecting simulated taps...'}
          </p>
        ) : null}
      </section>
    </main>
  )
}

export default App
