'use client'

import { FadeIn } from './FadeIn'

export function Closing() {
  return (
    <section className="pt-24 pb-16 relative">
      <div className="absolute inset-0 bg-gradient-to-t from-accent/[0.04] via-transparent to-transparent" />

      <div className="relative max-w-3xl mx-auto px-6 lg:px-8">
        {/* Logos / trust signals */}
        <FadeIn>
          <div className="text-center mb-16">
            <div className="inline-flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-white/20 text-[11px] font-mono">
              <span>SOC 2 Ready</span>
              <span className="text-white/8">&middot;</span>
              <span>HIPAA Compatible</span>
              <span className="text-white/8">&middot;</span>
              <span>GDPR Compliant</span>
              <span className="text-white/8">&middot;</span>
              <span>EU AI Act Aligned</span>
              <span className="text-white/8">&middot;</span>
              <span>NIST AI RMF</span>
            </div>
          </div>
        </FadeIn>

        {/* CTA */}
        <FadeIn delay={0.06}>
          <div className="text-center">
            <h2 className="font-display text-[clamp(2rem,5vw,3.5rem)] font-bold tracking-[-0.03em] leading-[0.95]">
              <span className="text-gradient">
                Full agent capability.
              </span>
              <br />
              <span className="text-white/18">
                Complete organizational control.
              </span>
            </h2>
            <p className="mt-6 text-white/40 text-[15px] max-w-lg mx-auto">
              Your agents keep their power. Your org keeps control. Every action verified, every credential isolated, every decision cryptographically recorded.
            </p>
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
          </div>
        </FadeIn>

        {/* Footer */}
        <FadeIn delay={0.12}>
          <div className="mt-28 pt-6 border-t border-white/[0.04]">
            <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-white/20 text-[11px] font-mono mb-6">
              <span>Policy engine</span>
              <span className="text-white/8">&middot;</span>
              <span>Credential isolation</span>
              <span className="text-white/8">&middot;</span>
              <span>Human approvals</span>
              <span className="text-white/8">&middot;</span>
              <span>Receipt chain</span>
              <span className="text-white/8">&middot;</span>
              <span>Agent-agnostic</span>
            </div>

            <div className="flex justify-center items-center gap-6">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded bg-accent/15 border border-accent/20 flex items-center justify-center">
                  <span className="text-accent text-[8px] font-bold font-display">W</span>
                </div>
                <span className="font-display text-[13px] text-white/35">Wooblay</span>
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
              <span className="text-white/10">|</span>
              <a
                href="mailto:enterprise@wooblay.com"
                className="text-white/25 hover:text-white/50 text-[12px] font-mono transition-colors"
              >
                enterprise@wooblay.com
              </a>
            </div>
          </div>
        </FadeIn>
      </div>
    </section>
  )
}
