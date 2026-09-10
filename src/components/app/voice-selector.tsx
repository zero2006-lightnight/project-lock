"use client";

import * as React from "react";
import { Field, Select } from "@/components/ui/input";
import { SPEECH_VOICES, type SpeechVoice } from "@/hooks/useSpeech";

const VOICE_KEY = "studypilot-tts-voice";

export function VoiceSelector() {
  const [voice, setVoice] = React.useState<SpeechVoice>("Kore");

  React.useEffect(() => {
    const stored = window.localStorage.getItem(VOICE_KEY);
    if (SPEECH_VOICES.includes(stored as SpeechVoice)) setVoice(stored as SpeechVoice);
  }, []);

  return (
    <Field label="Read-aloud voice">
      <Select
        value={voice}
        onChange={(event) => {
          const next = event.target.value as SpeechVoice;
          setVoice(next);
          window.localStorage.setItem(VOICE_KEY, next);
        }}
      >
        {SPEECH_VOICES.map((option) => <option key={option} value={option}>{option}</option>)}
      </Select>
    </Field>
  );
}
