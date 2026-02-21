import { Nav } from './components/Nav'
import { Hero } from './components/Hero'
import { WhySection } from './components/WhySection'
import { HowItWorks } from './components/HowItWorks'
import { BringYourOwn } from './components/BringYourOwn'
import { Features } from './components/Features'
import { Services } from './components/Services'
import { Closing } from './components/Closing'

export default function Home() {
  return (
    <main className="min-h-screen">
      <Nav />
      <Hero />
      <WhySection />
      <HowItWorks />
      <BringYourOwn />
      <Features />
      <Services />
      <Closing />
    </main>
  )
}
