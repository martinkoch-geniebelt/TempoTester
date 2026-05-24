class OnsetDetectorProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.noiseFloor = 0
    this.prevRms = 0
    this.sensitivity = 2.5
    this.minGapSeconds = 0.14
    this.lastOnsetTime = -1

    this.port.onmessage = (event) => {
      if (event.data?.type !== 'config') {
        return
      }

      const sensitivity = Number(event.data.sensitivity)
      const minGapSeconds = Number(event.data.minGapSeconds)
      if (Number.isFinite(sensitivity)) {
        this.sensitivity = Math.max(1.2, Math.min(6, sensitivity))
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
    for (let i = 0; i < channel.length; i += 1) {
      const sample = channel[i]
      sumSquares += sample * sample
    }

    const rms = Math.sqrt(sumSquares / channel.length)
    this.noiseFloor = this.noiseFloor * 0.97 + rms * 0.03

    const slope = rms - this.prevRms
    this.prevRms = rms

    const threshold = this.noiseFloor * this.sensitivity
    const onsetTime = currentFrame / sampleRate

    if (rms > threshold && slope > 0.0055 && onsetTime - this.lastOnsetTime > this.minGapSeconds) {
      this.lastOnsetTime = onsetTime
      this.port.postMessage({ type: 'onset', time: onsetTime })
    }

    this.port.postMessage({ type: 'meter', rms })
    return true
  }
}

registerProcessor('onset-detector-processor', OnsetDetectorProcessor)
