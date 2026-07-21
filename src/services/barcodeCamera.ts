export interface CameraZoomRange {
  min: number
  max: number
  step?: number
}

export type BarcodeCameraCapabilities = MediaTrackCapabilities & {
  zoom?: CameraZoomRange
  focusMode?: string[]
  torch?: boolean
}

export type BarcodeCameraConstraintSet = MediaTrackConstraintSet & {
  zoom?: number
  focusMode?: string
  torch?: boolean
}

export const BARCODE_CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
}

export function preferredCameraZoom(range: CameraZoomRange, preferred = 2): number {
  const clamped = Math.min(range.max, Math.max(range.min, preferred))
  if (!range.step || range.step <= 0) return clamped
  const stepped = range.min + Math.round((clamped - range.min) / range.step) * range.step
  return Number(Math.min(range.max, Math.max(range.min, stepped)).toFixed(4))
}

export function cameraAdvancedConstraints(values: BarcodeCameraConstraintSet): MediaTrackConstraints {
  return { advanced: [values] } as MediaTrackConstraints
}
