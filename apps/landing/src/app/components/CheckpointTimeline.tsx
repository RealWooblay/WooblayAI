'use client'

import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const checkpoints = [
  { hash: 'a3f2', label: 'Init', status: 'ok' as const },
  { hash: 'b7d1', label: 'Pre-flight', status: 'ok' as const },
  { hash: 'c9e4', label: 'Approved', status: 'ok' as const },
  { hash: 'd1a8', label: 'Executed', status: 'ok' as const },
  { hash: 'e4f2', label: 'Verify', status: 'error' as const },
]

export function CheckpointTimeline() {
  const [current, setCurrent] = useState(4)
  const [rewinding, setRewinding] = useState(false)

  const handleRewind = useCallback(
    (target: number) => {
      if (target >= current || rewinding) return
      setRewinding(true)
      let i = current
      const tick = () => {
        if (i > target) {
          i--
          setCurrent(i)
          setTimeout(tick, 160)
        } else {
          setRewinding(false)
        }
      }
      setTimeout(tick, 80)
    },
    [current, rewinding],
  )

  return (
    <div className="space-y-7">
      {/* Chain */}
      <div className="flex items-start justify-between relative px-1">
        <div className="absolute top-[11px] left-6 right-6 h-px bg-white/[0.06]" />

        {checkpoints.map((cp, i) => {
          const active = i <= current
          const isCurr = i === current
          const isErr = cp.status === 'error' && isCurr

          return (
            <button
              key={cp.hash}
              onClick={() => handleRewind(i)}
              disabled={i >= current || rewinding}
              className="relative flex flex-col items-center gap-3 group z-10"
            >
              <motion.div
                animate={{
                  scale: isCurr ? 1 : 0.85,
                  borderColor: isErr
                    ? 'rgba(239,68,68,0.5)'
                    : isCurr
                      ? 'rgba(52,211,153,0.5)'
                      : active
                        ? 'rgba(52,211,153,0.2)'
                        : 'rgba(255,255,255,0.08)',
                  backgroundColor: isErr
                    ? 'rgba(239,68,68,0.12)'
                    : isCurr
                      ? 'rgba(52,211,153,0.1)'
                      : 'rgba(10,11,16,0.9)',
                }}
                transition={{ duration: 0.25 }}
                className="w-[24px] h-[24px] rounded border-[1.5px] flex items-center justify-center"
              >
                {isCurr && !isErr && (
                  <motion.div
                    animate={{ opacity: [0.4, 1, 0.4] }}
                    transition={{ duration: 2, repeat: Infinity }}
                    className="w-[6px] h-[6px] rounded-full bg-accent"
                  />
                )}
                {isErr && (
                  <svg
                    className="w-3 h-3 text-red-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                )}
                {!isCurr && active && (
                  <div className="w-1.5 h-1.5 rounded-full bg-accent/50" />
                )}
              </motion.div>

              <div className="text-center min-w-[52px]">
                <p
                  className={`text-[11px] font-mono leading-none ${
                    isErr
                      ? 'text-red-400/80'
                      : isCurr
                        ? 'text-accent/80'
                        : active
                          ? 'text-white/45'
                          : 'text-white/20'
                  }`}
                >
                  {cp.hash}
                </p>
                <p className="text-[10px] text-white/30 mt-1">{cp.label}</p>
              </div>

              {i < current && !rewinding && (
                <div className="absolute -top-8 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  <span className="text-[10px] font-mono text-amber-400/80 whitespace-nowrap bg-surface-2 px-2 py-0.5 rounded border border-amber-400/20">
                    rewind here
                  </span>
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* Status */}
      <AnimatePresence mode="wait">
        <motion.p
          key={current}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="text-center text-[12px] font-mono"
        >
          {checkpoints[current].status === 'error' ? (
            <span className="text-red-400/70">
              Verification failed at {checkpoints[current].hash} &middot; click
              an earlier checkpoint to rewind
            </span>
          ) : (
            <span className="text-accent/70">
              Rewound to {checkpoints[current].hash} &middot; state restored
            </span>
          )}
        </motion.p>
      </AnimatePresence>
    </div>
  )
}
