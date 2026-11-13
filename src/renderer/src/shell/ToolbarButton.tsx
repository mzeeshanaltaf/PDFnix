import type { LucideIcon } from 'lucide-react'
import { cn } from 'cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface ToolbarButtonProps extends Omit<
  React.ComponentProps<'button'>,
  'disabled' | 'children' | 'aria-label'
> {
  icon: LucideIcon
  label: string
  /** Shown in the tooltip, for example "Ctrl+O". */
  shortcut?: string
  /** Not available right now. The tooltip still explains what the button is. */
  disabled?: boolean
  /** Pressed state, for toggles and the selected tool. */
  active?: boolean
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left'
  /** Narrower, for a button that only opens a menu next to another button. */
  compact?: boolean
}

/**
 * An icon button for the toolbar and the side rail.
 *
 * Unavailable buttons use `aria-disabled` instead of `disabled` so they stay
 * focusable and keep their tooltip. Other props go to the button itself, so
 * it can be the trigger of a menu.
 */
export function ToolbarButton({
  icon: Icon,
  label,
  shortcut,
  disabled = false,
  active,
  onClick,
  tooltipSide = 'bottom',
  compact = false,
  className,
  ...props
}: ToolbarButtonProps): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          {...props}
          aria-label={label}
          aria-disabled={disabled || undefined}
          aria-pressed={active}
          onClick={disabled ? undefined : onClick}
          className={cn(
            'inline-flex h-8 shrink-0 items-center justify-center rounded-md outline-none',
            compact ? 'w-4' : 'w-8',
            'transition-colors focus-visible:ring-2 focus-visible:ring-ring/60',
            disabled
              ? 'text-muted-foreground/50'
              : 'text-foreground/80 hover:bg-accent hover:text-accent-foreground active:bg-accent/70 data-[state=open]:bg-accent',
            active &&
              !disabled &&
              'bg-primary/12 text-primary hover:bg-primary/16 hover:text-primary',
            className
          )}
        >
          <Icon
            className={compact ? 'size-3' : 'size-[18px]'}
            strokeWidth={compact ? 2 : 1.75}
            aria-hidden
          />
        </button>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide} sideOffset={6}>
        {label}
        {shortcut && <span className="ml-2 opacity-60">{shortcut}</span>}
      </TooltipContent>
    </Tooltip>
  )
}
