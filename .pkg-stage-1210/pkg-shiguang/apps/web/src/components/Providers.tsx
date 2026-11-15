'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { create } from 'zustand';

interface ThemeState { dark: boolean; toggle: () => void }
export const useTheme = create<ThemeState>((set) => ({
  dark: false,
  toggle: () => set((s) => ({ dark: !s.dark })),
}));

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 } },
  }));
  const dark = useTheme((s) => s.dark);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
