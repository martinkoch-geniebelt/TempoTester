import { useCallback, useRef } from 'react'

export function useAudioContext() {
  const audioContextRef = useRef<AudioContext | null>(null)

  const ensureAudioContext = useCallback(async (): Promise<AudioContext> => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext()
    }
    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume()
    }
    return audioContextRef.current
  }, [])

  return { audioContextRef, ensureAudioContext }
}
