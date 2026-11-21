import { useId } from 'react'

const base =
  'min-h-11 w-full rounded-lg border bg-white px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink'

function Wrap({ id, label, hint, error, children }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[13px] font-semibold">{label}</label>
      {children}
      {hint && <p id={`${id}-hint`} className="mt-1 text-[13px] text-muted">{hint}</p>}
      {error && <p id={`${id}-err`} role="alert" className="mt-1 text-[13px] text-risk-high-fg">{error}</p>}
    </div>
  )
}

export function TextField({ label, hint, error, ...props }) {
  const id = useId()
  return (
    <Wrap id={id} label={label} hint={hint} error={error}>
      <input id={id} aria-invalid={!!error} aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
             className={`${base} ${error ? 'border-risk-high-fg' : 'border-line'}`} {...props} />
    </Wrap>
  )
}

export function SelectField({ label, hint, error, children, ...props }) {
  const id = useId()
  return (
    <Wrap id={id} label={label} hint={hint} error={error}>
      <select id={id} className={`${base} ${error ? 'border-risk-high-fg' : 'border-line'}`} {...props}>{children}</select>
    </Wrap>
  )
}

export function CheckboxField({ label, ...props }) {
  return (
    <label className="flex min-h-11 items-center gap-2.5">
      <input type="checkbox" className="size-5 accent-ink" {...props} />
      {label}
    </label>
  )
}
