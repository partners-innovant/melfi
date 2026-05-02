CREATE TABLE public.general_chat_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  psychologist_id uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  memory_summary text,
  key_facts jsonb NOT NULL DEFAULT '[]'::jsonb,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.general_chat_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own general_chat_memory"
ON public.general_chat_memory
FOR ALL
USING (auth.uid() = psychologist_id)
WITH CHECK (auth.uid() = psychologist_id);

CREATE INDEX idx_general_chat_memory_psy ON public.general_chat_memory(psychologist_id);