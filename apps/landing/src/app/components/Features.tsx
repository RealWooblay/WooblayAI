'use client'

import { useRef } from 'react'
import { motion, useInView } from 'framer-motion'

const useCases = [
  {
    label: '01',
    title: 'Your SOC 2 auditor asks about AI agent access.',
    before: 'You scramble. Each team has agents with their own API keys, no central log. You can\'t prove who approved what or what data was touched.',
    after: 'You export the Wooblay receipt chain: every action, every credential access, every approval — cryptographically signed, tamper-evident, auditor-ready.',
    accent: 'text-accent',
    border: 'border-accent/[0.12]',
    bg: 'bg-accent/[0.02]',
    glow: 'bg-accent/[0.04]',
  },
  {
    label: '02',
    title: '20 engineers, 15 agents, one production Stripe key.',
    before: 'The key lives in each engineer\'s local Claude config. Someone leaves the company — you can\'t revoke what you don\'t control.',
    after: 'Wooblay holds the credential in an encrypted vault. Agents request actions through the proxy — the key is injected into an ephemeral container and never exposed. Offboard someone? Revoke their Wooblay access. Every key, every agent, instantly.',
    accent: 'text-amber-400',
    border: 'border-amber-400/[0.12]',
    bg: 'bg-amber-400/[0.02]',
    glow: 'bg-amber-400/[0.04]',
  },
  {
    label: '03',
    title: 'An agent deploys to production at 3 AM.',
    before: 'The deploy goes through. No review. No gate. You find out the next morning when customers are complaining.',
    after: 'Wooblay catches the deploy, holds it for approval, and pings the on-call via Telegram, Slack, or WhatsApp. The CTO approves from their phone. The deploy ships with a cryptographic receipt. At-a-glance audit trail.',
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
            Enterprise scenarios
          </p>
          <h2 className="font-display text-[clamp(1.8rem,4vw,2.8rem)] font-bold tracking-tight text-white">
            What changes when agents are governed.
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
                    <p className="text-red-400/50 text-[11px] font-mono uppercase tracking-wider mb-2">Without governance</p>
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
