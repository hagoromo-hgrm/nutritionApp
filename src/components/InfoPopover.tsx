import { useEffect, useRef, useState } from 'react'

export function InfoPopover({ label, text, className = '' }: { label: string; text: string; className?: string }) {
  const [open, setOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const closeWhenOutside = (event: PointerEvent | FocusEvent) => {
      const target = event.target
      if (target instanceof Node && !popoverRef.current?.contains(target)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeWhenOutside)
    document.addEventListener('focusin', closeWhenOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeWhenOutside)
      document.removeEventListener('focusin', closeWhenOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return <div ref={popoverRef} className={`info-popover${className ? ` ${className}` : ''}`}><button type="button" className="info-button" aria-label={label} aria-expanded={open} onClick={() => setOpen((current) => !current)}>i</button>{open && <p role="tooltip">{text}</p>}</div>
}
