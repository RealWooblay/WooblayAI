import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClerkProvider } from '@clerk/clerk-react';
import { ToastProvider } from './components/common/Toast.tsx';
import { ThemeProvider, useTheme } from './contexts/ThemeContext.tsx';
import App from './App.tsx';
import './index.css';

const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? '';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: 1,
    },
  },
});

// Clerk dark theme — matches Wooblay dark UI
const CLERK_APPEARANCE_DARK = {
  baseTheme: undefined,
  variables: {
    colorPrimary: '#6366f1',
    colorBackground: '#111113',
    colorText: '#e4e4e7',
    colorTextSecondary: '#a1a1aa',
    colorInputBackground: '#1a1a1e',
    colorInputText: '#e4e4e7',
    colorDanger: '#ef4444',
    colorSuccess: '#22c55e',
    colorWarning: '#eab308',
    colorNeutral: '#a1a1aa',
    borderRadius: '0.5rem',
  },
  elements: {
    card: 'bg-[#111113] border border-white/10 shadow-xl',
    formButtonPrimary: 'bg-indigo-500 hover:bg-indigo-600',
    footerActionLink: 'text-indigo-400 hover:text-indigo-300',
    organizationSwitcherTrigger: 'text-[#e4e4e7]',
    organizationPreview: 'text-[#e4e4e7]',
    organizationSwitcherTriggerIcon: 'text-[#a1a1aa]',
    organizationPreviewTextContainer: 'text-[#e4e4e7]',
    organizationPreviewSecondaryIdentifier: 'text-[#a1a1aa]',
    organizationSwitcherPopoverCard: 'bg-[#111113] border border-white/10',
    organizationSwitcherPopoverActions: 'text-[#e4e4e7]',
    organizationSwitcherPopoverActionButton: 'text-[#e4e4e7] hover:bg-white/5',
    organizationSwitcherPopoverActionButtonText: 'text-[#e4e4e7]',
    organizationSwitcherPopoverActionButtonIcon: 'text-[#a1a1aa]',
    organizationSwitcherPopoverFooter: 'border-white/10',
    organizationProfilePage: 'text-[#e4e4e7]',
    profilePage: 'text-[#e4e4e7]',
    profileSectionTitle: 'text-[#e4e4e7]',
    profileSectionContent: 'text-[#e4e4e7]',
    profileSectionPrimaryButton: 'text-[#e4e4e7]',
    membersPageInviteButton: 'bg-indigo-500 hover:bg-indigo-600',
    tableHead: 'text-[#a1a1aa]',
    tableCell: 'text-[#e4e4e7]',
    tagInputContainer: 'bg-[#1a1a1e] border-white/10 text-[#e4e4e7]',
    formFieldInput: 'bg-[#1a1a1e] border-white/10 text-[#e4e4e7]',
    formFieldLabel: 'text-[#a1a1aa]',
    badge: 'text-[#e4e4e7]',
    breadcrumbs: 'text-[#a1a1aa]',
    breadcrumbsItem: 'text-[#a1a1aa]',
    breadcrumbsItemDivider: 'text-[#52525b]',
    modalContent: 'bg-[#111113] border border-white/10',
    modalBackdrop: 'bg-black/60',
    navbarButton: 'text-[#e4e4e7]',
    headerTitle: 'text-[#e4e4e7]',
    headerSubtitle: 'text-[#a1a1aa]',
  },
};

// Clerk light theme — matches Wooblay light UI
const CLERK_APPEARANCE_LIGHT = {
  baseTheme: undefined,
  variables: {
    colorPrimary: '#6366f1',
    colorBackground: '#fafafa',
    colorText: '#18181b',
    colorTextSecondary: '#52525b',
    colorInputBackground: '#ffffff',
    colorInputText: '#18181b',
    colorDanger: '#dc2626',
    colorSuccess: '#16a34a',
    colorWarning: '#ca8a04',
    colorNeutral: '#52525b',
    borderRadius: '0.5rem',
  },
  elements: {
    card: 'bg-white border border-zinc-200 shadow-xl',
    formButtonPrimary: 'bg-indigo-500 hover:bg-indigo-600',
    footerActionLink: 'text-indigo-600 hover:text-indigo-700',
    organizationSwitcherTrigger: 'text-[#18181b]',
    organizationPreview: 'text-[#18181b]',
    organizationSwitcherTriggerIcon: 'text-[#52525b]',
    organizationPreviewTextContainer: 'text-[#18181b]',
    organizationPreviewSecondaryIdentifier: 'text-[#52525b]',
    organizationSwitcherPopoverCard: 'bg-white border border-zinc-200 shadow-xl',
    organizationSwitcherPopoverActions: 'text-[#18181b]',
    organizationSwitcherPopoverActionButton: 'text-[#18181b] hover:bg-zinc-50',
    organizationSwitcherPopoverActionButtonText: 'text-[#18181b]',
    organizationSwitcherPopoverActionButtonIcon: 'text-[#52525b]',
    organizationSwitcherPopoverFooter: 'border-zinc-200',
    organizationProfilePage: 'text-[#18181b]',
    profilePage: 'text-[#18181b]',
    profileSectionTitle: 'text-[#18181b]',
    profileSectionContent: 'text-[#18181b]',
    profileSectionPrimaryButton: 'text-[#18181b]',
    membersPageInviteButton: 'bg-indigo-500 hover:bg-indigo-600',
    tableHead: 'text-[#52525b]',
    tableCell: 'text-[#18181b]',
    tagInputContainer: 'bg-white border border-zinc-200 text-[#18181b]',
    formFieldInput: 'bg-white border border-zinc-200 text-[#18181b]',
    formFieldLabel: 'text-[#52525b]',
    badge: 'text-[#18181b]',
    breadcrumbs: 'text-[#52525b]',
    breadcrumbsItem: 'text-[#52525b]',
    breadcrumbsItemDivider: 'text-[#a1a1aa]',
    modalContent: 'bg-white border border-zinc-200 shadow-xl',
    modalBackdrop: 'bg-black/40',
    navbarButton: 'text-[#18181b]',
    headerTitle: 'text-[#18181b]',
    headerSubtitle: 'text-[#52525b]',
  },
};

function ClerkProviderWithTheme({ children }: { children: React.ReactNode }) {
  const { resolved } = useTheme();
  const appearance = resolved === 'light' ? CLERK_APPEARANCE_LIGHT : CLERK_APPEARANCE_DARK;
  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} appearance={appearance}>
      {children}
    </ClerkProvider>
  );
}

const InnerApp = (
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </QueryClientProvider>
);

const AppWithProviders = (
  <ThemeProvider>
    {CLERK_PUBLISHABLE_KEY ? (
      <ClerkProviderWithTheme>{InnerApp}</ClerkProviderWithTheme>
    ) : (
      InnerApp
    )}
  </ThemeProvider>
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {AppWithProviders}
  </StrictMode>,
);
