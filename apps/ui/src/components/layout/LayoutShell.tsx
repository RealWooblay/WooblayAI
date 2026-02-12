import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

/* ------------------------------------------------------------------ */
/*  Inspector context – allows any child to open/close the inspector  */
/* ------------------------------------------------------------------ */

interface InspectorState {
  isOpen: boolean;
  content: ReactNode | null;
  title: string;
  footer: ReactNode | null;
}

interface InspectorContextValue {
  inspector: InspectorState;
  openInspector: (opts: { title: string; content: ReactNode; footer?: ReactNode }) => void;
  closeInspector: () => void;
}

const InspectorContext = createContext<InspectorContextValue | null>(null);

export function useInspector() {
  const ctx = useContext(InspectorContext);
  if (!ctx) throw new Error('useInspector must be used inside LayoutShell');
  return ctx;
}

/* ------------------------------------------------------------------ */
/*  Shell                                                             */
/* ------------------------------------------------------------------ */

interface LayoutShellProps {
  sidebar: ReactNode;
  children: ReactNode;
}

export function LayoutShell({ sidebar, children }: LayoutShellProps) {
  const [inspector, setInspector] = useState<InspectorState>({
    isOpen: false,
    content: null,
    title: '',
    footer: null,
  });

  const openInspector = useCallback(
    (opts: { title: string; content: ReactNode; footer?: ReactNode }) => {
      setInspector({ isOpen: true, content: opts.content, title: opts.title, footer: opts.footer ?? null });
    },
    [],
  );

  const closeInspector = useCallback(() => {
    setInspector((prev) => ({ ...prev, isOpen: false }));
  }, []);

  return (
    <InspectorContext.Provider value={{ inspector, openInspector, closeInspector }}>
      <div className="flex h-screen overflow-hidden bg-surface-0">
        {/* Sidebar */}
        {sidebar}

        {/* Main content area */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>

        {/* Inspector panel */}
        {inspector.isOpen && (
          <aside className="w-[420px] flex-shrink-0 border-l border-stone-200 bg-white flex flex-col animate-slide-in-right overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-stone-200">
              <h3 className="text-sm font-semibold text-stone-900 truncate">{inspector.title}</h3>
              <button
                onClick={closeInspector}
                className="rounded-md p-1 text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors cursor-pointer"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {inspector.content}
            </div>

            {/* Sticky footer */}
            {inspector.footer && (
              <div className="border-t border-stone-200 px-5 py-3 bg-stone-50">
                {inspector.footer}
              </div>
            )}
          </aside>
        )}
      </div>
    </InspectorContext.Provider>
  );
}
