import { BrowserCodeReader, BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { useEffect, useRef, useState } from 'react'
import { isValidBarcode } from '../utils/validation'

interface BarcodeScannerProps {
  onDetected: (barcode: string) => void
  onClose: () => void
}

export function BarcodeScanner({ onDetected, onClose }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const [manualBarcode, setManualBarcode] = useState('')
  const [cameraMessage, setCameraMessage] = useState('カメラを起動しています…')

  useEffect(() => {
    let disposed = false
    const reader = new BrowserMultiFormatReader()
    const stopCamera = () => {
      controlsRef.current?.stop()
      controlsRef.current = null
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
    const start = async () => {
      if (!window.isSecureContext && window.location.hostname !== 'localhost') {
        setCameraMessage('カメラはHTTPS環境で利用できます。番号を手入力してください。')
        return
      }
      if (!videoRef.current) return
      try {
        const controls = await reader.decodeFromVideoDevice(undefined, videoRef.current, (result) => {
          if (!disposed && result) {
            stopCamera()
            onDetected(result.getText())
          }
        })
        if (disposed) {
          controls.stop()
          BrowserCodeReader.releaseAllStreams()
          return
        }
        controlsRef.current = controls
        if (!disposed) setCameraMessage('バーコードを枠内に合わせてください。')
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
        <video ref={videoRef} className="scanner-video" muted playsInline />
        <p className="helper-text">{cameraMessage}</p>
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
