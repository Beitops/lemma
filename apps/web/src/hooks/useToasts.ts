import { useCallback, useMemo, useState } from "react";
import type { ToastMessage, ToastTone } from "../components/Primitives";

export interface ToastController {
  dismiss: (id: string) => void;
  messages: ToastMessage[];
  push: (message: string, tone?: ToastTone) => void;
}

export function useToasts(): ToastController {
  const [messages, setMessages] = useState<ToastMessage[]>([]);
  const dismiss = useCallback((id: string) => {
    setMessages((current) => current.filter((message) => message.id !== id));
  }, []);
  const push = useCallback((message: string, tone: ToastTone = "info") => {
    const id = crypto.randomUUID();
    setMessages((current) => [...current.slice(-3), { id, message, tone }]);
    window.setTimeout(() => {
      setMessages((current) => current.filter((item) => item.id !== id));
    }, 5_000);
  }, []);

  return useMemo(() => ({ dismiss, messages, push }), [dismiss, messages, push]);
}
