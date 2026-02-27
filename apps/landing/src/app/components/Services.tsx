'use client'

import { useRef } from 'react'
import { motion, useInView } from 'framer-motion'

const capabilities = [
  {
    title: 'Universal Agent Gateway',
    description:
      'A single MCP proxy that sits between every agent tool call and every external service. Cursor, Claude Desktop, ChatGPT, custom agents — they all route through one governance layer. One policy set, one credential vault, one audit trail.',
    items: [
      'Works with every MCP-compatible agent — no code changes',
      'Centralized credential vault with per-action injection',
      'Configurable policy engine: auto-allow, require approval, or block',
      'Multi-channel approvals via Telegram, Slack, WhatsApp',
    ],
    accent: 'accent',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
      </svg>
    ),
  },
  {
    title: 'Compliance-Ready Audit Trail',
    description:
      'Every agent action produces a cryptographic receipt: what happened, who approved it, when, and which credential was used. Chain-linked and tamper-evident. Ready for SOC 2, HIPAA, GDPR, and the EU AI Act.',
    items: [
      'Cryptographic receipt chain — tamper-evident by design',
      'Exportable audit reports for compliance review',
      'Role-based access control with approval role enforcement',
      'Anomaly detection flags unusual agent behavior',
    ],
    accent: 'emerald-400',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.125 2.25h-4.5c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125v-9M10.125 2.25h.375a9 9 0 0 1 9 9v.375M10.125 2.25A3.375 3.375 0 0 1 13.5 5.625v1.5c0 .621.504 1.125 1.125 1.125h1.5a3.375 3.375 0 0 1 3.375 3.375M9 15l2.25 2.25L15 12" />
      </svg>
    ),
  },
  {
    title: 'Enterprise Deployment & Support',
    description:
      'Self-hosted or Wooblay Cloud. We help teams design agent infrastructure, configure policies for their risk profile, and get production-ready — from credential vault strategy to scaling across hundreds of agents.',
    items: [
      'On-premise deployment with full data sovereignty',
      'Dedicated onboarding and policy design',
      'Custom adapter development for proprietary tools',
      'SLA-backed support and infrastructure monitoring',
    ],
    accent: 'blue-400',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 0 1-3-3m3 3a3 3 0 1 0 0 6h13.5a3 3 0 1 0 0-6m-16.5-3a3 3 0 0 1 3-3h13.5a3 3 0 0 1 3 3m-19.5 0a4.5 4.5 0 0 1 .9-2.7L5.737 5.1a3.375 3.375 0 0 1 2.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 0 1 .9 2.7m0 0a3 3 0 0 1-3 3m0 3h.008v.008h-.008v-.008Zm0-6h.008v.008h-.008v-.008Zm-3 6h.008v.008h-.008v-.008Zm0-6h.008v.008h-.008v-.008Z" />
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
            Platform capabilities
          </p>
          <h2 className="font-display text-[clamp(1.6rem,3.5vw,2.4rem)] font-bold tracking-tight text-white">
            Everything your security team needs.
          </h2>
          <p className="mt-4 text-white/35 text-[15px] max-w-xl mx-auto">
            Agent governance that satisfies compliance, protects credentials, and gives engineering teams full autonomy within defined boundaries.
          </p>
        </motion.div>

        <div className="space-y-5">
          {capabilities.map((cap, i) => (
            <motion.div
              key={cap.title}
              initial={{ opacity: 0, y: 20 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: 0.1 + i * 0.1, ease: [0.16, 1, 0.3, 1] }}
              className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-6 sm:p-7"
            >
              <div className="flex items-start gap-4">
                <div className={`shrink-0 w-9 h-9 rounded-lg bg-${cap.accent}/10 border border-${cap.accent}/20 flex items-center justify-center text-${cap.accent}`}>
                  {cap.icon}
                </div>
                <div>
                  <h3 className="text-white font-display text-[16px] font-bold mb-2">{cap.title}</h3>
                  <p className="text-white/40 text-[14px] leading-relaxed mb-4">{cap.description}</p>
                  <ul className="space-y-1.5">
                    {cap.items.map((item) => (
                      <li key={item} className="flex items-center gap-2 text-white/30 text-[13px]">
                        <span className={`w-1 h-1 rounded-full bg-${cap.accent}/50 shrink-0`} />
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
            href="mailto:enterprise@wooblay.com?subject=Wooblay%20Enterprise%20Inquiry"
            className="inline-flex items-center gap-2 text-white/40 hover:text-white/60 text-[13px] font-mono transition-colors"
          >
            Talk to our team &rarr;
          </a>
        </motion.div>
      </div>
    </section>
  )
}
