export type Status = 'idle'

export type OffsetSample = {
  valueMs: number
  at: number
  source: 'mic' | 'key' | 'emu'
}

export type DeviceOption = {
  id: string
  label: string
}
