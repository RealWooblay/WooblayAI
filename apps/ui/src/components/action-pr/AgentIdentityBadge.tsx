import clsx from 'clsx';
import { truncatePubkey } from '../../lib/utils.ts';
import { Link } from 'react-router-dom';

interface AgentIdentityBadgeProps {
  agentId: string;
  agentName: string;
  agentPubkey: string;
  status?: 'active' | 'suspended' | 'revoked';
  showPubkey?: boolean;
  size?: 'sm' | 'md';
  linked?: boolean;
}

/** Procedural pastel avatar color from agent name */
function avatarBg(name: string): string {
  const colors = [
    'bg-blue-100 text-blue-700',
    'bg-violet-100 text-violet-700',
    'bg-emerald-100 text-emerald-700',
    'bg-amber-100 text-amber-700',
    'bg-rose-100 text-rose-700',
    'bg-sky-100 text-sky-700',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

export function AgentIdentityBadge({
  agentId,
  agentName,
  agentPubkey,
  status = 'active',
  showPubkey = true,
  size = 'sm',
  linked = true,
}: AgentIdentityBadgeProps) {
  const initials = agentName.slice(0, 2).toUpperCase();
  const colorClasses = avatarBg(agentName);

  const content = (
    <div className={clsx(
      'inline-flex items-center gap-2 rounded-lg transition-colors',
      linked && 'hover:bg-stone-50',
      size === 'sm' && 'px-1.5 py-0.5',
      size === 'md' && 'px-2 py-1',
    )}>
      {/* Avatar */}
      <div className="relative">
        <div className={clsx(
          'flex items-center justify-center rounded-md font-bold',
          colorClasses,
          size === 'sm' && 'h-6 w-6 text-[10px]',
          size === 'md' && 'h-8 w-8 text-xs',
        )}>
          {initials}
        </div>
        {/* Status indicator */}
        <div className={clsx(
          'absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-white',
          size === 'sm' && 'h-2.5 w-2.5',
          size === 'md' && 'h-3 w-3',
          status === 'active' && 'bg-green-500',
          status === 'suspended' && 'bg-amber-500',
          status === 'revoked' && 'bg-stone-400',
        )} />
      </div>

      {/* Name + key */}
      <div className="min-w-0">
        <div className={clsx(
          'font-semibold text-stone-900 leading-tight',
          size === 'sm' && 'text-xs',
          size === 'md' && 'text-sm',
        )}>
          {agentName}
        </div>
        {showPubkey && (
          <div className="font-mono text-[10px] text-stone-400 leading-tight">
            {truncatePubkey(agentPubkey)}
          </div>
        )}
      </div>
    </div>
  );

  if (linked) {
    return (
      <Link to={`/agents/${agentId}`} className="no-underline">
        {content}
      </Link>
    );
  }
  return content;
}
