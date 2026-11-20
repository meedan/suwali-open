import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useState } from 'react';

import { type ToastAction, ToastNotification, type ToastVariant } from '@ui-components/layout/Toast';

type ToastEntry = {
  id: number;
  variant: ToastVariant;
  title?: string;
  message: string;
  action?: ToastAction;
};

type ToastContextValue = {
  toast: (variant: ToastVariant, message: string, title?: string, action?: ToastAction) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 0;

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [entries, setEntries] = useState<ToastEntry[]>([]);

  const toast = useCallback((variant: ToastVariant, message: string, title?: string, action?: ToastAction) => {
    setEntries(prev => [...prev, { id: nextId++, variant, message, title, action }]);
  }, []);

  const dismiss = (id: number) => {
    setEntries(prev => prev.filter(e => e.id !== id));
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {entries.map(entry => (
        <ToastNotification
          key={entry.id}
          variant={entry.variant}
          title={entry.title}
          action={entry.action}
          onOpenChange={(open) => { if (!open) dismiss(entry.id); }}
        >
          {entry.message}
        </ToastNotification>
      ))}
    </ToastContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return { toast: ctx.toast };
};
