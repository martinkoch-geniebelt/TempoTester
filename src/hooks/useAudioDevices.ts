import { useEffect, useState } from 'react'
import type { DeviceOption } from '../types'

export function useAudioDevices() {
  const [inputDevices, setInputDevices] = useState<DeviceOption[]>([])
  const [selectedInputId, setSelectedInputId] = useState('')
  const [deviceError, setDeviceError] = useState<string | null>(null)

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

  useEffect(() => {
    void refreshDevices()

    const onDeviceChange = () => {
      void refreshDevices()
    }

    navigator.mediaDevices.addEventListener('devicechange', onDeviceChange)
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return { inputDevices, selectedInputId, setSelectedInputId, deviceError, refreshDevices }
}
