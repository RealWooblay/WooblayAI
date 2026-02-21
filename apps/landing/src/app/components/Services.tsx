'use client'

import { useRef } from 'react'
import { motion, useInView } from 'framer-motion'

const services = [
  {
    title: 'Agent Hosting & Infrastructure',
    description:
      'We help teams design, deploy, and operate production agent infrastructure — from MCP server topology and credential management to execution policies and scaling.',
    items: [
      'MCP server architecture and integration',
      'Credential vault design and rotation strategy',
      'Policy engine configuration for your risk profile',
      'Production deployment and monitoring setup',
    ],
    accent: 'accent',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 0 1-3-3m3 3a3 3 0 1 0 0 6h13.5a3 3 0 1 0 0-6m-16.5-3a3 3 0 0 1 3-3h13.5a3 3 0 0 1 3 3m-19.5 0a4.5 4.5 0 0 1 .9-2.7L5.737 5.1a3.375 3.375 0 0 1 2.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 0 1 .9 2.7m0 0a3 3 0 0 1-3 3m0 3h.008v.008h-.008v-.008Zm0-6h.008v.008h-.008v-.008Zm-3 6h.008v.008h-.008v-.008Zm0-6h.008v.008h-.008v-.008Z" />
      </svg>
    ),
  },
  {
    title: 'Automated Sensors & Operations',
    description:
      'Event-driven automation that connects your systems—and your physical environment—to agent workflows. We install real-world sensors and wire them to the gate so your space is agentic, not just your digital stack. Webhooks and sensors trigger operations; AI classifies intent; agents execute within policy.',
    items: [
      'Webhook sensors for GitHub, Slack, and custom sources',
      'Real-world sensors: we install and connect physical sensors so your environment is agentic, not just digital',
      'AI-powered event classification and routing',
      'Automated operation pipelines with approval gates',
      'Priority-based triage and escalation rules',
    ],
    accent: 'blue-400',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.348 14.652a3.75 3.75 0 0 1 0-5.304m5.304 0a3.75 3.75 0 0 1 0 5.304m-7.425 2.121a6.75 6.75 0 0 1 0-9.546m9.546 0a6.75 6.75 0 0 1 0 9.546M5.106 18.894c-3.808-3.807-3.808-9.98 0-13.788m13.788 0c3.808 3.807 3.808 9.98 0 13.788M12 12h.008v.008H12V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
      </svg>
    ),
  },
]

export function Services() {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-60px' })

  return (
    <section ref={ref} className="py-28 border-t border-white/[0.04]">
      <div className="max-w-3xl mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-14"
        >
          <p className="text-white/30 text-[12px] font-mono tracking-widest uppercase mb-4">
            Beyond the product
          </p>
          <h2 className="font-display text-[clamp(1.6rem,3.5vw,2.4rem)] font-bold tracking-tight text-white">
            We also build and operate.
          </h2>
          <p className="mt-4 text-white/35 text-[15px] max-w-xl mx-auto">
            Agent hosting, event-driven automation, and real-world sensors: we install physical sensors and connect them to the gate so your environment is agentic, not just your digital stack. We work with teams to get production-ready.
          </p>
        </motion.div>

        <div className="space-y-5">
          {services.map((svc, i) => (
            <motion.div
              key={svc.title}
              initial={{ opacity: 0, y: 20 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: 0.1 + i * 0.1, ease: [0.16, 1, 0.3, 1] }}
              className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-6 sm:p-7"
            >
              <div className="flex items-start gap-4">
                <div className={`shrink-0 w-9 h-9 rounded-lg bg-${svc.accent}/10 border border-${svc.accent}/20 flex items-center justify-center text-${svc.accent}`}>
                  {svc.icon}
                </div>
                <div>
                  <h3 className="text-white font-display text-[16px] font-bold mb-2">{svc.title}</h3>
                  <p className="text-white/40 text-[14px] leading-relaxed mb-4">{svc.description}</p>
                  <ul className="space-y-1.5">
                    {svc.items.map((item) => (
                      <li key={item} className="flex items-center gap-2 text-white/30 text-[13px]">
                        <span className={`w-1 h-1 rounded-full bg-${svc.accent}/50 shrink-0`} />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5, delay: 0.35 }}
          className="mt-8 text-center"
        >
          <a
            href="https://x.com/RealWooblay"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-white/40 hover:text-white/60 text-[13px] font-mono transition-colors"
          >
            Reach out on X
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </a>
        </motion.div>
      </div>
    </section>
  )
}
