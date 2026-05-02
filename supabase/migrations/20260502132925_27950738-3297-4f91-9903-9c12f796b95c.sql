CREATE TABLE public.patient_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES public.patients(id) ON DELETE CASCADE,
  from_psychologist_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  to_psychologist_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  new_patient_id uuid REFERENCES public.patients(id) ON DELETE SET NULL,
  transferred_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  snapshot jsonb
);

ALTER TABLE public.patient_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants view transfers"
ON public.patient_transfers
FOR SELECT
USING (
  auth.uid() = from_psychologist_id
  OR auth.uid() = to_psychologist_id
  OR public.is_admin(auth.uid())
);

CREATE POLICY "Sender creates transfers"
ON public.patient_transfers
FOR INSERT
WITH CHECK (
  auth.uid() = from_psychologist_id OR public.is_admin(auth.uid())
);

CREATE POLICY "Admins delete transfers"
ON public.patient_transfers
FOR DELETE
USING (public.is_admin(auth.uid()));

-- Helper: look up a profile id by email (admins only).
-- Used by the transfer flow to resolve the receiving therapist's id from the
-- email stored in allowed_therapists.
CREATE OR REPLACE FUNCTION public.get_user_id_by_email(_email text)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT u.id INTO uid
  FROM auth.users u
  WHERE lower(u.email) = lower(trim(_email))
  LIMIT 1;

  RETURN uid;
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_id_by_email(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_id_by_email(text) TO authenticated;
