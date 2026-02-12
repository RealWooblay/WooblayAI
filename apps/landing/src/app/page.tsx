import { Nav } from './components/Nav'
import { Hero } from './components/Hero'
import { WhySection } from './components/WhySection'
import { HowItWorks } from './components/HowItWorks'
import { Features } from './components/Features'
import { Closing } from './components/Closing'

export default function Home() {
  return (
    <main className="min-h-screen">
      <Nav />
      <Hero />
      <WhySection />
      <HowItWorks />
      <Features />
      <Closing />
    </main>
  )
}
