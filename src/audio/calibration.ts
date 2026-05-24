import { requestMicStream } from './micUtils'

export const captureCalibrationRms = async (
  audioContext: AudioContext,
  selectedInputId: string,
): Promise<number[]> => {
  const stream = await requestMicStream(false, selectedInputId)
  const source = audioContext.createMediaStreamSource(stream)
  const analyser = audioContext.createAnalyser()
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
