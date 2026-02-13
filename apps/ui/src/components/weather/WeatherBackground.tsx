/**
 * WeatherBackground — Trust-score driven ambient weather.
 *
 * Uses position:fixed so it covers the FULL main viewport (no margin gaps).
 * The sidebar (220px, z-above) renders on top naturally.
 *
 * Scale (trust score → weather):
 *   0-20:   storm   — red drops, ⚡ lightning flashes
 *   20-40:  rain    — blue ASCII drops falling
 *   40-60:  cloudy  — grey drifting ~ wisps
 *   60-80:  sunny   — warm ✦ and * sparkles
 *   80-100: rainbow — multi-color ★ ✦ ◇ particles
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

const RAIN_CHARS = ['·', '.', ':', '|', '/'];
const STORM_CHARS = ['|', '/', '⚡', ':', '·'];
const CLOUD_CHARS = ['~', '≈', '·', '-', '~'];
const SUNNY_CHARS = ['✦', '*', '·', '✦', '*', '·'];
const RAINBOW_CHARS = ['★', '✦', '◇', '·', '★', '✦'];

const RAINBOW_COLORS = [
  'text-red-400/40', 'text-orange-400/40', 'text-amber-400/40',
  'text-emerald-400/40', 'text-blue-400/40', 'text-violet-400/40',
];

export function WeatherBackground({ weather }: { weather: Weather }) {
  // ── Lightning flash for storm ─────────────────────────────────────────────
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (weather !== 'storm') { setFlash(false); return; }
    let mounted = true;
    const tick = () => {
      if (!mounted) return;
      setFlash(true);
      setTimeout(() => { if (mounted) setFlash(false); }, 100);
      setTimeout(() => {
        if (!mounted) return;
        setFlash(true);
        setTimeout(() => { if (mounted) setFlash(false); }, 60);
      }, 180);
      setTimeout(tick, 2500 + Math.random() * 4000);
    };
    const t = setTimeout(tick, 1000);
    return () => { mounted = false; clearTimeout(t); };
  }, [weather]);

  // ── Falling drops (rain & storm) ──────────────────────────────────────────
  const drops = useMemo(() => {
    if (weather !== 'rain' && weather !== 'storm') return [];
    const chars = weather === 'storm' ? STORM_CHARS : RAIN_CHARS;
    const count = weather === 'storm' ? 50 : 28;
    return Array.from({ length: count }, (_, i) => ({
      left: (i / count) * 100 + (Math.random() * 8 - 4),
      char: chars[Math.floor(Math.random() * chars.length)],
      duration: weather === 'storm' ? 0.8 + Math.random() * 1.2 : 1.8 + Math.random() * 2.5,
      delay: Math.random() * -4,
      size: weather === 'storm' ? 16 : 12,
    }));
  }, [weather]);

  // ── Floating particles (sunny, cloudy, rainbow) ───────────────────────────
  const floaters = useMemo(() => {
    if (weather === 'rain' || weather === 'storm') return [];
    const chars = weather === 'rainbow' ? RAINBOW_CHARS : weather === 'sunny' ? SUNNY_CHARS : CLOUD_CHARS;
    const count = weather === 'rainbow' ? 30 : weather === 'sunny' ? 25 : 18;
    return Array.from({ length: count }, (_, i) => ({
      left: Math.random() * 100,
      top: Math.random() * 100,
      char: chars[i % chars.length],
      duration: 3 + Math.random() * 5,
      delay: Math.random() * -6,
      size: weather === 'rainbow' ? 14 : weather === 'sunny' ? 13 : 11,
      colorClass: weather === 'rainbow'
        ? RAINBOW_COLORS[i % RAINBOW_COLORS.length]
        : weather === 'sunny'
        ? 'text-amber-400/40'
        : 'text-slate-400/25',
    }));
  }, [weather]);

  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none" style={{ zIndex: 0 }}>
      {/* ── Ambient gradient ─────────────────────────────────────────────── */}
      {weather === 'storm' && (
        <div
          className="absolute inset-0 bg-gradient-to-b from-red-500/[0.12] via-red-900/[0.05] to-transparent"
          style={{ animation: 'pulse 2.5s ease-in-out infinite' }}
        />
      )}
      {weather === 'rain' && (
        <div className="absolute inset-0 bg-gradient-to-b from-blue-500/[0.08] via-blue-500/[0.03] to-transparent" />
      )}
      {weather === 'cloudy' && (
        <div className="absolute inset-0 bg-gradient-to-b from-slate-500/[0.06] via-slate-500/[0.02] to-transparent" />
      )}
      {weather === 'sunny' && (
        <div className="absolute inset-0 bg-gradient-to-b from-amber-500/[0.10] via-amber-500/[0.04] to-transparent" />
      )}
      {weather === 'rainbow' && (
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(135deg, rgba(239,68,68,0.06), rgba(245,158,11,0.06), rgba(34,197,94,0.06), rgba(59,130,246,0.06), rgba(139,92,246,0.06))',
          }}
        />
      )}

      {/* ── Lightning flash (storm only) ─────────────────────────────────── */}
      {weather === 'storm' && flash && (
        <div className="absolute inset-0 bg-white/[0.12]" />
      )}

      {/* ── Falling drops (rain / storm) ─────────────────────────────────── */}
      {drops.map((d, i) => (
        <span
          key={`d${i}`}
          className={`absolute font-mono ${
            weather === 'storm' ? 'text-red-400/50' : 'text-blue-400/40'
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
          className={`absolute font-mono ${p.colorClass}`}
          style={{
            left: `${p.left}%`,
            top: `${p.top}%`,
            fontSize: p.size,
            animation: `breathe ${p.duration}s ease-in-out infinite`,
          }}
        >
          {p.char}
        </span>
      ))}

      {/* ── CRT scanline sweep ───────────────────────────────────────────── */}
      <div className="scanline-overlay" />
    </div>
  );
}
