'use client'

import { useRef } from 'react'
import { motion, useInView } from 'framer-motion'

const useCases = [
  {
    label: '01',
    title: 'Your agent ships a fix at 2 AM.',
    before: 'It writes the code, opens a PR, and deploys. You find out the next morning.',
    after: 'Wooblay intercepts the deploy, simulates it, and holds for your approval. The fix ships when you say so. Every step receipted.',
    accent: 'text-accent',
    border: 'border-accent/[0.12]',
    bg: 'bg-accent/[0.02]',
    glow: 'bg-accent/[0.04]',
  },
  {
    label: '02',
    title: 'Your agent needs access to everything.',
    before: 'So you hand it the keys. It works great until it leaks a credential or hits an endpoint it should not touch.',
    after: 'Wooblay runs the action in an ephemeral container with injected credentials. The agent never sees them. Scope boundaries prevent lateral movement.',
    accent: 'text-amber-400',
    border: 'border-amber-400/[0.12]',
    bg: 'bg-amber-400/[0.02]',
    glow: 'bg-amber-400/[0.04]',
  },
  {
    label: '03',
    title: 'You have five agents across three teams.',
    before: 'Each one configured differently. No unified view. No audit trail. No idea what ran last Tuesday.',
    after: 'One control plane. Every action from every agent logged, signed, and searchable. Policies apply across all of them. One place to approve, one place to review.',
    accent: 'text-emerald-400',
    border: 'border-emerald-400/[0.12]',
    bg: 'bg-emerald-400/[0.02]',
    glow: 'bg-emerald-400/[0.04]',
  },
]

export function Features() {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-60px' })

  return (
    <section ref={ref} className="py-28">
      <div className="max-w-3xl mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <p className="text-accent/60 text-[12px] font-mono tracking-widest uppercase mb-4">
            Real scenarios
          </p>
          <h2 className="font-display text-[clamp(1.8rem,4vw,2.8rem)] font-bold tracking-tight text-white">
            What changes when agents are secured.
          </h2>
        </motion.div>

        <div className="space-y-6">
          {useCases.map((uc, i) => (
            <motion.div
              key={uc.label}
              initial={{ opacity: 0, y: 24 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.55, delay: 0.1 + i * 0.12, ease: [0.16, 1, 0.3, 1] }}
              className={`${uc.bg} ${uc.border} border rounded-xl p-7 sm:p-8 relative overflow-hidden`}
            >
              {/* Subtle glow */}
              <div className={`absolute top-0 right-0 w-48 h-48 ${uc.glow} rounded-full blur-[80px] -translate-y-1/2 translate-x-1/4`} />

              <div className="relative">
                <div className="flex items-center gap-3 mb-4">
                  <span className={`${uc.accent} font-mono text-[12px] font-bold`}>{uc.label}</span>
                  <h3 className="text-white font-display text-[18px] sm:text-[20px] font-bold leading-snug">
                    {uc.title}
                  </h3>
                </div>

                <div className="grid sm:grid-cols-2 gap-4 sm:gap-6">
                  <div>
                    <p className="text-red-400/50 text-[11px] font-mono uppercase tracking-wider mb-2">Without Wooblay</p>
                    <p className="text-white/35 text-[14px] leading-relaxed">{uc.before}</p>
                  </div>
                  <div>
                    <p className={`${uc.accent} text-[11px] font-mono uppercase tracking-wider mb-2 opacity-70`}>With Wooblay</p>
                    <p className="text-white/60 text-[14px] leading-relaxed">{uc.after}</p>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
