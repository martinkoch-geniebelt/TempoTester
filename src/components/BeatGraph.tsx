import { useMemo } from 'react'
import {
  BPM_HISTORY_MS,
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
import type { BpmSample, OffsetSample } from '../types'

interface BeatGraphProps {
  offsetSamples: OffsetSample[]
  bpmHistorySamples: BpmSample[]
  graphNowMs: number
  energy: number
  inputMode: 'mic' | 'key'
  keyFlashCount: number
  targetBpmEnabled: boolean
  targetBpm: number
}

const graphUsableWidth = GRAPH_WIDTH - GRAPH_PADDING_LEFT - GRAPH_PADDING_RIGHT
const graphUsableHeight = GRAPH_HEIGHT - GRAPH_PADDING_TOP - GRAPH_PADDING_BOTTOM
const zeroY = GRAPH_PADDING_TOP + graphUsableHeight / 2
const nowX = GRAPH_PADDING_LEFT + graphUsableWidth * NOW_ANCHOR_RATIO
const visiblePastMs = GRAPH_HISTORY_MS * NOW_ANCHOR_RATIO

const graphTitle = 'Beat Interval'
const graphAriaLabel = 'Beat interval graph over time'
const graphCaption = 'Y-axis shows beat interval duration.'
const bpmHistoryTitle = 'Historical BPM'
const bpmHistoryCaption = 'Smoothed tempo trend over the last 3 minutes.'

const bpmGraphHeight = 86
const bpmGraphPaddingLeft = 50
const bpmGraphPaddingRight = 20
const bpmGraphPaddingTop = 10
const bpmGraphPaddingBottom = 22
const bpmGraphUsableWidth = GRAPH_WIDTH - bpmGraphPaddingLeft - bpmGraphPaddingRight
const bpmGraphUsableHeight = bpmGraphHeight - bpmGraphPaddingTop - bpmGraphPaddingBottom

const formatBpmFromMs = (valueMs: number) => {
  if (valueMs <= 0) return '0.00'
  return (60000 / valueMs).toFixed(2)
}

export function BeatGraph({
  offsetSamples,
  bpmHistorySamples,
  graphNowMs,
  energy,
  inputMode,
  keyFlashCount,
  targetBpmEnabled,
  targetBpm,
}: BeatGraphProps) {
  const windowNowMs = useMemo(() => {
    const lastSampleAt = offsetSamples.length > 0 ? offsetSamples[offsetSamples.length - 1].at : 0
    return Math.max(graphNowMs, lastSampleAt)
  }, [graphNowMs, offsetSamples])

  const visibleGraphSamples = useMemo(() => {
    const minTime = windowNowMs - visiblePastMs
    return offsetSamples.filter((sample) => sample.at >= minTime)
  }, [offsetSamples, windowNowMs])

  const graphCenterMs = useMemo(() => {
    if (targetBpmEnabled) {
      return 60000 / Math.max(30, targetBpm)
    }
    if (visibleGraphSamples.length === 0) return 0
    const sum = visibleGraphSamples.reduce((acc, sample) => acc + sample.valueMs, 0)
    return sum / visibleGraphSamples.length
  }, [visibleGraphSamples, targetBpmEnabled, targetBpm])

  const keyOnWindowMs = Math.max(8, graphCenterMs * 0.025)

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
      const keyTimingState =
        sample.source === 'key' && graphCenterMs > 0
          ? centeredValue < -keyOnWindowMs
            ? 'ahead'
            : centeredValue > keyOnWindowMs
              ? 'behind'
              : 'on'
          : null
      return {
        x,
        y,
        source: sample.source,
        valueMs: sample.valueMs,
        centeredValueMs: centeredValue,
        beatInBar: sample.beatInBar,
        keyTimingState,
      }
    })
  }, [visibleGraphSamples, windowNowMs, yRangeMs, graphCenterMs, keyOnWindowMs])

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
    const visibleMaxValue = graphCenterMs + clampedMax
    const visibleMinValue = graphCenterMs + clampedMin
    const visibleMaxDelta = Math.abs(clampedMax)
    const visibleMinDelta = Math.abs(clampedMin)

    return {
      maxValue: visibleMaxValue,
      minValue: visibleMinValue,
      maxDeltaFromCenter: visibleMaxDelta,
      minDeltaFromCenter: visibleMinDelta,
      maxDeltaPct: graphCenterMs > 0 ? (visibleMaxDelta / graphCenterMs) * 100 : 0,
      minDeltaPct: graphCenterMs > 0 ? (visibleMinDelta / graphCenterMs) * 100 : 0,
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

  const visibleBpmSamples = useMemo(() => {
    const minTime = windowNowMs - BPM_HISTORY_MS
    return bpmHistorySamples.filter((sample) => sample.at >= minTime)
  }, [bpmHistorySamples, windowNowMs])

  const bpmRange = useMemo(() => {
    if (visibleBpmSamples.length === 0) {
      return { min: 80, max: 140 }
    }
    let min = Infinity
    let max = -Infinity
    for (const sample of visibleBpmSamples) {
      if (sample.bpm < min) min = sample.bpm
      if (sample.bpm > max) max = sample.bpm
    }
    const padding = Math.max(2.5, (max - min) * 0.22)
    return {
      min: Math.max(30, min - padding),
      max: Math.min(260, max + padding),
    }
  }, [visibleBpmSamples])

  const bpmPoints = useMemo(() => {
    if (visibleBpmSamples.length === 0) return []
    const range = Math.max(1, bpmRange.max - bpmRange.min)
    return visibleBpmSamples.map((sample) => {
      const ageMs = windowNowMs - sample.at
      const x = GRAPH_WIDTH - bpmGraphPaddingRight - (ageMs / BPM_HISTORY_MS) * bpmGraphUsableWidth
      const normalizedBpm = (sample.bpm - bpmRange.min) / range
      const y = bpmGraphPaddingTop + (1 - normalizedBpm) * bpmGraphUsableHeight
      return { x, y, bpm: sample.bpm }
    })
  }, [visibleBpmSamples, bpmRange, windowNowMs])

  const bpmPolyline = useMemo(() => {
    return bpmPoints.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ')
  }, [bpmPoints])

  const bpmGrid = useMemo(() => {
    const lines: Array<{ x: number; label: string }> = []
    for (let age = 0; age <= BPM_HISTORY_MS; age += 30000) {
      const x = GRAPH_WIDTH - bpmGraphPaddingRight - (age / BPM_HISTORY_MS) * bpmGraphUsableWidth
      if (x >= bpmGraphPaddingLeft) {
        lines.push({ x, label: age === 0 ? 'now' : `-${Math.round(age / 1000)}s` })
      }
    }
    return lines
  }, [])

  const bpmHorizontalGrid = useMemo(() => {
    const lines: Array<{ y: number; bpm: number }> = []
    const range = Math.max(1, bpmRange.max - bpmRange.min)
    for (let step = 1; step <= 3; step += 1) {
      const ratio = step / 4
      const bpm = bpmRange.max - range * ratio
      const y = bpmGraphPaddingTop + bpmGraphUsableHeight * ratio
      lines.push({ y, bpm })
    }
    return lines
  }, [bpmRange])

  const bpmExtremes = useMemo(() => {
    if (visibleBpmSamples.length === 0) {
      return null
    }
    let min = Infinity
    let max = -Infinity
    for (const sample of visibleBpmSamples) {
      if (sample.bpm < min) min = sample.bpm
      if (sample.bpm > max) max = sample.bpm
    }
    const range = Math.max(1, bpmRange.max - bpmRange.min)
    const maxY = bpmGraphPaddingTop + ((bpmRange.max - max) / range) * bpmGraphUsableHeight
    const minY = bpmGraphPaddingTop + ((bpmRange.max - min) / range) * bpmGraphUsableHeight
    return { max, min, maxY, minY }
  }, [visibleBpmSamples, bpmRange])

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
                {`max ${visibleExtremes.maxValue.toFixed(1)} ms (${formatBpmFromMs(visibleExtremes.maxValue)} BPM, |Δ| ${visibleExtremes.maxDeltaFromCenter.toFixed(1)} ms, ${visibleExtremes.maxDeltaPct.toFixed(1)}%)`}
              </text>
              <text
                x={GRAPH_WIDTH - GRAPH_PADDING_RIGHT - 6}
                y={visibleExtremes.minY - 4}
                className="graph-extreme-label graph-extreme-min-label"
                textAnchor="end"
              >
                {`min ${visibleExtremes.minValue.toFixed(1)} ms (${formatBpmFromMs(visibleExtremes.minValue)} BPM, |Δ| ${visibleExtremes.minDeltaFromCenter.toFixed(1)} ms, ${visibleExtremes.minDeltaPct.toFixed(1)}%)`}
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
            {`${graphCenterMs.toFixed(1)} ms (${(graphCenterMs > 0 ? 60000 / graphCenterMs : 0).toFixed(2)} BPM${targetBpmEnabled ? ' target' : ''})`}
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
              <g key={`${point.x}-${point.y}-${index}`}>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={4}
                  className={`graph-point graph-point-${point.source}${point.keyTimingState ? ` graph-point-key-${point.keyTimingState}` : ''}`}
                  style={{
                    fill:
                      point.keyTimingState === 'ahead'
                        ? '#59b3ff'
                        : point.keyTimingState === 'on'
                          ? '#5de19d'
                          : point.keyTimingState === 'behind'
                            ? '#ff8768'
                            : colorForOffset(point.centeredValueMs, yRangeMs),
                  }}
                >
                  <title>
                    {`${point.source === 'mic' ? 'Mic' : point.source === 'key' ? 'Key' : 'Emu'} ${point.valueMs.toFixed(1)} ms${point.keyTimingState ? ` (${point.keyTimingState})` : ''}`}
                  </title>
                </circle>
                <text x={point.x} y={point.y - 8} textAnchor="middle" className="graph-beat-index">
                  {point.beatInBar}
                </text>
              </g>
            ))}
          </g>
        </svg>
        <div className="graph-caption">{graphCaption}</div>
        <div className="graph-legend" aria-label="Key timing legend">
          <span className="graph-legend-item">
            <span className="graph-legend-dot graph-legend-ahead" aria-hidden="true" /> Ahead
          </span>
          <span className="graph-legend-item">
            <span className="graph-legend-dot graph-legend-on" aria-hidden="true" /> On
          </span>
          <span className="graph-legend-item">
            <span className="graph-legend-dot graph-legend-behind" aria-hidden="true" /> Behind
          </span>
        </div>
      </div>

      <div className="bpm-history-wrap" role="img" aria-label="Historical BPM graph">
        <div className="bpm-history-head">
          <h3>{bpmHistoryTitle}</h3>
          {bpmPoints.length > 0 ? (
            <span className="bpm-history-latest">Latest {bpmPoints[bpmPoints.length - 1].bpm.toFixed(2)} BPM</span>
          ) : (
            <span className="bpm-history-latest">Waiting for BPM samples...</span>
          )}
        </div>
        <svg className="bpm-history-graph" viewBox={`0 0 ${GRAPH_WIDTH} ${bpmGraphHeight}`}>
          <rect
            x={bpmGraphPaddingLeft}
            y={bpmGraphPaddingTop}
            width={bpmGraphUsableWidth}
            height={bpmGraphUsableHeight}
            className="bpm-history-plot"
          />

          {bpmHorizontalGrid.map((line, index) => (
            <g key={`${line.y}-${index}`}>
              <line
                x1={bpmGraphPaddingLeft}
                y1={line.y}
                x2={GRAPH_WIDTH - bpmGraphPaddingRight}
                y2={line.y}
                className="bpm-history-horizontal-line"
              />
              <text
                x={bpmGraphPaddingLeft - 8}
                y={line.y + 3}
                className="bpm-history-grid-label"
                textAnchor="end"
              >
                {line.bpm.toFixed(1)}
              </text>
            </g>
          ))}

          {bpmGrid.map((line) => (
            <g key={line.label}>
              <line
                x1={line.x}
                y1={bpmGraphPaddingTop}
                x2={line.x}
                y2={bpmGraphHeight - bpmGraphPaddingBottom}
                className="bpm-history-time-line"
              />
              <text x={line.x} y={bpmGraphHeight - 6} className="bpm-history-time-label" textAnchor="middle">
                {line.label}
              </text>
            </g>
          ))}

          <text
            x={bpmGraphPaddingLeft - 8}
            y={bpmGraphPaddingTop + 10}
            className="bpm-history-y-label"
            textAnchor="end"
          >
            {`${bpmRange.max.toFixed(1)} bpm`}
          </text>
          <text
            x={bpmGraphPaddingLeft - 8}
            y={bpmGraphHeight - bpmGraphPaddingBottom + 2}
            className="bpm-history-y-label"
            textAnchor="end"
          >
            {`${bpmRange.min.toFixed(1)} bpm`}
          </text>

          {bpmExtremes ? (
            <>
              <line
                x1={bpmGraphPaddingLeft}
                y1={bpmExtremes.maxY}
                x2={GRAPH_WIDTH - bpmGraphPaddingRight}
                y2={bpmExtremes.maxY}
                className="bpm-history-extreme-line bpm-history-extreme-max"
              />
              <line
                x1={bpmGraphPaddingLeft}
                y1={bpmExtremes.minY}
                x2={GRAPH_WIDTH - bpmGraphPaddingRight}
                y2={bpmExtremes.minY}
                className="bpm-history-extreme-line bpm-history-extreme-min"
              />
              <text
                x={GRAPH_WIDTH - bpmGraphPaddingRight - 6}
                y={bpmExtremes.maxY - 3}
                className="bpm-history-extreme-label bpm-history-extreme-max-label"
                textAnchor="end"
              >
                {`max ${bpmExtremes.max.toFixed(2)} bpm`}
              </text>
              <text
                x={GRAPH_WIDTH - bpmGraphPaddingRight - 6}
                y={bpmExtremes.minY - 3}
                className="bpm-history-extreme-label bpm-history-extreme-min-label"
                textAnchor="end"
              >
                {`min ${bpmExtremes.min.toFixed(2)} bpm`}
              </text>
            </>
          ) : null}

          {bpmPolyline ? <polyline className="bpm-history-trace" points={bpmPolyline} /> : null}
        </svg>
        <div className="bpm-history-caption">{bpmHistoryCaption}</div>
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
