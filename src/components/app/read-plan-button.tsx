"use client";

import * as React from "react";
import { LoaderCircle, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSpeech } from "@/hooks/useSpeech";
import { useToast } from "@/components/ui/toaster";

type ReadPlanItem = { subject: string | null; title: string; start: string; end: string };

function readableList(items: string[]) {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

export function ReadPlanButton({ items }: { items: ReadPlanItem[] }) {
  const { speak, isSpeaking } = useSpeech();
  const { toast } = useToast();

  const readPlan = async () => {
    const paragraph = items.length === 0
      ? "Good morning. Your study plan is clear today. You can start a focus session whenever you are ready."
      : `Good morning. Today you have ${readableList(items.map((item) => `${item.subject ? `${item.subject}, ` : ""}${item.title} from ${item.start} to ${item.end}`))}.`;
    try {
      await speak(paragraph);
    } catch (error) {
      toast("error", "Could not read your plan", error instanceof Error ? error.message : "Please try again.");
    }
  };

  return (
    <Button variant="outline" onClick={readPlan} disabled={isSpeaking}>
      {isSpeaking ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Volume2 className="h-4 w-4" />}
      {isSpeaking ? "Reading plan" : "Read today's plan"}
    </Button>
  );
}
