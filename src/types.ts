export type Status = 'idle'

export type OffsetSample = {
  valueMs: number
  at: number
  source: 'mic' | 'key' | 'emu'
  beatInBar: 1 | 2 | 3 | 4
}

export type DeviceOption = {
  id: string
  label: string
}
