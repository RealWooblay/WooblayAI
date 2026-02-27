'use client'

import { FadeIn } from './FadeIn'
import { AgentStoryDemo } from './AgentStoryDemo'

export function Hero() {
  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center pt-14 pb-20 overflow-hidden">
      {/* Living gradient mesh */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-[-10%] left-[10%] w-[600px] h-[600px] rounded-full bg-accent/[0.07] blur-[180px] animate-float1" />
        <div className="absolute bottom-[0%] right-[5%] w-[500px] h-[500px] rounded-full bg-cyan-500/[0.04] blur-[160px] animate-float2" />
        <div className="absolute top-[50%] right-[35%] w-[300px] h-[300px] rounded-full bg-blue-500/[0.03] blur-[120px] animate-float3" />
      </div>

      {/* Hash-chain background */}
      <div className="absolute inset-0">
        <svg className="w-full h-full opacity-[0.02]" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="ch" width="80" height="80" patternUnits="userSpaceOnUse">
              <rect x="35" y="35" width="10" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="0.5" />
              <line x1="45" y1="40" x2="80" y2="40" stroke="currentColor" strokeWidth="0.3" />
              <line x1="40" y1="45" x2="40" y2="80" stroke="currentColor" strokeWidth="0.3" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#ch)" />
        </svg>
      </div>

      <div className="relative text-center px-6 max-w-4xl mx-auto">
        <FadeIn>
          <p className="text-accent/80 text-[13px] font-mono tracking-widest uppercase mb-6">
            AI agent governance for teams that ship
          </p>
        </FadeIn>

        <FadeIn delay={0.04}>
          <h1 className="font-display text-[clamp(2.8rem,7vw,5.5rem)] font-bold tracking-[-0.04em] leading-[0.92]">
            <span className="text-gradient">Your agents have keys</span>
            <br />
            <span className="text-gradient">to everything.</span>
            <br />
            <span className="text-white/20">Who&rsquo;s watching?</span>
          </h1>
        </FadeIn>

        <FadeIn delay={0.05}>
          <p className="mt-6 text-white/50 text-[16px] sm:text-[18px] max-w-xl mx-auto">
            Every agent on your team — Cursor, Claude, ChatGPT, custom — routes through one governance layer. Credentials never leave the vault. High-risk actions require human approval. Every decision is cryptographically signed.
          </p>
        </FadeIn>

        <FadeIn delay={0.1}>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <a
              href="mailto:enterprise@wooblay.com?subject=Wooblay%20Demo%20Request"
              className="px-7 py-3.5 rounded-md bg-accent text-surface-0 font-semibold text-[14px] hover:bg-accent/90 transition-colors"
            >
              Book a Demo
            </a>
            <a
              href="https://app.wooblay.com"
              className="px-7 py-3.5 rounded-md bg-white/[0.06] text-white/70 font-semibold text-[14px] hover:bg-white/[0.10] border border-white/[0.08] transition-colors"
            >
              Get Started Free
            </a>
          </div>
        </FadeIn>

        <FadeIn delay={0.14}>
          <p className="mt-4 text-white/25 text-[12px] font-mono">
            One command setup &middot; No agent code changes &middot; SOC 2 ready
          </p>
        </FadeIn>
      </div>

      {/* Interactive demo */}
      <FadeIn delay={0.2}>
        <div className="relative mt-16 w-full max-w-lg mx-auto px-6">
          <AgentStoryDemo />
        </div>
      </FadeIn>
    </section>
  )
}
