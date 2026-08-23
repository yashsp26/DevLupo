import { type ComponentPropsWithoutRef, useId } from 'react'
import { cn } from '../../utils/cn'

type TextareaProps = Omit<ComponentPropsWithoutRef<'textarea'>, 'id'> & {
  error?: string
  id?: string
  label: string
  labelClassName?: string
}

export function Textarea({ className, error, id, label, labelClassName, ...props }: TextareaProps) {
  const generatedId = useId()
  const textareaId = id ?? generatedId
  const errorId = `${textareaId}-error`

  return (
    <label className="grid gap-2 text-sm font-medium text-text" htmlFor={textareaId}>
      <span className={labelClassName}>{label}</span>
      <textarea
        aria-describedby={error ? errorId : undefined}
        aria-invalid={Boolean(error)}
        className={cn(
          'neu-inset min-h-20 resize-y rounded-xl border border-transparent bg-[var(--color-surface-input)] px-3 py-2 text-sm text-text outline-none transition-[box-shadow,background-color] placeholder:text-muted/65 focus:border-primary focus:ring-2 focus:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-55',
          error ? 'border-danger focus:ring-danger/20' : '',
          className,
        )}
        id={textareaId}
        {...props}
      />
      {error && (
        <span className="text-sm font-normal text-danger" id={errorId}>
          {error}
        </span>
      )}
    </label>
  )
}
