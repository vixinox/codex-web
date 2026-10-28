import { useEffect, useRef, useState } from 'react'
import { BrowserQRCodeReader } from '@zxing/browser'
import { Camera, ImageUp, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { LoginQrPayload } from './owner-management-model'

export function parseLoginQrPayload(raw: string): LoginQrPayload {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error('This is not a valid Owner login QR.')
  }
  if (!value || typeof value !== 'object') throw new Error('This is not an Owner login QR.')
  const payload = value as Record<string, unknown>
  const allowedKeys = new Set([
    'version',
    'relayUrl',
    'ownerCode',
    'nodeId',
    'trustEpoch',
    'ownerPublicKey',
    'ownerPublicKeyFingerprint',
    'capability',
  ])
  let relay: URL | null = null
  try {
    relay = new URL(String(payload.relayUrl))
  } catch {
    relay = null
  }
  if (
    Object.keys(payload).some((key) => !allowedKeys.has(key)) ||
    payload.version !== 1 ||
    typeof payload.relayUrl !== 'string' ||
    !relay ||
    !['wss:', 'ws:'].includes(relay.protocol) ||
    !/^\d{9}$/u.test(String(payload.ownerCode)) ||
    typeof payload.nodeId !== 'string' ||
    payload.nodeId.length === 0 ||
    !Number.isSafeInteger(payload.trustEpoch) ||
    typeof payload.ownerPublicKey !== 'string' ||
    !/^[A-Za-z0-9_-]{16}$/u.test(String(payload.ownerPublicKeyFingerprint)) ||
    typeof payload.capability !== 'string' ||
    payload.capability.length < 32 ||
    payload.capability.length > 256
  )
    throw new Error('This is not a supported Owner login QR.')
  return payload as LoginQrPayload
}

async function decodeImage(file: File) {
  const reader = new BrowserQRCodeReader()
  const url = URL.createObjectURL(file)
  try {
    const result = await reader.decodeFromImageUrl(url).catch(() => null)
    if (!result?.getText()) throw new Error('No QR code was found in this image.')
    return parseLoginQrPayload(result.getText())
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function LoginQrScanner({
  onRedeem,
  onClose,
}: {
  onRedeem: (payload: LoginQrPayload) => Promise<void>
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const controlsRef = useRef<{ stop(): void } | null>(null)
  const [mode, setMode] = useState<'choose' | 'camera' | 'upload'>('choose')
  const [scanning, setScanning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const start = async () => {
      if (mode !== 'camera' || !navigator.mediaDevices?.getUserMedia) return
      try {
        streamRef.current = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        })
        if (!active) return
        if (videoRef.current) videoRef.current.srcObject = streamRef.current
        const reader = new BrowserQRCodeReader()
        controlsRef.current = await reader.decodeFromVideoElement(videoRef.current!, (result) => {
          if (!active || !result) return
          try {
            const payload = parseLoginQrPayload(result.getText())
            active = false
            controlsRef.current?.stop()
            streamRef.current?.getTracks().forEach((track) => track.stop())
            setScanning(false)
            void redeem(payload)
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Invalid Owner login QR.')
            setMode('choose')
          }
        })
        setScanning(true)
      } catch {
        streamRef.current?.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        if (active) {
          setScanning(false)
          setError('Camera access is unavailable. Choose a QR image instead.')
        }
      }
    }
    void start()
    return () => {
      active = false
      controlsRef.current?.stop()
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [mode])

  const redeem = async (payload: LoginQrPayload) => {
    setBusy(true)
    setError(null)
    try {
      await onRedeem(payload)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Login QR could not be redeemed.')
    } finally {
      setBusy(false)
    }
  }

  const upload = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    setBusy(true)
    try {
      await redeem(await decodeImage(file))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to read this QR image.')
    } finally {
      setBusy(false)
    }
  }

  const onDialogClose = () => {
    controlsRef.current?.stop()
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-qr-title"
        className="w-full max-w-md space-y-4 rounded-md border bg-background p-5 text-foreground shadow-xl"
      >
        <header className="flex items-center justify-between gap-3">
          <h2 id="login-qr-title" className="text-base font-semibold">
            One-time Owner login
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close QR scanner"
            onClick={onDialogClose}
          >
            <X className="size-4" />
          </Button>
        </header>
        <p className="text-sm text-muted-foreground">
          Scanning a valid QR signs in to the Owner that issued it. The QR expires after five
          minutes.
        </p>
        {mode === 'choose' ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setMode('camera')}>
              <Camera className="size-4" /> Open camera
            </Button>
            <Button type="button" variant="outline" onClick={() => setMode('upload')}>
              <ImageUp className="size-4" /> Upload image
            </Button>
          </div>
        ) : null}
        {mode === 'camera' ? (
          <div className="space-y-2">
            <video
              ref={videoRef}
              muted
              playsInline
              className="aspect-video w-full bg-black object-cover"
            />
            <p className="text-xs text-muted-foreground" role="status">
              {scanning ? 'Camera ready' : 'Starting camera'}
            </p>
            <Button type="button" variant="outline" onClick={() => setMode('choose')}>
              Choose another method
            </Button>
          </div>
        ) : null}
        {mode === 'upload' ? (
          <div className="space-y-2">
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
              <ImageUp className="size-4" /> Select QR image
              <Input
                className="sr-only"
                type="file"
                accept="image/*"
                disabled={busy}
                onChange={(event) => void upload(event.target.files?.[0])}
              />
            </label>
            <Button type="button" variant="outline" onClick={() => setMode('choose')}>
              Choose another method
            </Button>
          </div>
        ) : null}
        {busy ? <Camera className="size-4 animate-pulse" aria-label="Reading QR" /> : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  )
}
