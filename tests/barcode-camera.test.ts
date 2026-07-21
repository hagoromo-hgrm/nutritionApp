import { describe, expect, it } from 'vitest'
import { BARCODE_CAMERA_CONSTRAINTS, cameraAdvancedConstraints, preferredCameraZoom } from '../src/services/barcodeCamera'

describe('barcode camera constraints', () => {
  it('背面カメラと読み取り向け解像度を優先する', () => {
    expect(BARCODE_CAMERA_CONSTRAINTS).toEqual({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    })
  })

  it('初期倍率を端末の範囲と刻みに合わせる', () => {
    expect(preferredCameraZoom({ min: 1, max: 6, step: 0.5 })).toBe(2)
    expect(preferredCameraZoom({ min: 2.5, max: 8, step: 0.5 })).toBe(2.5)
    expect(preferredCameraZoom({ min: 1, max: 1.6, step: 0.1 })).toBe(1.6)
  })

  it('拡張カメラ制約をadvancedとして構築する', () => {
    expect(cameraAdvancedConstraints({ zoom: 2, focusMode: 'continuous' })).toEqual({
      advanced: [{ zoom: 2, focusMode: 'continuous' }],
    })
  })
})
