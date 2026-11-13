'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { create } from 'zustand';
import { ApiError, SESSION_EXPIRED_EVENT } from '@/lib/api';

interface ThemeState { dark: boolean; toggle: () => void }
export const useTheme = create<ThemeState>((set) => ({
  dark: false,
  toggle: () => set((s) => ({ dark: !s.dark })),
}));

export function Providers({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        retry: (count, error) => count < 1 && (!(error instanceof ApiError) || error.status < 400 || error.status >= 500),
        refetchOnWindowFocus: false,
        staleTime: 30_000,
      },
    },
  }));
  const dark = useTheme((s) => s.dark);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);
  useEffect(() => {
    function onExpired() {
      client.clear();
      router.replace('/login');
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [client, router]);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
