import React, { createContext, useContext, useState, useCallback } from 'react';

interface ConfirmSecretContextValue {
  secret: string | null;
  setSecret: (secret: string) => void;
  hasSecret: boolean;
  clearSecret: () => void;
}

const ConfirmSecretContext = createContext<ConfirmSecretContextValue | null>(null);

export function ConfirmSecretProvider({ children }: { children: React.ReactNode }) {
  const [secret, setSecretState] = useState<string | null>(
    () => sessionStorage.getItem('confirm-secret')
  );

  const setSecret = useCallback((s: string) => {
    sessionStorage.setItem('confirm-secret', s);
    setSecretState(s);
  }, []);

  const clearSecret = useCallback(() => {
    sessionStorage.removeItem('confirm-secret');
    setSecretState(null);
  }, []);

  return (
    <ConfirmSecretContext.Provider value={{ secret, setSecret, hasSecret: !!secret, clearSecret }}>
      {children}
    </ConfirmSecretContext.Provider>
  );
}

export function useConfirmSecret() {
  const ctx = useContext(ConfirmSecretContext);
  if (!ctx) throw new Error('useConfirmSecret must be used within ConfirmSecretProvider');
  return ctx;
}
