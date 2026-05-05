import { useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || "");
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/**
 * Tiny shared audio-record + Whisper-transcribe hook.
 * Calls the existing "transcribe-session-chunk" edge function with action="transcribe".
 * Returns plain transcript text via the onTranscribed callback (caller appends).
 */
export function useAudioTranscriber(onTranscribed: (text: string) => void) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec) return;
    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      try { rec.stop(); } catch { resolve(); }
    });
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setRecording(false);

    const blob = new Blob(chunksRef.current, { type: "audio/webm" });
    chunksRef.current = [];
    if (blob.size < 800) {
      toast.info("Audio demasiado corto");
      return;
    }
    setTranscribing(true);
    try {
      const audio = await blobToBase64(blob);
      const { data, error } = await supabase.functions.invoke("transcribe-session-chunk", {
        body: { action: "transcribe", audio, mime_type: "audio/webm", audioMediaType: "audio/webm" },
      });
      if (error) throw error;
      const segs: any[] = (data as any)?.segments ?? [];
      const text = segs.map((s) => String(s?.text ?? "").trim()).filter(Boolean).join(" ").trim();
      if (!text) {
        toast.info("No se detectó voz");
        return;
      }
      onTranscribed(text);
    } catch (e: any) {
      console.error("transcribe error", e);
      toast.error(e?.message || "Error al transcribir");
    } finally {
      setTranscribing(false);
    }
  }, [onTranscribed]);

  const start = useCallback(async () => {
    if (recording || transcribing) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
    } catch (e: any) {
      console.error("mic error", e);
      toast.error(e?.message || "No se pudo acceder al micrófono");
    }
  }, [recording, transcribing]);

  const toggle = useCallback(() => {
    if (recording) stop();
    else start();
  }, [recording, start, stop]);

  return { recording, transcribing, toggle, start, stop };
}
