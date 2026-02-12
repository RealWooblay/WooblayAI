'use client'

import { FadeIn } from './FadeIn'

export function Closing() {
  return (
    <section className="pt-24 pb-16 relative">
      <div className="absolute inset-0 bg-gradient-to-t from-accent/[0.04] via-transparent to-transparent" />

      <div className="relative max-w-3xl mx-auto px-6 lg:px-8">
        {/* The WHY */}
        <FadeIn>
          <div className="text-center mb-20">
            <p className="text-white/30 text-[14px] leading-relaxed max-w-xl mx-auto mb-8">
              Every enterprise wants AI agents. Nobody has an answer for
              &ldquo;what did it do?&rdquo; and &ldquo;can I stop it?&rdquo;
            </p>
            <div className="flex flex-wrap justify-center gap-x-8 gap-y-3 text-[13px] font-mono">
              <span className="text-white/20">78% of enterprises want AI agents</span>
              <span className="text-white/10">|</span>
              <span className="text-white/20">12% trust them to act alone</span>
            </div>
          </div>
        </FadeIn>

        {/* CTA */}
        <FadeIn delay={0.08}>
          <div className="text-center">
            <h2 className="font-display text-[clamp(2rem,5vw,3.5rem)] font-bold tracking-[-0.03em] leading-[0.95]">
              <span className="text-gradient">
                Agents should be powerful.
              </span>
              <br />
              <span className="text-white/18">
                Not unsupervised.
              </span>
            </h2>

            <p className="mt-6 text-white/40 text-[15px] max-w-lg mx-auto">
              We&apos;re building the governance layer for the agentic era.
              Follow along as we ship.
            </p>

            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
              <a
                href="https://x.com/RealWooblay"
                target="_blank"
                rel="noopener noreferrer"
                className="px-7 py-3.5 rounded-md bg-accent text-surface-0 font-semibold text-[14px] hover:bg-accent/90 transition-colors flex items-center gap-2.5"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
                Follow @RealWooblay
              </a>
              <a
                href="https://wooblay.com"
                target="_blank"
                rel="noopener noreferrer"
                className="px-7 py-3.5 rounded-md bg-white/[0.06] border border-white/[0.1] text-white/70 font-medium text-[14px] hover:bg-white/[0.1] hover:text-white/90 transition-colors"
              >
                Try the dashboard
              </a>
            </div>
          </div>
        </FadeIn>

        {/* Footer strip */}
        <FadeIn delay={0.15}>
          <div className="mt-28 pt-6 border-t border-white/[0.04]">
            <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-white/25 text-[11px] font-mono mb-6">
              <span>Private isolated instances</span>
              <span className="text-white/10">&middot;</span>
              <span>ed25519 signed receipts</span>
              <span className="text-white/10">&middot;</span>
              <span>Works with OpenClaw</span>
              <span className="text-white/10">&middot;</span>
              <span>SOC 2 ready architecture</span>
            </div>

            <div className="flex justify-center items-center gap-6">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded bg-accent/15 border border-accent/20 flex items-center justify-center">
                  <span className="text-accent text-[8px] font-bold font-display">
                    W
                  </span>
                </div>
                <span className="font-display text-[13px] text-white/35">
                  Wooblay
                </span>
              </div>
              <span className="text-white/10">|</span>
              <a
                href="https://x.com/RealWooblay"
                target="_blank"
                rel="noopener noreferrer"
                className="text-white/25 hover:text-white/50 transition-colors"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
            </div>
          </div>
        </FadeIn>
      </div>
    </section>
  )
}
