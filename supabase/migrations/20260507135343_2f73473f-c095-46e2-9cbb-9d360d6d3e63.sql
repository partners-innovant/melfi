CREATE TABLE public.patient_medication_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL,
  psychologist_id uuid NOT NULL,
  token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.patient_medication_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Therapist manages own links" ON public.patient_medication_links FOR ALL USING (auth.uid() = psychologist_id) WITH CHECK (auth.uid() = psychologist_id);

CREATE TABLE public.patient_medication_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  medication_id uuid REFERENCES public.patient_medications(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL,
  psychologist_id uuid NOT NULL,
  medication_name text NOT NULL,
  medication_dose text,
  taken_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.patient_medication_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Therapist views own patient logs" ON public.patient_medication_logs FOR SELECT USING (auth.uid() = psychologist_id);
CREATE POLICY "Therapist deletes own patient logs" ON public.patient_medication_logs FOR DELETE USING (auth.uid() = psychologist_id);

CREATE OR REPLACE FUNCTION public.tracker_get_context(_token uuid)
RETURNS TABLE(patient_id uuid, psychologist_id uuid, patient_first_name text, patient_last_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.patient_id, l.psychologist_id, p.first_name, p.last_name
  FROM public.patient_medication_links l JOIN public.patients p ON p.id = l.patient_id
  WHERE l.token = _token LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.tracker_list_medications(_token uuid)
RETURNS TABLE(id uuid, name text, dose text, is_active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.id, m.name, m.dose, m.is_active FROM public.patient_medications m
  WHERE m.patient_id = (SELECT patient_id FROM public.patient_medication_links WHERE token = _token LIMIT 1)
  ORDER BY m.is_active DESC, m.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.tracker_list_logs(_token uuid, _days int DEFAULT 30)
RETURNS TABLE(id uuid, medication_id uuid, medication_name text, medication_dose text, taken_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT lg.id, lg.medication_id, lg.medication_name, lg.medication_dose, lg.taken_at
  FROM public.patient_medication_logs lg
  WHERE lg.patient_id = (SELECT patient_id FROM public.patient_medication_links WHERE token = _token LIMIT 1)
    AND lg.taken_at >= now() - (_days || ' days')::interval
  ORDER BY lg.taken_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.tracker_log_intake(_token uuid, _medication_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pid uuid; v_psy uuid; v_name text; v_dose text; v_log uuid;
BEGIN
  SELECT patient_id, psychologist_id INTO v_pid, v_psy FROM public.patient_medication_links WHERE token = _token LIMIT 1;
  IF v_pid IS NULL THEN RAISE EXCEPTION 'Invalid token'; END IF;
  SELECT name, dose INTO v_name, v_dose FROM public.patient_medications WHERE id = _medication_id AND patient_id = v_pid;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Medication not found'; END IF;
  INSERT INTO public.patient_medication_logs (medication_id, patient_id, psychologist_id, medication_name, medication_dose)
  VALUES (_medication_id, v_pid, v_psy, v_name, v_dose) RETURNING id INTO v_log;
  RETURN v_log;
END; $$;

CREATE OR REPLACE FUNCTION public.tracker_log_intake_by_name(_token uuid, _name text, _dose text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pid uuid; v_psy uuid; v_log uuid; v_med uuid;
BEGIN
  SELECT patient_id, psychologist_id INTO v_pid, v_psy FROM public.patient_medication_links WHERE token = _token LIMIT 1;
  IF v_pid IS NULL THEN RAISE EXCEPTION 'Invalid token'; END IF;
  SELECT id INTO v_med FROM public.patient_medications WHERE patient_id = v_pid AND lower(name) = lower(_name) LIMIT 1;
  INSERT INTO public.patient_medication_logs (medication_id, patient_id, psychologist_id, medication_name, medication_dose)
  VALUES (v_med, v_pid, v_psy, _name, _dose) RETURNING id INTO v_log;
  RETURN v_log;
END; $$;

CREATE OR REPLACE FUNCTION public.tracker_create_medication(_token uuid, _name text, _dose text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pid uuid; v_psy uuid; v_med uuid;
BEGIN
  SELECT patient_id, psychologist_id INTO v_pid, v_psy FROM public.patient_medication_links WHERE token = _token LIMIT 1;
  IF v_pid IS NULL THEN RAISE EXCEPTION 'Invalid token'; END IF;
  INSERT INTO public.patient_medications (patient_id, psychologist_id, name, dose, is_active)
  VALUES (v_pid, v_psy, _name, _dose, true) RETURNING id INTO v_med;
  INSERT INTO public.patient_medication_logs (medication_id, patient_id, psychologist_id, medication_name, medication_dose)
  VALUES (v_med, v_pid, v_psy, _name, _dose);
  RETURN v_med;
END; $$;

CREATE OR REPLACE FUNCTION public.tracker_delete_log(_token uuid, _log_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pid uuid;
BEGIN
  SELECT patient_id INTO v_pid FROM public.patient_medication_links WHERE token = _token LIMIT 1;
  IF v_pid IS NULL THEN RAISE EXCEPTION 'Invalid token'; END IF;
  DELETE FROM public.patient_medication_logs WHERE id = _log_id AND patient_id = v_pid;
END; $$;

GRANT EXECUTE ON FUNCTION public.tracker_get_context(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tracker_list_medications(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tracker_list_logs(uuid, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tracker_log_intake(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tracker_log_intake_by_name(uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tracker_create_medication(uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tracker_delete_log(uuid, uuid) TO anon, authenticated;