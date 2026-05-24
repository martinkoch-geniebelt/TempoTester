import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { DEFAULT_INTERVAL_MS, GRAPH_HISTORY_MS, MAX_INTERVAL_MS, MIN_INTERVAL_MS, OUTLIER_RATIO } from '../constants'
import { median } from '../utils'
import type { OffsetSample } from '../types'

export function useBeatEngine(
  audioContextRef: MutableRefObject<AudioContext | null>,
  ensureAudioContext: () => Promise<AudioContext>,
) {
  const [offsetSamples, setOffsetSamples] = useState<OffsetSample[]>([])
  const [intervalSamples, setIntervalSamples] = useState<number[]>([])
  const [detectedBeatCount, setDetectedBeatCount] = useState(0)
  const [emulatedBeatCount, setEmulatedBeatCount] = useState(0)
  const [rawIntervalMs, setRawIntervalMs] = useState<number | null>(null)
  const [acceptedIntervalMs, setAcceptedIntervalMs] = useState<number | null>(null)
  const [rejectedIntervalCount, setRejectedIntervalCount] = useState(0)
  const [targetBpmEnabled, setTargetBpmEnabled] = useState(false)
  const [targetBpm, setTargetBpm] = useState(120)
  const [emulationEnabled, setEmulationEnabled] = useState(false)
  const [emulationBpm, setEmulationBpm] = useState(120)
  const [emulationJitterMs, setEmulationJitterMs] = useState(0)

  const lastFreeBeatRef = useRef<number | null>(null)
  const emulationNextBeatRef = useRef(0)

  // Stale-closure-safe refs — kept in sync with state on every render
  const intervalSamplesRef = useRef<number[]>([])
  intervalSamplesRef.current = intervalSamples

  const targetBpmEnabledRef = useRef(targetBpmEnabled)
  targetBpmEnabledRef.current = targetBpmEnabled

  const targetBpmRef = useRef(targetBpm)
  targetBpmRef.current = targetBpm

  const retainedBeatCount = useMemo(() => {
    const windowMs = GRAPH_HISTORY_MS
    let estimatedIntervalMs = DEFAULT_INTERVAL_MS
    if (intervalSamples.length > 0) {
      estimatedIntervalMs = intervalSamples.reduce((acc, value) => acc + value, 0) / intervalSamples.length
    }
    const beatsInWindow = windowMs / Math.max(estimatedIntervalMs, 1)
    return Math.max(24, Math.ceil(beatsInWindow * 2))
  }, [intervalSamples])

  const retainedBeatCountRef = useRef(retainedBeatCount)
  retainedBeatCountRef.current = retainedBeatCount

  const intervalStats = useMemo(() => {
    if (intervalSamples.length === 0) {
      return null
    }
    const avgIntervalMs = intervalSamples.reduce((acc, value) => acc + value, 0) / intervalSamples.length
    const lastIntervalMs = intervalSamples[intervalSamples.length - 1]
    const variance =
      intervalSamples.reduce((acc, value) => acc + (value - avgIntervalMs) ** 2, 0) / intervalSamples.length
    const bpmEstimate = avgIntervalMs > 0 ? 60000 / avgIntervalMs : 0
    return { count: intervalSamples.length, avgIntervalMs, lastIntervalMs, stdMs: Math.sqrt(variance), bpmEstimate }
  }, [intervalSamples])

  // registerBeat is stable (deps: audioContextRef identity only).
  // It reads intervalSamples and retainedBeatCount via refs to avoid stale closures.
  const registerBeat = useCallback(
    (beatTimeSeconds: number, source: 'mic' | 'key' | 'emu') => {
      if (!audioContextRef.current) {
        return
      }

      if (source === 'mic') {
        setDetectedBeatCount((count) => count + 1)
      } else if (source === 'emu') {
        setEmulatedBeatCount((count) => count + 1)
      }

      const currentSamples = intervalSamplesRef.current
      const currentRetainedCount = retainedBeatCountRef.current

      if (lastFreeBeatRef.current !== null) {
        const rawMs = (beatTimeSeconds - lastFreeBeatRef.current) * 1000
        setRawIntervalMs(rawMs)

        if (rawMs >= MIN_INTERVAL_MS && rawMs <= MAX_INTERVAL_MS) {
          let shouldAccept = true
          const targetModeEnabled = targetBpmEnabledRef.current
          const targetIntervalMs = 60000 / Math.max(30, targetBpmRef.current)

          if (targetModeEnabled) {
            const errorRatio = Math.abs(rawMs - targetIntervalMs) / targetIntervalMs
            if (errorRatio > OUTLIER_RATIO) {
              setAcceptedIntervalMs(null)
              setRejectedIntervalCount((count) => count + 1)
              shouldAccept = false
            }
          } else if (currentSamples.length >= 4) {
            const recent = currentSamples.slice(-6)
            const baselineMs = median(recent)

            if (baselineMs > 0) {
              const errorRatio = Math.abs(rawMs - baselineMs) / baselineMs
              if (errorRatio > OUTLIER_RATIO) {
                // Reject sample but still advance anchor to avoid every-second-beat lock-in.
                setAcceptedIntervalMs(null)
                setRejectedIntervalCount((count) => count + 1)
                shouldAccept = false
              }
            }
          }

          if (shouldAccept) {
            setAcceptedIntervalMs(rawMs)
            setIntervalSamples((samples) => [...samples, rawMs].slice(-currentRetainedCount))
            setOffsetSamples((samples) => {
              const next = [...samples, { valueMs: rawMs, at: performance.now(), source }]
              return next.slice(-currentRetainedCount)
            })
          }
        } else {
          setAcceptedIntervalMs(null)
          setRejectedIntervalCount((count) => count + 1)
        }
      }

      lastFreeBeatRef.current = beatTimeSeconds
    },
    [audioContextRef],
  )

  const resetFreeIntervalTracking = useCallback(() => {
    lastFreeBeatRef.current = null
    setIntervalSamples([])
    setOffsetSamples([])
    setDetectedBeatCount(0)
    setEmulatedBeatCount(0)
    setRawIntervalMs(null)
    setAcceptedIntervalMs(null)
    setRejectedIntervalCount(0)
  }, [])

  const resetBeatCounters = useCallback(() => {
    setDetectedBeatCount(0)
    setEmulatedBeatCount(0)
    setRawIntervalMs(null)
    setAcceptedIntervalMs(null)
    setRejectedIntervalCount(0)
  }, [])

  // Trim stored samples when the window shrinks.
  useEffect(() => {
    setOffsetSamples((samples) => {
      if (samples.length <= retainedBeatCount) return samples
      return samples.slice(-retainedBeatCount)
    })
    setIntervalSamples((samples) => {
      if (samples.length <= retainedBeatCount) return samples
      return samples.slice(-retainedBeatCount)
    })
  }, [retainedBeatCount])

  // Emulation scheduling — runs inside the effect to avoid stale-closure issues with BPM changes.
  useEffect(() => {
    if (!emulationEnabled) return

    let timeoutId: number | null = null
    let cancelled = false

    const schedule = (context: AudioContext) => {
      if (cancelled) return
      const baseIntervalSeconds = 60 / Math.max(30, emulationBpm)
      const beatTime = emulationNextBeatRef.current
      const delayMs = Math.max((beatTime - context.currentTime) * 1000, 0)

      timeoutId = window.setTimeout(() => {
        if (cancelled || !audioContextRef.current) return
        const jitterSeconds = ((Math.random() * 2 - 1) * emulationJitterMs) / 1000
        const nextIntervalSeconds = Math.max(0.04, baseIntervalSeconds + jitterSeconds)
        registerBeat(beatTime, 'emu')
        emulationNextBeatRef.current = beatTime + nextIntervalSeconds
        schedule(audioContextRef.current)
      }, delayMs)
    }

    void ensureAudioContext().then((context) => {
      if (cancelled) return
      emulationNextBeatRef.current = context.currentTime + 0.12
      schedule(context)
    })

    return () => {
      cancelled = true
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [emulationEnabled, emulationBpm, emulationJitterMs, registerBeat, audioContextRef, ensureAudioContext])

  return {
    offsetSamples,
    intervalSamples,
    retainedBeatCount,
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
  }
}
