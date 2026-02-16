'use client'

import { useRef } from 'react'
import { motion, useInView } from 'framer-motion'

const features = [
  {
    title: 'Policy engine',
    description: 'Define what agents can do. Auto-allow safe actions. Flag dangerous ones. One-click presets or custom rules.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400/70">
        <path d="M12 2l8 4v6c0 5.5-3.8 10.7-8 12-4.2-1.3-8-6.5-8-12V6l8-4z" />
        <path d="M12 8v4M12 16h.01" />
      </svg>
    ),
  },
  {
    title: 'AI threat detection',
    description: 'An AI supervisor watches every action. Flags anomalies, privilege escalation, retry loops, and suspicious patterns in real time.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-red-400/70">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4l2 2" />
      </svg>
    ),
  },
  {
    title: 'Cryptographic receipts',
    description: 'Every action produces an ed25519-signed, hash-chained receipt. Not logging. Mathematical proof of what happened and who approved it.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent/70">
        <path d="M9 12l2 2 4-4" />
        <rect x="3" y="5" width="18" height="14" rx="2" />
      </svg>
    ),
  },
  {
    title: 'Human-readable actions',
    description: 'No raw commands or hashes. Every action described in plain English. Non-technical reviewers can understand exactly what the agent wants to do.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-cyan-400/70">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <path d="M14 2v6h6M8 13h8M8 17h6" />
      </svg>
    ),
  },
  {
    title: 'Agent trust scoring',
    description: 'Every agent earns a 0-100 trust score based on behavior. Bad actions lower trust. Good patterns increase autonomy over time.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-purple-400/70">
        <path d="M12 20V10M18 20V4M6 20v-4" />
      </svg>
    ),
  },
  {
    title: 'Deploy from dashboard',
    description: 'Spin up isolated agent instances in one click. Each gets its own container, API keys, and security boundary. Manage everything from the UI.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400/70">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    ),
  },
]

export function Features() {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-60px' })

  return (
    <section ref={ref} className="py-28">
      <div className="max-w-4xl mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <p className="text-accent/60 text-[12px] font-mono tracking-widest uppercase mb-4">
            What you get
          </p>
          <h2 className="font-display text-[clamp(1.8rem,4vw,2.8rem)] font-bold tracking-tight text-white">
            Everything between your agents and the real world
          </h2>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 20 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: 0.1 + i * 0.07 }}
              className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-6 hover:border-white/[0.12] transition-colors"
            >
              <div className="mb-4">{f.icon}</div>
              <h3 className="font-display text-[16px] font-bold text-white/80 mb-2">
                {f.title}
              </h3>
              <p className="text-white/35 text-[13px] leading-relaxed">
                {f.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
