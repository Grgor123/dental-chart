import { createContext, useContext, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { usePractice } from '../hooks/usePractice';

interface PracticeContextValue {
  practiceId: string | null;
  practiceName: string | null;
  loading: boolean;
  error: string | null;
}

const PracticeContext = createContext<PracticeContextValue | null>(null);

interface PracticeProviderProps {
  session: Session;
  children: ReactNode;
}

// Wraps usePractice() so practiceId/practiceName are readable anywhere
// under the signed-in part of the app (App.tsx) without prop-threading
// through PatientList.tsx/PatientChart.tsx — the only place that resolves
// this is the one usePractice() call here.
export function PracticeProvider({ session, children }: PracticeProviderProps) {
  const { practice, loading, error } = usePractice(session);
  return (
    <PracticeContext.Provider
      value={{
        practiceId: practice?.practiceId ?? null,
        practiceName: practice?.practiceName ?? null,
        loading,
        error,
      }}
    >
      {children}
    </PracticeContext.Provider>
  );
}

export function usePracticeContext(): PracticeContextValue {
  const ctx = useContext(PracticeContext);
  if (!ctx) throw new Error('usePracticeContext must be used within a PracticeProvider');
  return ctx;
}
