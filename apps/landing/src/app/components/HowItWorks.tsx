'use client'

import { useRef } from 'react'
import { motion, useInView } from 'framer-motion'

const steps = [
  {
    number: '01',
    title: 'One command. All agents configured.',
    description: 'Run npx @wooblaymcp/cli setup. Wooblay detects every agent on the machine — Cursor, Claude Desktop, VS Code — and routes them through your governance proxy. No manual config files. No per-agent setup.',
    color: 'text-white/60',
    borderColor: 'border-white/[0.08]',
    bgColor: 'bg-white/[0.02]',
  },
  {
    number: '02',
    title: 'Define policy. Enforce across all agents.',
    description: 'Set rules once: what\'s auto-allowed, what needs human approval, what\'s blocked. Policies apply to every agent in your org — Cursor, Claude, ChatGPT, custom agents. One policy set, one approval queue, one audit trail.',
    color: 'text-amber-400/80',
    borderColor: 'border-amber-400/[0.15]',
    bgColor: 'bg-amber-400/[0.03]',
  },
  {
    number: '03',
    title: 'Credentials never reach the agent.',
    description: 'When an agent needs to call Stripe or push to GitHub, the credential is injected into an ephemeral container that executes the action and is destroyed. The agent gets the result. It never sees the key.',
    color: 'text-accent',
    borderColor: 'border-accent/[0.15]',
    bgColor: 'bg-accent/[0.03]',
  },
]

export function HowItWorks() {
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
            How it works
          </p>
          <h2 className="font-display text-[clamp(1.8rem,4vw,2.8rem)] font-bold tracking-tight text-white">
            Deploy governance in minutes, not months.
          </h2>
        </motion.div>

        <div className="space-y-5">
          {steps.map((step, i) => (
            <motion.div
              key={step.number}
              initial={{ opacity: 0, x: -30 }}
              animate={inView ? { opacity: 1, x: 0 } : {}}
              transition={{ duration: 0.5, delay: 0.15 + i * 0.12, ease: [0.16, 1, 0.3, 1] }}
              className={`${step.bgColor} ${step.borderColor} border rounded-xl p-6 sm:p-8`}
            >
              <div className="flex items-start gap-5">
                <span className={`${step.color} font-mono text-[13px] font-bold shrink-0 mt-1`}>
                  {step.number}
                </span>
                <div>
                  <h3 className={`${step.color} font-display text-[18px] sm:text-[20px] font-bold`}>
                    {step.title}
                  </h3>
                  <p className="text-white/40 text-[14px] sm:text-[15px] leading-relaxed mt-2">
                    {step.description}
                  </p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : {}}
          transition={{ duration: 0.5, delay: 0.7 }}
          className="text-center mt-10"
        >
          <p className="text-white/25 text-[13px] font-mono">
            Credential isolation &middot; Policy enforcement &middot; Simulation &middot; Ephemeral execution &middot; Signed receipts
          </p>
        </motion.div>
      </div>
    </section>
  )
}
