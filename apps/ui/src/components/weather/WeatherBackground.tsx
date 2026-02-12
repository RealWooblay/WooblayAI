/**
 * WeatherBackground — Shared ambient weather system.
 *
 * Renders visible animated effects based on agent performance:
 *   sunny  → warm amber floating particles, golden gradient
 *   cloudy → cool indigo drifting particles, dim gradient
 *   rain   → blue ASCII drops falling, cool gradient
 *   storm  → red ASCII drops falling fast, pulsing gradient
 *
 * ALL states render something visible. No invisible 2% opacity.
 */

import { useMemo } from 'react';

export type Weather = 'sunny' | 'cloudy' | 'rain' | 'storm';

const RAIN_CHARS = '·.:|/';
const FLOAT_CHAR = '·';

export function WeatherBackground({ weather }: { weather: Weather }) {
  // ── Falling drops (rain & storm only) ─────────────────────────────────────
  const drops = useMemo(() => {
    if (weather !== 'rain' && weather !== 'storm') return [];
    const count = weather === 'storm' ? 40 : 24;
    return Array.from({ length: count }, (_, i) => ({
      left: (i / count) * 100 + (Math.random() * 6 - 3),
      char: RAIN_CHARS[Math.floor(Math.random() * RAIN_CHARS.length)],
      duration: 1.8 + Math.random() * 2.5,
      delay: Math.random() * -4,
      size: weather === 'storm' ? 14 : 11,
    }));
  }, [weather]);

  // ── Floating particles (sunny & cloudy) ───────────────────────────────────
  const floaters = useMemo(() => {
    if (weather === 'rain' || weather === 'storm') return [];
    const count = weather === 'sunny' ? 20 : 14;
    return Array.from({ length: count }, () => ({
      left: Math.random() * 100,
      top: Math.random() * 100,
      duration: 3 + Math.random() * 5,
      delay: Math.random() * -6,
    }));
  }, [weather]);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
      {/* ── Ambient gradient ─────────────────────────────────────────────── */}
      {weather === 'sunny' && (
        <div className="absolute inset-0 bg-gradient-to-b from-amber-500/[0.06] via-amber-500/[0.02] to-transparent" />
      )}
      {weather === 'cloudy' && (
        <div className="absolute inset-0 bg-gradient-to-b from-indigo-500/[0.04] via-transparent to-transparent" />
      )}
      {weather === 'rain' && (
        <div className="absolute inset-0 bg-gradient-to-b from-blue-500/[0.07] via-blue-500/[0.02] to-transparent" />
      )}
      {weather === 'storm' && (
        <div
          className="absolute inset-0 bg-gradient-to-b from-red-500/[0.10] via-red-500/[0.03] to-transparent animate-pulse"
          style={{ animationDuration: '3s' }}
        />
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

      {/* ── Floating particles (sunny / cloudy) ──────────────────────────── */}
      {floaters.map((p, i) => (
        <span
          key={`f${i}`}
          className={`absolute font-mono text-[10px] ${
            weather === 'sunny' ? 'text-amber-400/30' : 'text-indigo-400/20'
          }`}
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
