import { useTheme } from '@/components/shared/theme-provider'
import { Monitor, Moon, Sun } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { RegisteredTheme, ThemeMode, ThemeVariant } from '@/lib/theme/theme'
import { cn } from '@/lib/utils'

export function AppearanceSection() {
  const { darkThemeId, lightThemeId, mode, setMode, setThemeForVariant, themes } = useTheme()
  const lightThemes = themes.filter((theme) => theme.source.variant === 'light')
  const darkThemes = themes.filter((theme) => theme.source.variant === 'dark')

  return (
    <section className="flex flex-col gap-8" aria-labelledby="appearance-heading">
      <h1 id="appearance-heading" className="text-xl">
        Appearance
      </h1>
      <ThemeModeCards mode={mode} onModeChange={setMode} />
      <div className="grid gap-3 sm:grid-cols-2">
        <ThemeField
          label="Light theme"
          themeId={lightThemeId}
          themes={lightThemes}
          variant="light"
          onThemeChange={setThemeForVariant}
        />
        <ThemeField
          label="Dark theme"
          themeId={darkThemeId}
          themes={darkThemes}
          variant="dark"
          onThemeChange={setThemeForVariant}
        />
      </div>
    </section>
  )
}

const THEME_MODES: readonly {
  mode: ThemeMode
  label: string
  description: string
  Icon: typeof Sun
}[] = [
  { mode: 'system', label: 'System', description: 'Follow your device', Icon: Monitor },
  { mode: 'light', label: 'Light', description: 'Bright and focused', Icon: Sun },
  { mode: 'dark', label: 'Dark', description: 'Easy on the eyes', Icon: Moon },
]

function ThemeModeCards({
  mode,
  onModeChange,
}: {
  mode: ThemeMode
  onModeChange: (mode: ThemeMode) => void
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Color mode">
      {THEME_MODES.map((item) => (
        <ThemeModeCard
          key={item.mode}
          {...item}
          selected={mode === item.mode}
          onSelect={() => onModeChange(item.mode)}
        />
      ))}
    </div>
  )
}

function ThemeModeCard({
  mode,
  label,
  description,
  Icon,
  selected,
  onSelect,
}: (typeof THEME_MODES)[number] & { selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={`${label}: ${description}`}
      className={cn(
        'app-interactive flex min-h-44 flex-col gap-3 rounded-xl border border-border bg-card p-3 text-left text-card-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
        selected && 'border-primary ring-2 ring-primary/25',
      )}
      onClick={onSelect}
    >
      <ThemeModePreview mode={mode} />
      <span className="flex items-center gap-2">
        <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
        <span className="min-w-0">
          <span className="block text-sm font-medium">{label}</span>
          <span className="block truncate text-xs text-muted-foreground">{description}</span>
        </span>
      </span>
    </button>
  )
}

function ThemeModePreview({ mode }: { mode: ThemeMode }) {
  if (mode === 'system') {
    return (
      <span className="grid h-24 grid-cols-2 overflow-hidden rounded-lg border border-border bg-white">
        <span className="flex flex-col gap-2 bg-white p-2">
          <span className="h-2 w-10 rounded-full bg-zinc-900/20" />
          <span className="h-8 rounded-md border border-zinc-200 bg-zinc-100" />
          <span className="h-2 w-7 rounded-full bg-zinc-900/15" />
        </span>
        <span className="flex flex-col gap-2 bg-zinc-950 p-2">
          <span className="h-2 w-10 rounded-full bg-white/30" />
          <span className="h-8 rounded-md border border-white/20 bg-white/10" />
          <span className="h-2 w-7 rounded-full bg-white/25" />
        </span>
      </span>
    )
  }

  const isDark = mode === 'dark'
  return (
    <span
      className={cn(
        'flex h-24 flex-col gap-2 rounded-lg border p-2',
        isDark ? 'border-zinc-800 bg-zinc-950' : 'border-zinc-200 bg-white',
      )}
    >
      <span className={cn('h-2 w-12 rounded-full', isDark ? 'bg-white/35' : 'bg-zinc-900/20')} />
      <span
        className={cn(
          'flex-1 rounded-md border',
          isDark ? 'border-white/20 bg-white/10' : 'border-zinc-200 bg-zinc-100',
        )}
      >
        <span
          className={cn(
            'mt-2 ml-2 block h-2 w-8 rounded-full',
            isDark ? 'bg-white/30' : 'bg-zinc-900/15',
          )}
        />
      </span>
      <span className={cn('h-2 w-8 rounded-full', isDark ? 'bg-white/25' : 'bg-zinc-900/15')} />
    </span>
  )
}

function ThemeField({
  label,
  themeId,
  themes,
  variant,
  onThemeChange,
}: {
  label: string
  themeId: string
  themes: readonly RegisteredTheme[]
  variant: ThemeVariant
  onThemeChange: (variant: ThemeVariant, themeId: string) => void
}) {
  const selectedTheme = themes.find((theme) => theme.id === themeId) ?? themes[0]
  const fieldId = `theme-${variant}`
  const labelId = `${fieldId}-label`

  return (
    <div className="flex min-h-16 items-center gap-3 rounded-lg border border-border p-3">
      <label
        id={labelId}
        htmlFor={fieldId}
        className="flex items-center gap-1.5 text-sm font-medium"
      >
        {label}
      </label>

      <ThemeSwatch theme={selectedTheme} />

      <Select
        value={themeId}
        onValueChange={(value) => {
          if (value !== null) onThemeChange(variant, value)
        }}
      >
        <SelectTrigger
          id={fieldId}
          aria-labelledby={labelId}
          className="h-9 min-w-0 flex-1 rounded-lg px-2"
        >
          <SelectValue>{selectedTheme.name}</SelectValue>
        </SelectTrigger>
        <SelectContent
          side="bottom"
          align="start"
          alignItemWithTrigger={false}
          className="max-h-96 [scrollbar-color:var(--app-border-strong)_transparent] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-app-border-strong [&::-webkit-scrollbar-track]:bg-transparent"
        >
          <SelectGroup>
            {themes.map((theme) => (
              <SelectItem
                key={theme.id}
                value={theme.id}
                className="min-h-12 gap-2 py-1 pr-8 pl-1.5"
              >
                <ThemePreview theme={theme} />
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}

function ThemePreview({ theme }: { theme: RegisteredTheme }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <ThemeSwatch theme={theme} />
      <span className="truncate text-left text-sm font-medium">{theme.name}</span>
    </span>
  )
}

function ThemeSwatch({ theme }: { theme: RegisteredTheme }) {
  const colors = theme.source.theme

  return (
    <span
      className="grid size-8 shrink-0 place-items-center rounded-md border text-sm leading-none font-medium"
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.ink,
        color: colors.accent,
      }}
      aria-hidden="true"
    >
      Aa
    </span>
  )
}
