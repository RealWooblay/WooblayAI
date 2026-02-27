'use client'

import { useRef } from 'react'
import { motion, useInView } from 'framer-motion'

const gaps = [
  {
    what: 'Enterprise AI subscriptions',
    gives: 'Seat management, SSO, usage limits for one AI product.',
    missing: 'Your team uses 4 different agents. You\'re governing one of them.',
  },
  {
    what: 'API key rotation tools',
    gives: 'Rotate keys on a schedule. Audit who has access.',
    missing: 'The keys still sit in plaintext on every developer\'s laptop. An agent can exfiltrate them in one tool call.',
  },
  {
    what: 'Observability & logging',
    gives: 'You can see what happened after the fact.',
    missing: 'You can\'t stop a destructive action before it executes. You can\'t prove who approved it. Logs are mutable.',
  },
]

export function NotEnough() {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-60px' })

  return (
    <section ref={ref} className="py-28 relative">
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-[500px] h-[300px] bg-amber-500/[0.03] rounded-full blur-[140px]" />
      </div>

      <div className="relative max-w-3xl mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-14"
        >
          <p className="text-amber-400/60 text-[12px] font-mono tracking-widest uppercase mb-4">
            The gap
          </p>
          <h2 className="font-display text-[clamp(1.8rem,4vw,2.8rem)] font-bold tracking-tight text-white">
            You already bought security tools.<br />
            <span className="text-white/30">None of them solve this.</span>
          </h2>
        </motion.div>

        <div className="space-y-4">
          {gaps.map((g, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: 0.1 + i * 0.1, ease: [0.16, 1, 0.3, 1] }}
              className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-6 sm:p-7"
            >
              <h3 className="text-white font-display text-[16px] font-bold mb-3">{g.what}</h3>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-emerald-400/50 text-[10px] font-mono uppercase tracking-wider mb-1.5">What it gives you</p>
                  <p className="text-white/40 text-[14px] leading-relaxed">{g.gives}</p>
                </div>
                <div>
                  <p className="text-red-400/50 text-[10px] font-mono uppercase tracking-wider mb-1.5">What it doesn&rsquo;t</p>
                  <p className="text-white/50 text-[14px] leading-relaxed">{g.missing}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="mt-10 text-center"
        >
          <p className="text-white/30 text-[14px] max-w-lg mx-auto">
            Wooblay sits at the execution layer — between the agent&rsquo;s intent and the real-world action. That&rsquo;s the layer nothing else governs.
          </p>
        </motion.div>
      </div>
    </section>
  )
}
