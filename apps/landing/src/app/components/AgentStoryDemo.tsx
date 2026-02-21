'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

/**
 * Interactive narrative demo. The visitor PARTICIPATES:
 *   1. Safe agent actions stream in
 *   2. A dangerous action appears (red)
 *   3. Wooblay gates it
 *   4. Approve / Deny buttons appear — visitor clicks
 *   5. Outcome shown → loop
 *
 * Auto-approves after 4 s if no interaction.
 */

interface Line {
  type: 'safe' | 'danger' | 'gate' | 'approved' | 'denied'
  text: string
}

const script: Line[] = [
  { type: 'safe', text: 'Analyzing CI failure on main…' },
  { type: 'safe', text: 'Reading test output from build #1847…' },
  { type: 'danger', text: 'Proposed: merge PR #412 to main' },
  { type: 'gate', text: 'Approval required — evidence attached' },
]

type Phase = 'streaming' | 'waiting' | 'resolved'

const DELAYS: Record<string, number> = {
  safe: 700,
  danger: 1000,
  gate: 1200,
}

const lineVariants = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' } },
}

const icons: Record<Line['type'], string> = {
  safe: '✓',
  danger: '⚠',
  gate: '⏸',
  approved: '✓',
  denied: '✕',
}

const colors: Record<Line['type'], string> = {
  safe: 'text-white/40',
  danger: 'text-red-400',
  gate: 'text-amber-400',
  approved: 'text-accent',
  denied: 'text-red-400/80',
}

export function AgentStoryDemo() {
  const [lines, setLines] = useState<Line[]>([])
  const [phase, setPhase] = useState<Phase>('streaming')
  const [idx, setIdx] = useState(0)
  const [cycle, setCycle] = useState(0)

  /* ── stream lines ────────────────────── */
  useEffect(() => {
    if (phase !== 'streaming') return
    if (idx >= script.length) {
      setPhase('waiting')
      return
    }
    const delay = idx === 0 ? 600 : DELAYS[script[idx].type] ?? 700
    const t = setTimeout(() => {
      setLines((p) => [...p, script[idx]])
      setIdx((i) => i + 1)
    }, delay)
    return () => clearTimeout(t)
  }, [phase, idx])

  /* ── auto-approve after 4 s ──────────── */
  useEffect(() => {
    if (phase !== 'waiting') return
    const t = setTimeout(() => choose('approved'), 4000)
    return () => clearTimeout(t)
  }, [phase])

  /* ── reset after outcome shown ───────── */
  useEffect(() => {
    if (phase !== 'resolved') return
    const t = setTimeout(() => {
      setLines([])
      setIdx(0)
      setPhase('streaming')
      setCycle((c) => c + 1)
    }, 3200)
    return () => clearTimeout(t)
  }, [phase])

  const choose = useCallback(
    (c: 'approved' | 'denied') => {
      if (phase !== 'waiting') return
      setLines((p) => [
        ...p,
        {
          type: c,
          text:
            c === 'approved'
              ? 'Approved · executed via gateway · receipt r_8f2a verified'
              : 'Denied · action blocked · no credentials exposed',
        },
      ])
      setPhase('resolved')
    },
    [phase],
  )

  return (
    <div className="relative glow-border rounded-xl">
      <div className="relative bg-[#0d0e15]/90 backdrop-blur-sm rounded-xl border border-white/[0.08] overflow-hidden">
        {/* Header bar */}
        <div className="px-5 py-3 border-b border-white/[0.06] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
            <span className="text-[12px] font-mono text-white/45">
              agent activity
            </span>
          </div>
          <span className="text-[10px] font-mono text-white/20">live</span>
        </div>

        {/* Lines */}
        <div className="p-5 min-h-[250px] space-y-2.5">
          <AnimatePresence mode="popLayout">
            {lines.map((line, i) => (
              <motion.div
                key={`${cycle}-${i}`}
                variants={lineVariants}
                initial="hidden"
                animate="show"
                className={`flex items-start gap-2.5 font-mono text-[13px] leading-relaxed ${colors[line.type]}`}
              >
                <span className="shrink-0 mt-px select-none">
                  {icons[line.type]}
                </span>
                <span
                  className={
                    line.type === 'danger'
                      ? 'bg-red-500/10 px-2 py-0.5 rounded -mx-1 -my-0.5'
                      : line.type === 'approved'
                        ? 'bg-accent/10 px-2 py-0.5 rounded -mx-1 -my-0.5'
                        : ''
                  }
                >
                  {line.text}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Approve / Deny buttons */}
          <AnimatePresence>
            {phase === 'waiting' && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="flex gap-3 pt-3 pl-5"
              >
                <button
                  onClick={() => choose('approved')}
                  className="px-4 py-1.5 rounded-md bg-accent/15 border border-accent/25 text-accent text-[12px] font-mono hover:bg-accent/25 transition-colors cursor-pointer"
                >
                  Approve
                </button>
                <button
                  onClick={() => choose('denied')}
                  className="px-4 py-1.5 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 text-[12px] font-mono hover:bg-red-500/20 transition-colors cursor-pointer"
                >
                  Deny
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Blinking cursor while streaming */}
          {phase === 'streaming' && idx < script.length && (
            <motion.div
              animate={{ opacity: [0, 1, 0] }}
              transition={{ duration: 1.2, repeat: Infinity }}
              className="w-1.5 h-[18px] bg-white/25 rounded-sm ml-5"
            />
          )}
        </div>
      </div>
    </div>
  )
}
