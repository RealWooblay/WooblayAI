'use client'

import { FadeIn } from './FadeIn'
import { CheckpointTimeline } from './CheckpointTimeline'

/**
 * The timeline runs in a full-width strip.
 * Text lives below, not beside. Different from every other section.
 */
export function FeatureRewind() {
  return (
    <section className="py-24">
      {/* Full-width strip */}
      <FadeIn>
        <div className="border-y border-white/[0.04] py-12">
          <div className="max-w-3xl mx-auto px-6 lg:px-8">
            <CheckpointTimeline />
          </div>
        </div>
      </FadeIn>

      <FadeIn delay={0.1}>
        <div className="text-center mt-10 px-6">
          <h3 className="font-display text-[22px] sm:text-[26px] font-bold text-white tracking-tight">
            Undo with one click
          </h3>
          <p className="text-white/45 text-[14px] mt-2">
            Every action checkpointed. Click to rewind.
          </p>
        </div>
      </FadeIn>
    </section>
  )
}
