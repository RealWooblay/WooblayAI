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
            Secure your agent actions.
          </p>
        </FadeIn>

        <FadeIn delay={0.04}>
          <h1 className="font-display text-[clamp(2.8rem,7vw,5.5rem)] font-bold tracking-[-0.04em] leading-[0.92]">
            <span className="text-gradient">Agents decide</span>
            <br />
            <span className="text-white/20">Wooblay executes.</span>
          </h1>
        </FadeIn>

        <FadeIn delay={0.05}>
          <p className="mt-6 text-white/50 text-[16px] sm:text-[18px] max-w-lg mx-auto">
            Every action is policy-checked, simulated, executed in an ephemeral container, and cryptographically receipted.
          </p>
        </FadeIn>

        <FadeIn delay={0.1}>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <a
              href="https://x.com/RealWooblay"
              target="_blank"
              rel="noopener noreferrer"
              className="px-6 py-3 rounded-md bg-accent text-surface-0 font-semibold text-[14px] hover:bg-accent/90 transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              Follow @RealWooblay
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
