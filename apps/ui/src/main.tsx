import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClerkProvider } from '@clerk/clerk-react';
import { ToastProvider } from './components/common/Toast.tsx';
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
    borderRadius: '0.5rem',
  },
  elements: {
    card: 'bg-[#111113] border border-white/10 shadow-xl',
    formButtonPrimary: 'bg-indigo-500 hover:bg-indigo-600',
    footerActionLink: 'text-indigo-400 hover:text-indigo-300',
  },
};

// Conditionally wrap with ClerkProvider only if key is present
const AppWithProviders = CLERK_PUBLISHABLE_KEY ? (
  <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} appearance={clerkAppearance}>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <App />
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </ClerkProvider>
) : (
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </QueryClientProvider>
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {AppWithProviders}
  </StrictMode>,
);
