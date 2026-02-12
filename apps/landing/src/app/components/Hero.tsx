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

      <div className="relative text-center px-6">
        <FadeIn>
          <h1 className="font-display text-[clamp(3.5rem,9vw,7.5rem)] font-bold tracking-[-0.045em] leading-[0.88]">
            <span className="text-gradient">Reversible autonomy</span>
            <br />
            <span className="text-white/20">for AI&nbsp;agents.</span>
          </h1>
        </FadeIn>

        <FadeIn delay={0.08}>
          <p className="mt-6 text-white/45 text-lg tracking-wide">
            Approve. Audit. Rewind.
          </p>
        </FadeIn>

        <FadeIn delay={0.12}>
          <div className="mt-7 flex justify-center">
            <a
              href="#request-access"
              className="px-6 py-2.5 rounded-md bg-accent text-surface-0 font-semibold text-[14px] hover:bg-accent/90 transition-colors"
            >
              Request access
            </a>
          </div>
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
