/**
 * WeatherBackground — Trust-score driven ambient weather.
 *
 * Fixed position, covers full viewport. Sidebar renders on top.
 *
 * 0-20:   storm   — red drops + ⚡ lightning flashes
 * 20-40:  rain    — blue ASCII drops falling
 * 40-60:  cloudy  — grey ~ wisps drifting across screen
 * 60-80:  sunny   — warm ✦ * floating upward
 * 80-100: rainbow — multi-color ★ ✦ ◇ drifting
 */

import { useMemo, useState, useEffect } from 'react';

export type Weather = 'storm' | 'rain' | 'cloudy' | 'sunny' | 'rainbow';

export function trustToWeather(trust: number): Weather {
  if (trust <= 20) return 'storm';
  if (trust <= 40) return 'rain';
  if (trust <= 60) return 'cloudy';
  if (trust <= 80) return 'sunny';
  return 'rainbow';
}

const RAIN_CHARS = ['·', '.', ':', '|', '/'];
const STORM_CHARS = ['|', '/', '⚡', ':', '·'];
const CLOUD_CHARS = ['~', '≈', '·', '-', '~', '≈'];
const SUNNY_CHARS = ['✦', '*', '·', '✦', '*', '·', '✦'];
const RAINBOW_CHARS = ['★', '✦', '◇', '·', '★', '✦', '◇'];

const RAINBOW_COLORS = [
  'rgba(248,113,113,0.6)', 'rgba(251,146,60,0.6)', 'rgba(250,204,21,0.6)',
  'rgba(52,211,153,0.6)', 'rgba(96,165,250,0.6)', 'rgba(167,139,250,0.6)',
];

export function WeatherBackground({ weather }: { weather: Weather }) {
  // Lightning
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (weather !== 'storm') { setFlash(false); return; }
    let mounted = true;
    const tick = () => {
      if (!mounted) return;
      setFlash(true);
      setTimeout(() => { if (mounted) setFlash(false); }, 100);
      setTimeout(() => { if (mounted) { setFlash(true); setTimeout(() => { if (mounted) setFlash(false); }, 60); } }, 180);
      setTimeout(tick, 2500 + Math.random() * 4000);
    };
    const t = setTimeout(tick, 1000);
    return () => { mounted = false; clearTimeout(t); };
  }, [weather]);

  // Falling drops (rain & storm)
  const drops = useMemo(() => {
    if (weather !== 'rain' && weather !== 'storm') return [];
    const chars = weather === 'storm' ? STORM_CHARS : RAIN_CHARS;
    const count = weather === 'storm' ? 50 : 28;
    return Array.from({ length: count }, (_, i) => ({
      left: (i / count) * 100 + (Math.random() * 8 - 4),
      char: chars[Math.floor(Math.random() * chars.length)],
      dur: weather === 'storm' ? 0.8 + Math.random() * 1.2 : 1.8 + Math.random() * 2.5,
      delay: Math.random() * -4,
      size: weather === 'storm' ? 16 : 12,
    }));
  }, [weather]);

  // Floating particles (cloudy, sunny, rainbow) — use real movement animations
  const floaters = useMemo(() => {
    if (weather === 'rain' || weather === 'storm') return [];
    const chars = weather === 'rainbow' ? RAINBOW_CHARS : weather === 'sunny' ? SUNNY_CHARS : CLOUD_CHARS;
    const count = weather === 'rainbow' ? 30 : weather === 'sunny' ? 25 : 20;
    return Array.from({ length: count }, (_, i) => {
      const isSunny = weather === 'sunny';
      const isRainbow = weather === 'rainbow';
      return {
        left: Math.random() * 100,
        char: chars[i % chars.length],
        dur: isSunny ? 4 + Math.random() * 6 : isRainbow ? 3 + Math.random() * 5 : 5 + Math.random() * 7,
        delay: -(Math.random() * 8),
        size: isRainbow ? 16 : isSunny ? 15 : 12,
        // For sunny: float upward. For cloudy/rainbow: drift sideways
        anim: isSunny ? 'weather-float-up' : 'weather-drift',
        color: isRainbow
          ? RAINBOW_COLORS[i % RAINBOW_COLORS.length]
          : isSunny
          ? 'rgba(251,191,36,0.7)'
          : 'rgba(148,163,184,0.4)',
      };
    });
  }, [weather]);

  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none" style={{ zIndex: 0 }}>
      {/* Ambient gradient */}
      {weather === 'storm' && (
        <div className="absolute inset-0 bg-gradient-to-b from-red-500/[0.15] via-red-900/[0.06] to-transparent"
          style={{ animation: 'pulse 2.5s ease-in-out infinite' }} />
      )}
      {weather === 'rain' && (
        <div className="absolute inset-0 bg-gradient-to-b from-blue-500/[0.10] via-blue-500/[0.04] to-transparent" />
      )}
      {weather === 'cloudy' && (
        <div className="absolute inset-0 bg-gradient-to-b from-slate-400/[0.08] via-slate-500/[0.03] to-transparent" />
      )}
      {weather === 'sunny' && (
        <div className="absolute inset-0 bg-gradient-to-b from-amber-400/[0.14] via-amber-500/[0.05] to-transparent" />
      )}
      {weather === 'rainbow' && (
        <div className="absolute inset-0"
          style={{ background: 'linear-gradient(135deg, rgba(248,113,113,0.08), rgba(251,191,36,0.08), rgba(52,211,153,0.08), rgba(96,165,250,0.08), rgba(167,139,250,0.08))' }} />
      )}

      {/* Lightning */}
      {weather === 'storm' && flash && <div className="absolute inset-0 bg-white/[0.12]" />}

      {/* Falling drops */}
      {drops.map((d, i) => (
        <span key={`d${i}`}
          className={`absolute font-mono ${weather === 'storm' ? 'text-red-400/60' : 'text-blue-400/50'}`}
          style={{
            left: `${d.left}%`, top: '-20px', fontSize: d.size,
            animation: `rain-fall ${d.dur}s linear ${d.delay}s infinite`,
          }}>
          {d.char}
        </span>
      ))}

      {/* Floating particles — actually move! */}
      {floaters.map((p, i) => (
        <span key={`f${i}`}
          className="absolute font-mono"
          style={{
            left: `${p.left}%`,
            bottom: p.anim === 'weather-float-up' ? '-20px' : undefined,
            top: p.anim === 'weather-drift' ? `${Math.random() * 80}%` : undefined,
            fontSize: p.size,
            color: p.color,
            animation: `${p.anim} ${p.dur}s ease-in-out ${p.delay}s infinite`,
          }}>
          {p.char}
        </span>
      ))}

      <div className="scanline-overlay" />
    </div>
  );
}
