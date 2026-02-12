import { Routes, Route } from 'react-router-dom';
import { Sidebar } from './components/layout/Sidebar.tsx';
import { CommandPalette } from './components/command/CommandPalette.tsx';
import { ComingSoon } from './components/common/ComingSoon.tsx';

// Core MVP pages
import { CommandCenter } from './pages/command-center/CommandCenter.tsx';
import { ApprovalsPage } from './pages/approvals/ApprovalsPage.tsx';
import { InstancesPage } from './pages/instances/InstancesPage.tsx';

export default function App() {
  return (
    <div className="h-screen flex bg-void overflow-hidden">
      <Sidebar />

      <main className="flex-1 overflow-hidden relative">
        <Routes>
          {/* Core MVP */}
          <Route path="/" element={<CommandCenter />} />
          <Route path="/approvals" element={<PageShell><ApprovalsPage /></PageShell>} />
          <Route path="/instances" element={<PageShell><InstancesPage /></PageShell>} />

          {/* Coming Soon */}
          <Route path="/policies" element={<PageShell><ComingSoon feature="Policies" description="Custom policy rules for fine-grained tool control." /></PageShell>} />
          <Route path="/agents" element={<PageShell><ComingSoon feature="Agents" description="Agent identity management and trust scoring." /></PageShell>} />
          <Route path="/activity" element={<PageShell><ComingSoon feature="Activity Feed" description="Real-time agent activity monitoring." /></PageShell>} />
          <Route path="/audit" element={<PageShell><ComingSoon feature="Audit Trail" description="AI-powered anomaly detection and auto-flagging." /></PageShell>} />
          <Route path="/receipts" element={<PageShell><ComingSoon feature="Receipt Vault" description="Cryptographically signed receipts for every action." /></PageShell>} />
          <Route path="/scoring" element={<PageShell><ComingSoon feature="Task Scoring" description="Label and score agent task outcomes." /></PageShell>} />
          <Route path="/settings" element={<PageShell><ComingSoon feature="Settings" description="Configure Wooblay preferences." /></PageShell>} />
        </Routes>
      </main>

      <CommandPalette />
    </div>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full overflow-y-auto p-6 canvas-bg animate-fade-in">
      {children}
    </div>
  );
}
