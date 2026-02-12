/**
 * ComingSoon — overlay for non-MVP features.
 * Wraps existing page content and fades it behind a centered "Coming Soon" badge.
 */
export function ComingSoon({
  feature,
  description,
  children,
}: {
  feature: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="relative h-full">
      {/* Faded content underneath */}
      {children && (
        <div className="opacity-20 pointer-events-none select-none blur-[1px]">
          {children}
        </div>
      )}

      {/* Overlay */}
      <div className="absolute inset-0 flex items-center justify-center z-10">
        <div className="text-center max-w-md px-6">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-accent-subtle border border-accent/20 mb-4">
            <span className="h-2 w-2 rounded-full bg-accent animate-breathe" />
            <span className="text-xs font-semibold text-accent-bright tracking-wider uppercase">
              Coming Soon
            </span>
          </div>
          <h2 className="text-lg font-bold text-text-primary mt-2">{feature}</h2>
          {description && (
            <p className="text-sm text-text-secondary mt-2 leading-relaxed">
              {description}
            </p>
          )}
          <p className="text-xs text-text-muted mt-4">
            This feature is partially built and will be available in a future release.
          </p>
        </div>
      </div>
    </div>
  );
}
