'use client'

import { motion, useInView } from 'framer-motion'
import { useRef } from 'react'

const alerts = [
  { time: 'Monday', text: 'An engineer\'s Claude agent pushed directly to main using their personal GitHub token.' },
  { time: 'Tuesday', text: 'Your SOC 2 auditor asks: "What did your AI agents access last quarter?" You have no answer.' },
  { time: 'Wednesday', text: '15 agents across 3 teams. 15 separate credential sets. Zero unified policy. Zero shared audit trail.' },
]

export function WhySection() {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-80px' })

  return (
    <section ref={ref} className="py-32 relative overflow-hidden">
      {/* Danger ambient */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={inView ? { opacity: 1, scale: 1 } : {}}
          transition={{ duration: 1.5 }}
          className="w-[600px] h-[400px] bg-red-500/[0.04] rounded-full blur-[160px]"
        />
      </div>

      <div className="relative max-w-lg mx-auto px-6">
        {/* Cascading notification cards */}
        <div className="space-y-4">
          {alerts.map((a, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: 40 + i * 15 }}
              animate={inView ? { opacity: 1, x: 0 } : {}}
              transition={{
                duration: 0.55,
                delay: 0.2 + i * 0.25,
                ease: [0.16, 1, 0.3, 1],
              }}
              style={{ marginLeft: `${i * 24}px` }}
              className="px-5 py-4 rounded-lg bg-red-500/[0.06] border border-red-500/[0.12] backdrop-blur-sm"
            >
              <div className="flex items-start gap-3">
                <span className="text-red-400/70 text-[13px] shrink-0 select-none">
                  &#x26A0;
                </span>
                <div className="flex-1 min-w-0">
                  <span className="text-red-400/50 font-mono text-[11px]">
                    {a.time}
                  </span>
                  <p className="text-white/70 text-[15px] font-medium leading-snug mt-0.5">
                    {a.text}
                  </p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* The turn */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7, delay: 1.1, ease: [0.16, 1, 0.3, 1] }}
          className="mt-16 text-center"
        >
          <p className="font-display text-[clamp(1.8rem,4vw,2.6rem)] font-bold tracking-tight leading-[1.1]">
            <span className="text-white">This is happening at every company deploying AI agents.</span>
          </p>
          <p className="mt-4 text-white/40 text-[15px] leading-relaxed max-w-md mx-auto">
            Every team has agents connecting to Stripe, GitHub, Salesforce, databases, and cloud infrastructure. No central policy. No credential isolation. No audit trail that satisfies compliance.
          </p>
        </motion.div>
      </div>
    </section>
  )
}
