'use client'

import { useState, useEffect } from 'react'

export function Nav() {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 30)
    window.addEventListener('scroll', fn)
    return () => window.removeEventListener('scroll', fn)
  }, [])

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
        scrolled
          ? 'bg-surface-0/70 backdrop-blur-2xl border-b border-white/[0.06]'
          : ''
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 lg:px-8 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-accent/15 border border-accent/25 flex items-center justify-center">
            <span className="text-accent font-bold text-[10px] font-display">W</span>
          </div>
          <span className="font-display font-semibold text-white tracking-tight">
            Wooblay
          </span>
        </div>
        <a
          href="#request-access"
          className="text-[13px] font-medium px-4 py-1.5 rounded-md bg-accent text-surface-0 hover:bg-accent/90 transition-colors"
        >
          Request access
        </a>
      </div>
    </nav>
  )
}
