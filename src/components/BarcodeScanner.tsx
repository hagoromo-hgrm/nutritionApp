import { BarcodeFormat, BrowserCodeReader, BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { useEffect, useRef, useState } from 'react'
import {
  BARCODE_CAMERA_CONSTRAINTS,
  cameraAdvancedConstraints,
  preferredCameraZoom,
  type BarcodeCameraCapabilities,
  type CameraZoomRange,
} from '../services/barcodeCamera'
import { isValidBarcode } from '../utils/validation'

interface BarcodeScannerProps {
  onDetected: (barcode: string) => void
  onClose: () => void
}

export function BarcodeScanner({ onDetected, onClose }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const trackRef = useRef<MediaStreamTrack | null>(null)
  const [manualBarcode, setManualBarcode] = useState('')
  const [cameraMessage, setCameraMessage] = useState('カメラを起動しています…')
  const [zoomRange, setZoomRange] = useState<CameraZoomRange | null>(null)
  const [zoom, setZoom] = useState(1)
  const [torchAvailable, setTorchAvailable] = useState(false)
  const [torchOn, setTorchOn] = useState(false)

  useEffect(() => {
    let disposed = false
    const reader = new BrowserMultiFormatReader()
    reader.possibleFormats = [
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.ITF,
      BarcodeFormat.CODE_128,
    ]
    const stopCamera = () => {
      controlsRef.current?.stop()
      controlsRef.current = null
      trackRef.current = null
      BrowserCodeReader.releaseAllStreams()
      const video = videoRef.current
      const stream = video?.srcObject
      if (typeof MediaStream !== 'undefined' && stream instanceof MediaStream) {
        stream.getTracks().forEach((track) => track.stop())
      }
      if (video) {
        video.pause()
        video.srcObject = null
        video.removeAttribute('src')
      }
    }
    const configureCamera = async (controls: IScannerControls) => {
      const stream = videoRef.current?.srcObject
      if (typeof MediaStream === 'undefined' || !(stream instanceof MediaStream)) return
      const track = stream.getVideoTracks()[0]
      if (!track) return
      trackRef.current = track
      if (typeof track.getCapabilities !== 'function') return
      const capabilities = track.getCapabilities() as BarcodeCameraCapabilities

      if (capabilities.focusMode?.includes('continuous')) {
        try {
          await track.applyConstraints(cameraAdvancedConstraints({ focusMode: 'continuous' }))
        } catch {
          // 拡張制約はiOSの世代差が大きいため、失敗しても通常のAFで読み取りを続ける。
        }
      }
      if (capabilities.zoom && capabilities.zoom.max > capabilities.zoom.min) {
        const initialZoom = preferredCameraZoom(capabilities.zoom)
        try {
          await track.applyConstraints(cameraAdvancedConstraints({ zoom: initialZoom }))
          if (!disposed) {
            setZoomRange(capabilities.zoom)
            setZoom(initialZoom)
          }
        } catch {
          // 能力として公開されても適用できないSafariがあるため、操作UIは表示しない。
        }
      }
      if (!disposed && capabilities.torch && controls.switchTorch) setTorchAvailable(true)
    }
    const start = async () => {
      if (!window.isSecureContext && window.location.hostname !== 'localhost') {
        setCameraMessage('カメラはHTTPS環境で利用できます。番号を手入力してください。')
        return
      }
      if (!videoRef.current) return
      try {
        const controls = await reader.decodeFromConstraints(BARCODE_CAMERA_CONSTRAINTS, videoRef.current, (result) => {
          if (disposed || !result) return
          const value = result.getText().trim()
          if (!isValidBarcode(value)) {
            setCameraMessage('商品バーコード（8〜14桁の数字）を枠内に合わせてください。')
            return
          }
          stopCamera()
          onDetected(value)
        })
        if (disposed) {
          controls.stop()
          BrowserCodeReader.releaseAllStreams()
          return
        }
        controlsRef.current = controls
        setCameraMessage('バーコードを横長の枠内に合わせてください。')
        await configureCamera(controls)
      } catch {
        if (!disposed) setCameraMessage('カメラを利用できません。権限を確認して番号を手入力してください。')
      }
    }
    void start()
    return () => {
      disposed = true
      stopCamera()
    }
  }, [onDetected])

  const changeZoom = async (value: number) => {
    const track = trackRef.current
    if (!track) return
    setZoom(value)
    try {
      await track.applyConstraints(cameraAdvancedConstraints({ zoom: value }))
    } catch {
      setCameraMessage('この端末では倍率を変更できませんでした。読み取りはそのまま続けられます。')
    }
  }

  const toggleTorch = async () => {
    const next = !torchOn
    try {
      await controlsRef.current?.switchTorch?.(next)
      setTorchOn(next)
    } catch {
      setCameraMessage('ライトを切り替えられませんでした。読み取りはそのまま続けられます。')
    }
  }

  const submitManual = () => {
    const barcode = manualBarcode.trim()
    if (!isValidBarcode(barcode)) {
      setCameraMessage('バーコードは8〜14桁の数字で入力してください。')
      return
    }
    onDetected(barcode)
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="バーコードで追加">
      <section className="modal-card scanner-card">
        <div className="modal-heading">
          <div><span className="eyebrow">BARCODE</span><h2>バーコードで追加</h2></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">×</button>
        </div>
        <div className="scanner-preview">
          <video ref={videoRef} className="scanner-video" muted playsInline />
          <div className="scanner-guide" aria-hidden="true" />
        </div>
        {(zoomRange || torchAvailable) && <div className="scanner-camera-controls">
          {zoomRange && <label className="scanner-zoom">倍率 <input type="range" min={zoomRange.min} max={zoomRange.max} step={zoomRange.step || 0.1} value={zoom} onChange={(event) => void changeZoom(Number(event.target.value))} aria-label="カメラ倍率" /><strong>{zoom.toFixed(1)}×</strong></label>}
          {torchAvailable && <button className="button ghost scanner-torch" type="button" aria-pressed={torchOn} onClick={() => void toggleTorch()}>{torchOn ? 'ライトを消す' : 'ライトを点ける'}</button>}
        </div>}
        <p className="helper-text">{cameraMessage}</p>
        <p className="scanner-tip">端末を15〜25cmほど離し、バーコード全体が枠に入るようにしてください。</p>
        <div className="divider-label"><span>または番号を入力</span></div>
        <div className="inline-form">
          <input inputMode="numeric" value={manualBarcode} onChange={(event) => setManualBarcode(event.target.value)} placeholder="例: 4900000000000" aria-label="バーコード番号" />
          <button className="button primary" type="button" onClick={submitManual}>検索</button>
        </div>
        <button className="button ghost full-width" type="button" onClick={onClose}>キャンセル</button>
      </section>
    </div>
  )
}
