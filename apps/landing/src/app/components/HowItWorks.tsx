'use client'

import { useRef } from 'react'
import { motion, useInView } from 'framer-motion'

const steps = [
  {
    number: '01',
    title: 'You decide',
    description: 'Sensors connect to your services. You decide what your agent can do.',
    color: 'text-white/60',
    borderColor: 'border-white/[0.08]',
    bgColor: 'bg-white/[0.02]',
  },
  {
    number: '02',
    title: 'Simulate before executing',
    description: 'Every agent action is intercepted, pre-executed in a sandbox and evaluated against your policies.',
    color: 'text-amber-400/80',
    borderColor: 'border-amber-400/[0.15]',
    bgColor: 'bg-amber-400/[0.03]',
  },
  {
    number: '03',
    title: 'Execute securely',
    description: 'Agents never receive raw credentials. Outcomes are verified and recorded with cryptographic receipts.',
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
            Your autonomous agent
          </p>
          <h2 className="font-display text-[clamp(1.8rem,4vw,2.8rem)] font-bold tracking-tight text-white">
            Controlled by you.
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

        {/* Connecting flow arrow */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : {}}
          transition={{ duration: 0.5, delay: 0.7 }}
          className="text-center mt-10"
        >
          <p className="text-white/25 text-[13px] font-mono">
            Credential isolation · scope boundaries · simulation · ephemeral execution · signed receipts
          </p>
        </motion.div>
      </div>
    </section>
  )
}
