/* eslint-disable react-refresh/only-export-components */
// Context provider + hook pattern: keeping these together is standard for React context patterns and won't break Fast Refresh
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";

const MessageSelectContext = createContext<{
  highlightMessageId: number | null;
  toggleMessageHighlight: (id: number) => void;
  selectMessageHighlight: (id: number) => void;
  clearMessageHighlight: () => void;
}>({
  highlightMessageId: null,
  toggleMessageHighlight: () => {},
  selectMessageHighlight: () => {},
  clearMessageHighlight: () => {},
});

type MessageSelectProviderProps = {
  children: React.ReactNode;
};

const MessageSelectProvider = ({ children }: MessageSelectProviderProps) => {
  const [searchParams] = useSearchParams();

  const [messageId, setMessageId] = useState<number | null>(() => {
    const parsedMessageId = Number.parseInt(searchParams.get('messageId') ?? '', 10);
    return Number.isSafeInteger(parsedMessageId) ? parsedMessageId : null;
  });

  const toggleMessageHighlight = (id: number) => {
    setMessageId((current) => (current === id ? null : id));
  };

  const selectMessageHighlight = (id: number) => setMessageId(id);

  const clearMessageHighlight = () => setMessageId(null);

  // Escape clears the highlight, unless it was already used to close a popover, menu or dialog
  useEffect(() => {
    if (messageId === null) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) setMessageId(null);
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [messageId]);

  const value = useMemo(() => ({
    highlightMessageId: messageId,
    toggleMessageHighlight,
    selectMessageHighlight,
    clearMessageHighlight,
  }), [messageId]);

  return <MessageSelectContext.Provider value={value}>{children}</MessageSelectContext.Provider>;
};

MessageSelectContext.displayName = "MessageSelectContext";

const useMessageHighlight = () => useContext(MessageSelectContext);

export default MessageSelectProvider;
export { useMessageHighlight };
