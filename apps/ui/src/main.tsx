import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClerkProvider } from '@clerk/clerk-react';
import { ToastProvider } from './components/common/Toast.tsx';
import { ThemeProvider } from './contexts/ThemeContext.tsx';
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

// Clerk dark theme to match Wooblay's dark UI
const clerkAppearance = {
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
    // Organization components: force light-on-dark text everywhere
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
    // OrganizationProfile: ensure all inner text is light
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

// Conditionally wrap with ClerkProvider only if key is present
const AppWithProviders = CLERK_PUBLISHABLE_KEY ? (
  <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} appearance={clerkAppearance}>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ThemeProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </ThemeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </ClerkProvider>
) : (
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <ThemeProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>
  </QueryClientProvider>
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {AppWithProviders}
  </StrictMode>,
);
