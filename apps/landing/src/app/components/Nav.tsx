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
        <div className="flex items-center gap-4">
          <a
            href="https://wooblay.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] font-medium text-white/50 hover:text-white/80 transition-colors hidden sm:block"
          >
            Dashboard
          </a>
          <a
            href="https://x.com/RealWooblay"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] font-medium px-4 py-1.5 rounded-md bg-accent text-surface-0 hover:bg-accent/90 transition-colors flex items-center gap-2"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            Follow
          </a>
        </div>
      </div>
    </nav>
  )
}
