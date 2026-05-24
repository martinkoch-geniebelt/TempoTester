class OnsetDetectorProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.noiseFloor = 0
    this.prevRms = 0
    this.sensitivity = 1.8
    this.minGapSeconds = 0.09
    this.lastOnsetTime = -1

    this.port.onmessage = (event) => {
      if (event.data?.type !== 'config') {
        return
      }

      const sensitivity = Number(event.data.sensitivity)
      const minGapSeconds = Number(event.data.minGapSeconds)
      if (Number.isFinite(sensitivity)) {
        this.sensitivity = Math.max(1.0, Math.min(6, sensitivity))
      }
      if (Number.isFinite(minGapSeconds)) {
        this.minGapSeconds = Math.max(0.06, Math.min(1.5, minGapSeconds))
      }
    }
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) {
      return true
    }

    const channel = input[0]
    if (!channel || channel.length === 0) {
      return true
    }

    let sumSquares = 0
    let peakAbs = 0
    let peakIndex = 0
    for (let i = 0; i < channel.length; i += 1) {
      const sample = channel[i]
      sumSquares += sample * sample
      const abs = Math.abs(sample)
      if (abs > peakAbs) {
        peakAbs = abs
        peakIndex = i
      }
    }

    const rms = Math.sqrt(sumSquares / channel.length)
    this.noiseFloor = this.noiseFloor * 0.96 + rms * 0.04

    const slope = rms - this.prevRms
    this.prevRms = rms

    const threshold = this.noiseFloor * this.sensitivity
    const effectiveThreshold = Math.max(0.007, threshold)
    const blockStartTime = currentFrame / sampleRate
    const onsetTime = blockStartTime + peakIndex / sampleRate
    const strongLevel = effectiveThreshold * 1.2
    const peakLevel = effectiveThreshold * 6.2

    const gapOk = onsetTime - this.lastOnsetTime > this.minGapSeconds
    const triggered =
      (rms > effectiveThreshold && slope > 0.0018 && peakAbs > effectiveThreshold * 3.0) ||
      (rms > strongLevel && peakAbs > effectiveThreshold * 2.4) ||
      (peakAbs > peakLevel && slope > 0.0009)

    if (gapOk && triggered) {
      this.lastOnsetTime = onsetTime
      this.port.postMessage({ type: 'onset', time: onsetTime })
    }

    this.port.postMessage({ type: 'meter', rms })
    return true
  }
}

registerProcessor('onset-detector-processor', OnsetDetectorProcessor)
