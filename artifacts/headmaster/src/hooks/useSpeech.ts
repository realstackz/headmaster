import { useState, useRef, useCallback, useEffect } from "react";

export interface SpeechItem {
  id: string;
  text: string;
}

export interface UseSpeechReturn {
  isSupported: boolean;
  isSpeaking: boolean;
  speak: (
    items: SpeechItem[],
    onItemStart?: (id: string) => void,
    onComplete?: () => void,
  ) => void;
  stop: () => void;
}

export function useSpeech(): UseSpeechReturn {
  const isSupported =
    typeof window !== "undefined" && "speechSynthesis" in window;

  const [isSpeaking, setIsSpeaking] = useState(false);
  const cancelledRef = useRef(false);

  const stop = useCallback(() => {
    cancelledRef.current = true;
    if (isSupported) window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }, [isSupported]);

  const speak = useCallback(
    (
      items: SpeechItem[],
      onItemStart?: (id: string) => void,
      onComplete?: () => void,
    ) => {
      if (!isSupported || items.length === 0) return;

      window.speechSynthesis.cancel();
      cancelledRef.current = false;
      setIsSpeaking(true);

      let idx = 0;

      const speakNext = () => {
        if (cancelledRef.current || idx >= items.length) {
          if (!cancelledRef.current) {
            setIsSpeaking(false);
            onComplete?.();
          }
          return;
        }

        const item = items[idx++];
        onItemStart?.(item.id);

        const utterance = new SpeechSynthesisUtterance(item.text);

        utterance.onend = () => {
          if (!cancelledRef.current) speakNext();
        };

        utterance.onerror = (e) => {
          if (e.error === "interrupted") {
            cancelledRef.current = true;
            setIsSpeaking(false);
            return;
          }
          if (!cancelledRef.current) speakNext();
        };

        window.speechSynthesis.speak(utterance);
      };

      speakNext();
    },
    [isSupported],
  );

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      if (isSupported) window.speechSynthesis.cancel();
    };
  }, [isSupported]);

  return { isSupported, isSpeaking, speak, stop };
}
