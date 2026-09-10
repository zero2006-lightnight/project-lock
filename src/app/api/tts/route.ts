import { GoogleGenAI } from "@google/genai";
import { Mp3Encoder } from "lamejs";
import { z } from "zod";

export const runtime = "nodejs";

const requestSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  voice: z.enum(["Kore", "Aoede", "Fenrir", "Leda", "Puck"]).default("Kore"),
});

const MODEL = "gemini-2.5-flash-preview-tts";
const SAMPLE_RATE = 24_000;

function pcmToMp3(pcm: Uint8Array) {
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
  const encoder = new Mp3Encoder(1, SAMPLE_RATE, 128);
  const output: Uint8Array[] = [];
  const frameSize = 1152;

  for (let offset = 0; offset < samples.length; offset += frameSize) {
    const frame = samples.subarray(offset, Math.min(offset + frameSize, samples.length));
    const encoded = encoder.encodeBuffer(frame);
    if (encoded.length > 0) output.push(new Uint8Array(encoded));
  }
  const finalFrame = encoder.flush();
  if (finalFrame.length > 0) output.push(new Uint8Array(finalFrame));
  const bytes = Buffer.concat(output.map((chunk) => Buffer.from(chunk)));
  const audioBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(audioBuffer).set(bytes);
  return new Blob([audioBuffer], { type: "audio/mpeg" });
}

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "Gemini TTS is not configured on the server." }, { status: 503 });
  }

  let input: z.infer<typeof requestSchema>;
  try {
    input = requestSchema.parse(await request.json());
  } catch {
    return Response.json({ error: "Provide text and a supported voice." }, { status: 400 });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [{ parts: [{ text: input.text }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: input.voice },
          },
        },
      },
    });
    const inlineData = response.candidates?.[0]?.content?.parts?.find((part) => part.inlineData)?.inlineData;
    if (!inlineData?.data) throw new Error("Gemini returned no audio");

    const pcm = Uint8Array.from(Buffer.from(inlineData.data, "base64"));
    const mp3 = pcmToMp3(pcm);
    return new Response(mp3.stream(), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    console.error("Gemini TTS failed", error);
    return Response.json({ error: "Speech generation failed. Please try again." }, { status: 502 });
  }
}
