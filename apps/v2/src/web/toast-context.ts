import { createContext, useContext } from 'react';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastContextValue {
  showToast: (message: string, kind?: ToastKind) => void;
}

export const ToastContext = createContext<ToastContextValue>({ showToast: () => undefined });

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}
