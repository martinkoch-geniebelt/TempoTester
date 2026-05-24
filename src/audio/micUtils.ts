export const buildMicConstraints = (
  precision: boolean,
  selectedInputId: string,
): MediaTrackConstraints | boolean => {
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
  } as MediaTrackConstraints
}

export const requestMicStream = async (precision: boolean, selectedInputId: string): Promise<MediaStream> => {
  const primaryConstraints = buildMicConstraints(precision, selectedInputId)
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: primaryConstraints })
  } catch {
    // If selected device constraints fail (stale id / unsupported flags), fall back to default mic.
    const fallbackAudio: MediaTrackConstraints | boolean = precision
      ? {
          echoCancellation: { ideal: false },
          noiseSuppression: { ideal: false },
          autoGainControl: { ideal: false },
          channelCount: { ideal: 1 },
        } as MediaTrackConstraints
      : true
    return await navigator.mediaDevices.getUserMedia({ audio: fallbackAudio })
  }
}
