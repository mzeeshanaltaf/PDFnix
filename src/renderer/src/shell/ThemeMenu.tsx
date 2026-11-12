import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react'
import { isThemeSource, type ThemeSource } from '../../../shared/api'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useSettings } from '@/state/settings'

const OPTIONS: { value: ThemeSource; label: string; icon: LucideIcon }[] = [
  { value: 'system', label: 'Follow system', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon }
]

export function ThemeMenu(): React.JSX.Element {
  const theme = useSettings((state) => state.theme)
  const setTheme = useSettings((state) => state.setTheme)
  const Current = OPTIONS.find((option) => option.value === theme)?.icon ?? Monitor

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Theme"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-foreground/80 outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/60 data-[state=open]:bg-accent"
            >
              <Current className="size-[18px]" strokeWidth={1.75} aria-hidden />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          Theme
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => {
            if (isThemeSource(value)) void setTheme(value)
          }}
        >
          {OPTIONS.map(({ value, label, icon: Icon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon className="size-4" aria-hidden />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
