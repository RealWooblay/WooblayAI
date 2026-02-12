'use client'

import { motion, useInView } from 'framer-motion'
import { useRef } from 'react'

const alerts = [
  { time: '3:14 AM', text: 'Your agent changed your pricing to $47,000/mo.' },
  { time: '3:17 AM', text: 'Your agent emailed 10,000 customers.' },
  { time: '3:19 AM', text: 'Your agent dropped your production database.' },
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
                  ⚠
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
            <span className="text-white">This already happens.</span>
          </p>
          <p className="mt-4 text-white/40 text-[15px] leading-relaxed max-w-md mx-auto">
            Agents write code, send emails, manage infrastructure, access business data.
            Without governance, you&apos;re trusting an LLM with the keys to your company.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 1.5, ease: [0.16, 1, 0.3, 1] }}
          className="mt-10 text-center"
        >
          <p className="font-display text-[clamp(1.4rem,3vw,2rem)] font-bold tracking-tight leading-[1.15]">
            <span className="text-white/60">What if every action needed </span>
            <span className="text-accent">your approval</span>
            <span className="text-white/60"> first?</span>
          </p>
        </motion.div>
      </div>
    </section>
  )
}
