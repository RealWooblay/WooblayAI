/**
 * WeatherBackground — Trust-score driven ambient weather.
 *
 * Scale (trust score → weather):
 *   0-20:   storm   — red drops, lightning flashes, aggressive
 *   20-40:  rain    — blue drops falling, cool gradient
 *   40-60:  cloudy  — grey/indigo floating particles
 *   60-80:  sunny   — warm amber floating particles
 *   80-100: rainbow — multi-color shifting particles, celebration
 *
 * Dashboard = average trust of all agents.
 * Instance detail = individual agent trust.
 */

import { useMemo, useState, useEffect } from 'react';

export type Weather = 'storm' | 'rain' | 'cloudy' | 'sunny' | 'rainbow';

/** Convert a trust score (0-100) to a weather state. */
export function trustToWeather(trust: number): Weather {
  if (trust <= 20) return 'storm';
  if (trust <= 40) return 'rain';
  if (trust <= 60) return 'cloudy';
  if (trust <= 80) return 'sunny';
  return 'rainbow';
}

const RAIN_CHARS = '·.:|/';
const FLOAT_CHAR = '·';
const RAINBOW_COLORS = [
  'text-red-400/25', 'text-orange-400/25', 'text-amber-400/25',
  'text-emerald-400/25', 'text-blue-400/25', 'text-violet-400/25',
];

export function WeatherBackground({ weather }: { weather: Weather }) {
  // ── Lightning flash for storm ─────────────────────────────────────────────
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (weather !== 'storm') return;
    const interval = setInterval(() => {
      setFlash(true);
      setTimeout(() => setFlash(false), 120);
      // Double flash
      setTimeout(() => {
        setFlash(true);
        setTimeout(() => setFlash(false), 80);
      }, 200);
    }, 3000 + Math.random() * 4000);
    return () => clearInterval(interval);
  }, [weather]);

  // ── Falling drops (rain & storm) ──────────────────────────────────────────
  const drops = useMemo(() => {
    if (weather !== 'rain' && weather !== 'storm') return [];
    const count = weather === 'storm' ? 50 : 24;
    return Array.from({ length: count }, (_, i) => ({
      left: (i / count) * 100 + (Math.random() * 6 - 3),
      char: RAIN_CHARS[Math.floor(Math.random() * RAIN_CHARS.length)],
      duration: weather === 'storm' ? 1 + Math.random() * 1.5 : 1.8 + Math.random() * 2.5,
      delay: Math.random() * -4,
      size: weather === 'storm' ? 14 : 11,
    }));
  }, [weather]);

  // ── Floating particles (sunny, cloudy, rainbow) ───────────────────────────
  const floaters = useMemo(() => {
    if (weather === 'rain' || weather === 'storm') return [];
    const count = weather === 'rainbow' ? 25 : weather === 'sunny' ? 20 : 14;
    return Array.from({ length: count }, (_, i) => ({
      left: Math.random() * 100,
      top: Math.random() * 100,
      duration: 3 + Math.random() * 5,
      delay: Math.random() * -6,
      colorClass: weather === 'rainbow'
        ? RAINBOW_COLORS[i % RAINBOW_COLORS.length]
        : weather === 'sunny'
        ? 'text-amber-400/30'
        : 'text-indigo-400/20',
    }));
  }, [weather]);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
      {/* ── Ambient gradient ─────────────────────────────────────────────── */}
      {weather === 'storm' && (
        <div
          className="absolute inset-0 bg-gradient-to-b from-red-500/[0.10] via-red-900/[0.04] to-transparent animate-pulse"
          style={{ animationDuration: '2.5s' }}
        />
      )}
      {weather === 'rain' && (
        <div className="absolute inset-0 bg-gradient-to-b from-blue-500/[0.07] via-blue-500/[0.02] to-transparent" />
      )}
      {weather === 'cloudy' && (
        <div className="absolute inset-0 bg-gradient-to-b from-indigo-500/[0.04] via-transparent to-transparent" />
      )}
      {weather === 'sunny' && (
        <div className="absolute inset-0 bg-gradient-to-b from-amber-500/[0.06] via-amber-500/[0.02] to-transparent" />
      )}
      {weather === 'rainbow' && (
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(135deg, rgba(239,68,68,0.04), rgba(245,158,11,0.04), rgba(34,197,94,0.04), rgba(59,130,246,0.04), rgba(139,92,246,0.04))',
          }}
        />
      )}

      {/* ── Lightning flash (storm only) ─────────────────────────────────── */}
      {weather === 'storm' && flash && (
        <div className="absolute inset-0 bg-white/[0.08] transition-opacity" />
      )}

      {/* ── Falling drops (rain / storm) ─────────────────────────────────── */}
      {drops.map((d, i) => (
        <span
          key={`d${i}`}
          className={`absolute font-mono ${
            weather === 'storm' ? 'text-red-400/40' : 'text-blue-400/30'
          }`}
          style={{
            left: `${d.left}%`,
            top: '-20px',
            fontSize: d.size,
            animation: `rain-fall ${d.duration}s linear ${d.delay}s infinite`,
          }}
        >
          {d.char}
        </span>
      ))}

      {/* ── Floating particles (sunny / cloudy / rainbow) ────────────────── */}
      {floaters.map((p, i) => (
        <span
          key={`f${i}`}
          className={`absolute font-mono text-[10px] ${p.colorClass}`}
          style={{
            left: `${p.left}%`,
            top: `${p.top}%`,
            animation: `breathe ${p.duration}s ease-in-out ${p.delay}s infinite`,
          }}
        >
          {FLOAT_CHAR}
        </span>
      ))}

      {/* ── CRT scanline sweep ───────────────────────────────────────────── */}
      <div className="scanline-overlay" />
    </div>
  );
}
