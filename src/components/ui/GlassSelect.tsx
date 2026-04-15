import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Check, ChevronDown } from 'lucide-react'

export interface GlassSelectOption {
  value: string
  label: string
  description?: string
  disabled?: boolean
}

type AccentColor = 'pink' | 'emerald' | 'purple' | 'blue' | 'amber'

interface GlassSelectProps {
  value: string
  onChange: (value: string) => void
  options: readonly GlassSelectOption[]
  placeholder?: string
  disabled?: boolean
  color?: AccentColor
  className?: string
  id?: string
  ariaLabel?: string
  size?: 'md' | 'lg'
}

const accentMap: Record<
  AccentColor,
  { ring: string; border: string; text: string; dot: string; glow: string }
> = {
  pink: {
    ring: 'focus:ring-pink-100',
    border: 'focus:border-pink-300',
    text: 'text-pink-500',
    dot: 'bg-pink-500',
    glow: 'shadow-pink-100/40',
  },
  emerald: {
    ring: 'focus:ring-emerald-100',
    border: 'focus:border-emerald-300',
    text: 'text-emerald-500',
    dot: 'bg-emerald-500',
    glow: 'shadow-emerald-100/40',
  },
  purple: {
    ring: 'focus:ring-purple-100',
    border: 'focus:border-purple-300',
    text: 'text-purple-500',
    dot: 'bg-purple-500',
    glow: 'shadow-purple-100/40',
  },
  blue: {
    ring: 'focus:ring-blue-100',
    border: 'focus:border-blue-300',
    text: 'text-blue-500',
    dot: 'bg-blue-500',
    glow: 'shadow-blue-100/40',
  },
  amber: {
    ring: 'focus:ring-amber-100',
    border: 'focus:border-amber-300',
    text: 'text-amber-500',
    dot: 'bg-amber-500',
    glow: 'shadow-amber-100/40',
  },
}

export function GlassSelect({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  disabled = false,
  color = 'pink',
  className = '',
  id,
  ariaLabel,
  size = 'md',
}: GlassSelectProps) {
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const [menuRect, setMenuRect] = useState<{
    top: number
    left: number
    width: number
    placeAbove: boolean
  } | null>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const generatedId = useId()
  const listboxId = `${id ?? generatedId}-listbox`

  const accent = accentMap[color]
  const selectedIndex = options.findIndex((o) => o.value === value)
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined

  const sizing =
    size === 'lg' ? 'px-4 py-2.5 text-sm min-h-[44px]' : 'px-3 py-2 text-sm min-h-[38px]'

  const updateRect = useCallback(() => {
    const btn = buttonRef.current
    if (!btn) return
    const r = btn.getBoundingClientRect()
    const estimatedMenuHeight = Math.min(256, options.length * 44 + 16)
    const spaceBelow = window.innerHeight - r.bottom
    const placeAbove = spaceBelow < estimatedMenuHeight + 16 && r.top > estimatedMenuHeight + 16
    setMenuRect({
      top: placeAbove ? r.top - 8 : r.bottom + 8,
      left: r.left,
      width: r.width,
      placeAbove,
    })
  }, [options.length])

  useLayoutEffect(() => {
    if (!open) {
      setMenuRect(null)
      return
    }
    updateRect()
  }, [open, updateRect])

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node
      if (buttonRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      setOpen(false)
    }
    function onReposition() {
      updateRect()
    }
    document.addEventListener('mousedown', onDocClick)
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
    }
  }, [open, updateRect])

  useEffect(() => {
    if (open) {
      const start = selectedIndex >= 0 ? selectedIndex : firstEnabled(options)
      setHighlight(start)
    }
  }, [open, selectedIndex, options])

  useEffect(() => {
    if (!open || highlight < 0 || !listRef.current) return
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${highlight}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [open, highlight])

  function commit(idx: number) {
    const opt = options[idx]
    if (!opt || opt.disabled) return
    onChange(opt.value)
    setOpen(false)
    buttonRef.current?.focus()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        if (!open) {
          setOpen(true)
        } else {
          setHighlight((h) => nextEnabled(options, h, 1))
        }
        break
      case 'ArrowUp':
        e.preventDefault()
        if (!open) {
          setOpen(true)
        } else {
          setHighlight((h) => nextEnabled(options, h, -1))
        }
        break
      case 'Home':
        if (open) {
          e.preventDefault()
          setHighlight(firstEnabled(options))
        }
        break
      case 'End':
        if (open) {
          e.preventDefault()
          setHighlight(lastEnabled(options))
        }
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        if (!open) {
          setOpen(true)
        } else {
          commit(highlight)
        }
        break
      case 'Escape':
        if (open) {
          e.preventDefault()
          setOpen(false)
        }
        break
      case 'Tab':
        if (open) setOpen(false)
        break
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={handleKeyDown}
        className={`w-full flex items-center gap-2 bg-white/60 backdrop-blur-sm border border-white/80 rounded-xl ${sizing} text-left shadow-sm hover:bg-white/80 hover:shadow-md transition-all duration-200 focus:outline-none focus:ring-2 ${accent.ring} ${accent.border} disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      >
        <span
          className={`flex-1 truncate ${selectedOption ? 'text-gray-700' : 'text-gray-400'}`}
        >
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 24 }}
          className={`shrink-0 ${accent.text}`}
        >
          <ChevronDown className="w-4 h-4" />
        </motion.span>
      </button>

      {createPortal(
        <AnimatePresence>
          {open && menuRect && (
            <motion.div
              ref={panelRef}
              initial={{
                opacity: 0,
                y: menuRect.placeAbove ? 6 : -6,
                scale: 0.98,
              }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{
                opacity: 0,
                y: menuRect.placeAbove ? 4 : -4,
                scale: 0.98,
              }}
              transition={{ type: 'spring', bounce: 0.2, duration: 0.25 }}
              style={{
                position: 'fixed',
                top: menuRect.placeAbove ? undefined : menuRect.top,
                bottom: menuRect.placeAbove
                  ? window.innerHeight - menuRect.top
                  : undefined,
                left: menuRect.left,
                width: menuRect.width,
                transformOrigin: menuRect.placeAbove ? 'bottom center' : 'top center',
              }}
              className="z-[1000]"
            >
              <ul
                ref={listRef}
                id={listboxId}
                role="listbox"
                tabIndex={-1}
                className={`max-h-64 overflow-y-auto bg-white/85 backdrop-blur-xl border border-white/70 rounded-xl shadow-xl ${accent.glow} p-1`}
              >
                {options.length === 0 ? (
                  <li className="px-3 py-2 text-xs text-gray-400 italic">No options</li>
                ) : (
                  options.map((opt, idx) => {
                    const isSelected = opt.value === value
                    const isHighlighted = idx === highlight
                    return (
                      <li
                        key={opt.value}
                        role="option"
                        aria-selected={isSelected}
                        data-idx={idx}
                        onMouseEnter={() => !opt.disabled && setHighlight(idx)}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          commit(idx)
                        }}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                          opt.disabled
                            ? 'opacity-40 cursor-not-allowed text-gray-400'
                            : isHighlighted
                              ? 'bg-white/95 text-gray-800 cursor-pointer'
                              : 'text-gray-600 cursor-pointer'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            isSelected ? accent.dot : 'bg-transparent'
                          }`}
                        />
                        <span className="flex-1 min-w-0">
                          <span className="block truncate">{opt.label}</span>
                          {opt.description && (
                            <span className="block text-[10px] text-gray-400 truncate">
                              {opt.description}
                            </span>
                          )}
                        </span>
                        {isSelected && (
                          <Check className={`w-3.5 h-3.5 shrink-0 ${accent.text}`} />
                        )}
                      </li>
                    )
                  })
                )}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  )
}

function firstEnabled(options: readonly GlassSelectOption[]): number {
  for (let i = 0; i < options.length; i++) {
    if (!options[i]?.disabled) return i
  }
  return -1
}

function lastEnabled(options: readonly GlassSelectOption[]): number {
  for (let i = options.length - 1; i >= 0; i--) {
    if (!options[i]?.disabled) return i
  }
  return -1
}

function nextEnabled(
  options: readonly GlassSelectOption[],
  current: number,
  dir: 1 | -1,
): number {
  let i = current + dir
  while (i >= 0 && i < options.length) {
    if (!options[i]?.disabled) return i
    i += dir
  }
  return current
}
