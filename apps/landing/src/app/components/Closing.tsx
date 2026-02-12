'use client'

import { FadeIn } from './FadeIn'

/**
 * Combines social proof + CTA + deployment info into one closing section.
 * No more 3 separate identical sections.
 */
export function Closing() {
  return (
    <section id="request-access" className="pt-24 pb-16 relative">
      <div className="absolute inset-0 bg-gradient-to-t from-accent/[0.04] via-transparent to-transparent" />

      <div className="relative max-w-3xl mx-auto px-6 lg:px-8">
        {/* Quote */}
        <FadeIn>
          <blockquote className="text-center mb-28">
            <p className="font-display text-[clamp(1.6rem,3.5vw,2.5rem)] font-medium leading-[1.25] tracking-tight text-white/70">
              &ldquo;I finally know what my agent is doing.&rdquo;
            </p>
            <p className="text-white/25 font-mono text-[13px] mt-5">
              &mdash; Early access user
            </p>
          </blockquote>
        </FadeIn>

        {/* CTA */}
        <FadeIn delay={0.08}>
          <div className="text-center">
            <h2 className="font-display text-[clamp(2.2rem,5vw,3.8rem)] font-bold tracking-[-0.03em] leading-[0.95]">
              <span className="text-gradient">
                If an agent can change&nbsp;it,
              </span>
              <br />
              <span className="text-white/18">
                you should be able to rewind&nbsp;it.
              </span>
            </h2>

            <form
              onSubmit={(e) => e.preventDefault()}
              className="mt-10 flex justify-center gap-3"
            >
              <input
                type="email"
                placeholder="you@company.com"
                className="w-full max-w-[250px] px-4 py-3 rounded-md bg-white/[0.04] border border-white/[0.1] text-[14px] text-white/80 placeholder:text-white/25 focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/15 transition-all"
              />
              <button
                type="submit"
                className="px-6 py-3 rounded-md bg-accent text-surface-0 font-semibold text-[14px] hover:bg-accent/90 transition-colors shrink-0"
              >
                Request access
              </button>
            </form>
          </div>
        </FadeIn>

        {/* Deployment info as footer strip */}
        <FadeIn delay={0.15}>
          <div className="mt-28 pt-6 border-t border-white/[0.04] flex flex-wrap justify-center gap-x-6 gap-y-2 text-white/25 text-[11px] font-mono">
            <span>Private instances</span>
            <span className="text-white/10">&middot;</span>
            <span>Works with OpenClaw</span>
            <span className="text-white/10">&middot;</span>
            <span>Data isolation by default</span>
          </div>
        </FadeIn>

        {/* Logo */}
        <FadeIn delay={0.18}>
          <div className="mt-8 flex justify-center items-center gap-2">
            <div className="w-5 h-5 rounded bg-accent/15 border border-accent/20 flex items-center justify-center">
              <span className="text-accent text-[8px] font-bold font-display">
                W
              </span>
            </div>
            <span className="font-display text-[13px] text-white/35">
              Wooblay
            </span>
          </div>
        </FadeIn>
      </div>
    </section>
  )
}
