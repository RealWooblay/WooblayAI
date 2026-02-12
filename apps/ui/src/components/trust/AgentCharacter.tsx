import clsx from 'clsx';

interface AgentCharacterProps {
  name: string;
  status: 'active' | 'suspended' | 'revoked';
  trustScore: number;
  size?: 'sm' | 'md' | 'lg';
}

/** Generate deterministic avatar gradient from name */
function getGradient(name: string): [string, string] {
  const gradients: [string, string][] = [
    ['#06b6d4', '#3b82f6'], // cyan -> blue
    ['#8b5cf6', '#d946ef'], // violet -> fuchsia
    ['#10b981', '#06b6d4'], // emerald -> cyan
    ['#f59e0b', '#ef4444'], // amber -> red
    ['#ec4899', '#8b5cf6'], // pink -> violet
    ['#06b6d4', '#8b5cf6'], // cyan -> violet
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return gradients[Math.abs(hash) % gradients.length];
}

/** Get a character shape based on the name */
function getShape(name: string): string {
  const shapes = ['hexagon', 'circle', 'diamond', 'pentagon', 'octagon'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 3) - hash);
  return shapes[Math.abs(hash) % shapes.length];
}

function HexClipPath() {
  return (
    <clipPath id="hex-clip">
      <polygon points="50,2 95,25 95,75 50,98 5,75 5,25" />
    </clipPath>
  );
}

export function AgentCharacter({ name, status, trustScore, size = 'md' }: AgentCharacterProps) {
  const [color1, color2] = getGradient(name);
  const shape = getShape(name);
  const isAlive = status === 'active';
  const initials = name.slice(0, 2).toUpperCase();

  const sizeMap = { sm: 48, md: 80, lg: 120 };
  const s = sizeMap[size];
  const coreSize = s * 0.7;
  const fontSize = size === 'sm' ? 14 : size === 'md' ? 22 : 36;

  // Pulse intensity based on trust score
  const pulseOpacity = isAlive ? 0.2 + (trustScore / 100) * 0.5 : 0;

  return (
    <div
      className={clsx(
        'relative flex items-center justify-center',
        isAlive && 'animate-breathe',
      )}
      style={{ width: s, height: s }}
    >
      {/* Outer glow ring */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: `radial-gradient(circle, ${color1}${Math.round(pulseOpacity * 255).toString(16).padStart(2, '0')}, transparent 70%)`,
          filter: isAlive ? 'blur(8px)' : 'none',
        }}
      />

      {/* Outer ring */}
      <svg width={s} height={s} viewBox="0 0 100 100" className="absolute inset-0">
        <defs>
          <linearGradient id={`grad-${name}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={color1} />
            <stop offset="100%" stopColor={color2} />
          </linearGradient>
          <HexClipPath />
        </defs>

        {/* Background shape */}
        {shape === 'hexagon' ? (
          <polygon
            points="50,2 95,25 95,75 50,98 5,75 5,25"
            fill="none"
            stroke={`url(#grad-${name})`}
            strokeWidth="2"
            opacity={isAlive ? 0.8 : 0.2}
          />
        ) : shape === 'diamond' ? (
          <polygon
            points="50,5 95,50 50,95 5,50"
            fill="none"
            stroke={`url(#grad-${name})`}
            strokeWidth="2"
            opacity={isAlive ? 0.8 : 0.2}
          />
        ) : (
          <circle
            cx="50" cy="50" r="46"
            fill="none"
            stroke={`url(#grad-${name})`}
            strokeWidth="2"
            opacity={isAlive ? 0.8 : 0.2}
          />
        )}

        {/* Inner fill */}
        <circle
          cx="50" cy="50" r="35"
          fill={isAlive ? `${color1}15` : '#0c0c14'}
          stroke={isAlive ? `${color1}30` : '#1e1e30'}
          strokeWidth="1"
        />

        {/* Scanning line animation for alive agents */}
        {isAlive && (
          <line
            x1="15" y1="50" x2="85" y2="50"
            stroke={color1}
            strokeWidth="0.5"
            opacity="0.3"
          >
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 50 50"
              to="360 50 50"
              dur="8s"
              repeatCount="indefinite"
            />
          </line>
        )}
      </svg>

      {/* Core content */}
      <div
        className={clsx(
          'relative flex items-center justify-center rounded-full z-10',
          !isAlive && 'grayscale opacity-40',
        )}
        style={{
          width: coreSize,
          height: coreSize,
        }}
      >
        <span
          className="font-bold select-none"
          style={{
            fontSize,
            background: `linear-gradient(135deg, ${color1}, ${color2})`,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          {initials}
        </span>
      </div>

      {/* Status dot */}
      <div className={clsx(
        'absolute bottom-0 right-0 rounded-full border-2 border-[#0c0c14] z-20',
        size === 'sm' && 'h-3 w-3',
        size === 'md' && 'h-4 w-4',
        size === 'lg' && 'h-5 w-5',
        status === 'active' && 'bg-emerald-500',
        status === 'suspended' && 'bg-amber-500',
        status === 'revoked' && 'bg-gray-600',
      )}>
        {isAlive && (
          <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-40" />
        )}
      </div>
    </div>
  );
}
