import { Nav } from './components/Nav'
import { Hero } from './components/Hero'
import { WhySection } from './components/WhySection'
import { ThreePromises } from './components/ThreePromises'
import { FeatureRewind } from './components/FeatureRewind'
import { Closing } from './components/Closing'

export default function Home() {
  return (
    <main className="min-h-screen">
      <Nav />
      <Hero />
      <WhySection />
      <ThreePromises />
      <FeatureRewind />
      <Closing />
    </main>
  )
}
