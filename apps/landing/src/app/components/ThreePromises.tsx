'use client'

import { useRef } from 'react'
import { motion, useInView } from 'framer-motion'

/**
 * Three words. Three SVG draw animations. Maximum impact.
 *
 * Gate  —  shield draws itself
 * Audit —  checkmark draws itself
 * Rewind — circular arrow draws itself
 *
 * Each triggers on scroll-in.
 */

export function ThreePromises() {
  return (
    <section className="py-28">
      <div className="max-w-2xl mx-auto px-6 flex items-start justify-center gap-16 sm:gap-24">
        <GateAnim />
        <AuditAnim />
        <RewindAnim />
      </div>
    </section>
  )
}

/* ── Gate: shield that draws itself + bar drops ──────── */
function GateAnim() {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-40px' })

  return (
    <div ref={ref} className="flex flex-col items-center gap-5">
      <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
        <motion.path
          d="M32 8 L52 18 V36 C52 46 42 54 32 56 C22 54 12 46 12 36 V18 Z"
          stroke="rgba(251,191,36,0.5)"
          strokeWidth={1.5}
          fill="rgba(251,191,36,0.04)"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={inView ? { pathLength: 1, opacity: 1 } : {}}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
        />
        {/* Barrier bar */}
        <motion.line
          x1="22"
          y1="34"
          x2="42"
          y2="34"
          stroke="rgba(251,191,36,0.7)"
          strokeWidth={2}
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={inView ? { pathLength: 1 } : {}}
          transition={{ duration: 0.4, delay: 1.0, ease: 'easeOut' }}
        />
      </svg>
      <span className="font-display text-[16px] font-semibold text-white/60 tracking-wide">
        Gate
      </span>
    </div>
  )
}

/* ── Audit: checkmark in circle ──────────────────────── */
function AuditAnim() {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-40px' })

  return (
    <div ref={ref} className="flex flex-col items-center gap-5">
      <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
        <motion.circle
          cx="32"
          cy="32"
          r="24"
          stroke="rgba(52,211,153,0.35)"
          strokeWidth={1.5}
          fill="rgba(52,211,153,0.04)"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={inView ? { pathLength: 1, opacity: 1 } : {}}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        />
        <motion.path
          d="M22 32 L29 39 L42 24"
          stroke="#34D399"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          initial={{ pathLength: 0 }}
          animate={inView ? { pathLength: 1 } : {}}
          transition={{ duration: 0.6, delay: 0.8, ease: 'easeOut' }}
        />
      </svg>
      <span className="font-display text-[16px] font-semibold text-white/60 tracking-wide">
        Audit
      </span>
    </div>
  )
}

/* ── Rewind: counter-clockwise arrow ─────────────────── */
function RewindAnim() {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-40px' })

  return (
    <div ref={ref} className="flex flex-col items-center gap-5">
      <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
        {/* Arc */}
        <motion.path
          d="M32 12 A20 20 0 1 0 14 26"
          stroke="rgba(52,211,153,0.45)"
          strokeWidth={1.5}
          fill="none"
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={inView ? { pathLength: 1, opacity: 1 } : {}}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
        />
        {/* Arrow tip */}
        <motion.path
          d="M14 18 L14 28 L24 26"
          stroke="rgba(52,211,153,0.6)"
          strokeWidth={1.5}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ opacity: 0, scale: 0.5 }}
          animate={inView ? { opacity: 1, scale: 1 } : {}}
          transition={{ duration: 0.35, delay: 1.0 }}
        />
      </svg>
      <span className="font-display text-[16px] font-semibold text-white/60 tracking-wide">
        Rewind
      </span>
    </div>
  )
}
