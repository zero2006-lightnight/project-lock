"use client";

import * as React from "react";

export const SPEECH_VOICES = ["Kore", "Aoede", "Fenrir", "Leda", "Puck"] as const;
export type SpeechVoice = (typeof SPEECH_VOICES)[number];
const VOICE_KEY = "studypilot-tts-voice";
const cache = new Map<string, Blob>();

function selectedVoice(): SpeechVoice {
  if (typeof window === "undefined") return "Kore";
  const value = window.localStorage.getItem(VOICE_KEY);
  return SPEECH_VOICES.includes(value as SpeechVoice) ? (value as SpeechVoice) : "Kore";
}

export function useSpeech() {
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = React.useRef<string | null>(null);
  const requestRef = React.useRef(0);
  const [isSpeaking, setIsSpeaking] = React.useState(false);

  const stop = React.useCallback(() => {
    requestRef.current += 1;
    audioRef.current?.pause();
    audioRef.current = null;
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
    setIsSpeaking(false);
  }, []);

  const speak = React.useCallback(async (text: string, voice?: SpeechVoice) => {
    const normalized = text.trim();
    if (!normalized) return;
    stop();
    const requestId = requestRef.current;
    setIsSpeaking(true);
    try {
      const chosenVoice = voice ?? selectedVoice();
      const cacheKey = `${chosenVoice}:${normalized}`;
      let audioBlob = cache.get(cacheKey);
      if (!audioBlob) {
        const response = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: normalized, voice: chosenVoice }),
        });
        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(data?.error ?? "Speech generation failed");
        }
        audioBlob = await response.blob();
        cache.set(cacheKey, audioBlob);
      }
      if (requestRef.current !== requestId) return;
      const url = URL.createObjectURL(audioBlob);
      objectUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = stop;
      audio.onerror = stop;
      await audio.play();
    } catch (error) {
      stop();
      throw error;
    }
  }, [stop]);

  React.useEffect(() => stop, [stop]);
  return { speak, stop, isSpeaking };
}
