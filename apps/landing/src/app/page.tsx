import { Nav } from './components/Nav'
import { Hero } from './components/Hero'
import { WhySection } from './components/WhySection'
import { NotEnough } from './components/NotEnough'
import { HowItWorks } from './components/HowItWorks'
import { Features } from './components/Features'
import { Services } from './components/Services'
import { Closing } from './components/Closing'

export default function Home() {
  return (
    <main className="min-h-screen">
      <Nav />
      <Hero />
      <WhySection />
      <NotEnough />
      <HowItWorks />
      <Features />
      <Services />
      <Closing />
    </main>
  )
}
