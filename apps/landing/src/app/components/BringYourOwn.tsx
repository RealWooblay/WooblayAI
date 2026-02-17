'use client'

import { useRef } from 'react'
import { motion, useInView } from 'framer-motion'

const items = [
  {
    title: 'Any agent runtime.',
    desc: 'OpenClaw, LangChain, CrewAI, AutoGen, or your own. Wooblay sits between the agent and the world. No SDK lock-in.',
    mono: 'Runtime-agnostic',
  },
  {
    title: 'Any workflow.',
    desc: 'Code review, QA, deployment, data pipelines, customer support, content generation. If an agent can do it, Wooblay can secure it.',
    mono: 'Workflow-agnostic',
  },
  {
    title: 'Sensors that listen.',
    desc: 'Connect event sources that trigger agent work automatically. A PR opened, a metric spiked, a message received. Agents respond. Wooblay verifies.',
    mono: 'Event-driven',
  },
]

export function BringYourOwn() {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-60px' })

  return (
    <section ref={ref} className="py-28 relative">
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-[500px] h-[300px] bg-accent/[0.03] rounded-full blur-[140px]" />
      </div>

      <div className="relative max-w-3xl mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <p className="text-accent/60 text-[12px] font-mono tracking-widest uppercase mb-4">
            Your stack, your agents
          </p>
          <h2 className="font-display text-[clamp(1.8rem,4vw,2.8rem)] font-bold tracking-tight text-white">
            Bring your own everything.
          </h2>
          <p className="mt-4 text-white/40 text-[15px] leading-relaxed max-w-lg mx-auto">
            Wooblay is the security layer, not the runtime. Your agents keep running exactly how they do today.
          </p>
        </motion.div>

        <div className="grid sm:grid-cols-3 gap-5">
          {items.map((item, i) => (
            <motion.div
              key={item.mono}
              initial={{ opacity: 0, y: 20 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: 0.15 + i * 0.1, ease: [0.16, 1, 0.3, 1] }}
              className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-6 hover:border-white/[0.12] transition-colors"
            >
              <p className="text-accent/50 text-[10px] font-mono tracking-widest uppercase mb-3">{item.mono}</p>
              <h3 className="text-white font-display text-[17px] font-bold mb-2">{item.title}</h3>
              <p className="text-white/40 text-[14px] leading-relaxed">{item.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
