import { useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { DETECTOR_MIN_GAP_SECONDS, STANDARD_NOISE_FLOOR_GATE } from '../constants'
import { requestMicStream } from '../audio/micUtils'

interface UseMicListeningParams {
  audioContextRef: MutableRefObject<AudioContext | null>
  ensureAudioContext: () => Promise<AudioContext>
  registerBeat: (beatTimeSeconds: number, source: 'mic' | 'key' | 'emu') => void
  refreshDevices: () => Promise<void>
  setPermissionError: (msg: string | null) => void
  setCalibrationInfo: (msg: string) => void
  setListening: (val: boolean) => void
}

export function useMicListening({
  audioContextRef,
  ensureAudioContext,
  registerBeat,
  refreshDevices,
  setPermissionError,
  setCalibrationInfo,
  setListening,
}: UseMicListeningParams) {
  const [energy, setEnergy] = useState(0)
  const [workletOnsetCount, setWorkletOnsetCount] = useState(0)

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
  const recentDetectedBeatEnergyPctRef = useRef<number[]>([])

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
    setWorkletOnsetCount(0)
  }

  const startListening = async (
    detectionMode: 'standard' | 'precision',
    calibrationFactor: number,
    selectedInputId: string,
  ) => {
    try {
      const context = await ensureAudioContext()
      const stream = await requestMicStream(detectionMode === 'precision', selectedInputId)

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
            if (!audioContextRef.current) return

            if (event.data?.type === 'meter') {
              const rms = Number(event.data.rms) || 0
              const instantEnergy = Math.min(rms * 24, 1)
              const decayed = displayedEnergyRef.current * 0.72
              const nextDisplay = Math.max(instantEnergy, decayed)
              displayedEnergyRef.current = nextDisplay
              setEnergy(nextDisplay)
              return
            }

            if (event.data?.type !== 'onset') return

            const onsetTimeSeconds = Number(event.data.time)
            if (!Number.isFinite(onsetTimeSeconds)) return

            setWorkletOnsetCount((count) => count + 1)
            lastDetectedBeatRef.current = onsetTimeSeconds

            // Record energy at beat time before calling registerBeat
            const energyNext = [...recentDetectedBeatEnergyPctRef.current, displayedEnergyRef.current * 100]
            recentDetectedBeatEnergyPctRef.current = energyNext.slice(-10)
            registerBeat(onsetTimeSeconds, 'mic')
          }

          return
        } catch {
          setCalibrationInfo('Precision detector unavailable, using standard detector')
        }
      }

      // Standard analyser-based detector
      const analyser = context.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0.7
      source.connect(analyser)
      analyserRef.current = analyser

      const data = new Float32Array(analyser.fftSize)

      const loop = () => {
        if (!audioContextRef.current || !analyserRef.current) return

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

        const adaptiveThreshold = floor * calibrationFactor
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
        const floorGate = Math.max(STANDARD_NOISE_FLOOR_GATE, floor * 2.2)
        const peakGate = Math.max(0.03, triggerThreshold * 6.5)

        if (
          rms > triggerThreshold &&
          rms > floorGate &&
          slope > 0.0023 &&
          peakAbs > peakGate &&
          estimatedOnsetTime - lastDetectedBeatRef.current > DETECTOR_MIN_GAP_SECONDS
        ) {
          lastDetectedBeatRef.current = estimatedOnsetTime
          // Record energy at beat time before calling registerBeat
          const energyNext = [...recentDetectedBeatEnergyPctRef.current, displayedEnergyRef.current * 100]
          recentDetectedBeatEnergyPctRef.current = energyNext.slice(-10)
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

  return {
    energy,
    workletOnsetCount,
    startListening,
    stopListening,
    recentDetectedBeatEnergyPctRef,
  }
}
