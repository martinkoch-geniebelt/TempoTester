import { useMemo } from 'react'
import {
  GRAPH_HEIGHT,
  GRAPH_HISTORY_MS,
  GRAPH_PADDING_BOTTOM,
  GRAPH_PADDING_LEFT,
  GRAPH_PADDING_RIGHT,
  GRAPH_PADDING_TOP,
  GRAPH_WIDTH,
  NOW_ANCHOR_RATIO,
} from '../constants'
import { colorForOffset } from '../utils'
import type { OffsetSample } from '../types'

interface BeatGraphProps {
  offsetSamples: OffsetSample[]
  graphNowMs: number
  energy: number
  inputMode: 'mic' | 'key'
  keyFlashCount: number
}

const graphUsableWidth = GRAPH_WIDTH - GRAPH_PADDING_LEFT - GRAPH_PADDING_RIGHT
const graphUsableHeight = GRAPH_HEIGHT - GRAPH_PADDING_TOP - GRAPH_PADDING_BOTTOM
const zeroY = GRAPH_PADDING_TOP + graphUsableHeight / 2
const nowX = GRAPH_PADDING_LEFT + graphUsableWidth * NOW_ANCHOR_RATIO
const visiblePastMs = GRAPH_HISTORY_MS * NOW_ANCHOR_RATIO

const graphTitle = 'Beat Interval'
const graphAriaLabel = 'Beat interval graph over time'
const graphCaption = 'Y-axis shows beat interval duration.'

export function BeatGraph({ offsetSamples, graphNowMs, energy, inputMode, keyFlashCount }: BeatGraphProps) {
  const windowNowMs = useMemo(() => {
    const lastSampleAt = offsetSamples.length > 0 ? offsetSamples[offsetSamples.length - 1].at : 0
    return Math.max(graphNowMs, lastSampleAt)
  }, [graphNowMs, offsetSamples])

  const visibleGraphSamples = useMemo(() => {
    const minTime = windowNowMs - visiblePastMs
    return offsetSamples.filter((sample) => sample.at >= minTime)
  }, [offsetSamples, windowNowMs])

  const graphCenterMs = useMemo(() => {
    if (visibleGraphSamples.length === 0) return 0
    const sum = visibleGraphSamples.reduce((acc, sample) => acc + sample.valueMs, 0)
    return sum / visibleGraphSamples.length
  }, [visibleGraphSamples])

  const yRangeMs = useMemo(() => {
    if (visibleGraphSamples.length === 0) return 10
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
      return { x, y, source: sample.source, valueMs: sample.valueMs, centeredValueMs: centeredValue }
    })
  }, [visibleGraphSamples, windowNowMs, yRangeMs, graphCenterMs])

  const graphPolyline = useMemo(() => {
    return graphPoints.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ')
  }, [graphPoints])

  const visibleExtremes = useMemo(() => {
    if (visibleGraphSamples.length === 0) return null

    let maxOffset = -Infinity
    let minOffset = Infinity
    for (const sample of visibleGraphSamples) {
      if (sample.valueMs > maxOffset) maxOffset = sample.valueMs
      if (sample.valueMs < minOffset) minOffset = sample.valueMs
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
  }, [visibleGraphSamples, yRangeMs, graphCenterMs])

  const graphSegments = useMemo(() => {
    const segments: Array<{ x1: number; y1: number; x2: number; y2: number; color: string }> = []
    for (let i = 1; i < graphPoints.length; i += 1) {
      const from = graphPoints[i - 1]
      const to = graphPoints[i]
      const midpointOffset = (from.centeredValueMs + to.centeredValueMs) / 2
      segments.push({ x1: from.x, y1: from.y, x2: to.x, y2: to.y, color: colorForOffset(midpointOffset, yRangeMs) })
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
  }, [])

  return (
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

          {inputMode === 'key' && keyFlashCount > 0 ? (
            <circle
              key={keyFlashCount}
              cx={nowX}
              cy={zeroY}
              r={36}
              className="key-flash-ring"
            />
          ) : null}

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
                style={{ fill: colorForOffset(point.centeredValueMs, yRangeMs) }}
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
  )
}
