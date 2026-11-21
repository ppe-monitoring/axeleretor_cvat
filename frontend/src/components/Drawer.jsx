import { useEffect, useRef } from 'react'

/** Боковая панель на нативном <dialog>: фокус-ловушка и Esc работают из коробки. */
export default function Drawer({ open, title, onClose, children }) {
  const ref = useRef(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog ref={ref} onClose={onClose}
            className="fixed inset-y-0 right-0 m-0 h-full max-h-none w-full max-w-xl overflow-y-auto border-l border-line bg-surface p-0 text-ink backdrop:bg-black/40">
      <div className="sticky top-0 flex items-center justify-between border-b border-line bg-white px-5 py-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Закрыть"
                className="inline-flex size-11 items-center justify-center rounded-lg hover:bg-surface focus-visible:outline-2 focus-visible:outline-ink">
          <span aria-hidden="true">✕</span>
        </button>
      </div>
      {open && <div className="flex flex-col gap-4 p-5">{children}</div>}
    </dialog>
  )
}
