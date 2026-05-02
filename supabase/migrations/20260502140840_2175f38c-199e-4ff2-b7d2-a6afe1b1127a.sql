-- Admin-only RPCs for the patient transfer wizard

-- 1) List a specific therapist's adult patients (admin only)
CREATE OR REPLACE FUNCTION public.admin_list_therapist_patients(_therapist_id uuid)
RETURNS TABLE(
  id uuid,
  first_name text,
  last_name text,
  birth_date date,
  diagnosis text,
  start_date date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.first_name, p.last_name, p.birth_date, p.diagnosis, p.start_date
  FROM public.patients p
  WHERE p.psychologist_id = _therapist_id
    AND public.is_admin(auth.uid())
  ORDER BY p.first_name, p.last_name;
$$;

-- 2) Perform the transfer as admin (bypasses RLS via SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.admin_transfer_patient(
  _patient_id uuid,
  _to_therapist_id uuid,
  _transfer_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orig public.patients%ROWTYPE;
  v_new_id uuid;
  v_from_id uuid;
  v_from_name text;
  v_snapshot jsonb;
  v_meds jsonb;
  v_sessions jsonb;
  v_docs jsonb;
  v_chat jsonb;
  v_combined_notes text;
  v_date_str text;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only admins can perform this transfer';
  END IF;

  SELECT * INTO v_orig FROM public.patients WHERE id = _patient_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Patient not found';
  END IF;

  v_from_id := v_orig.psychologist_id;

  IF v_from_id = _to_therapist_id THEN
    RAISE EXCEPTION 'El terapeuta receptor es el mismo que el actual';
  END IF;

  SELECT COALESCE(NULLIF(trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')), ''), 'el terapeuta anterior')
    INTO v_from_name
  FROM public.profiles WHERE id = v_from_id;

  v_date_str := to_char(now(), 'DD/MM/YYYY');

  v_combined_notes :=
    '--- Paciente transferido desde ' || v_from_name || ' el ' || v_date_str || ' ---' || E'\n\n' ||
    CASE WHEN _transfer_notes IS NOT NULL AND length(trim(_transfer_notes)) > 0
      THEN 'Notas del terapeuta anterior:' || E'\n' || _transfer_notes || E'\n\n'
      ELSE ''
    END ||
    '--- Perfil original ---' || E'\n\n' ||
    COALESCE(v_orig.notes, '');

  -- Insert new independent patient row for the recipient
  INSERT INTO public.patients (
    psychologist_id, first_name, last_name, birth_date, sex,
    marital_status, occupation, start_date, diagnosis, notes,
    session_day, session_time, session_frequency, session_duration,
    extended_notes, presenting_problem, clinical_history,
    family_context, work_context, previous_treatments, relevant_history,
    therapeutic_goals, personal_resources, profile_builder_completed
  ) VALUES (
    _to_therapist_id, v_orig.first_name, v_orig.last_name, v_orig.birth_date, v_orig.sex,
    v_orig.marital_status, v_orig.occupation, CURRENT_DATE, v_orig.diagnosis, v_combined_notes,
    v_orig.session_day, v_orig.session_time, v_orig.session_frequency, v_orig.session_duration,
    v_orig.extended_notes, v_orig.presenting_problem, v_orig.clinical_history,
    v_orig.family_context, v_orig.work_context, v_orig.previous_treatments, v_orig.relevant_history,
    v_orig.therapeutic_goals, v_orig.personal_resources, COALESCE(v_orig.profile_builder_completed, false)
  )
  RETURNING id INTO v_new_id;

  -- Copy medications
  INSERT INTO public.patient_medications
    (patient_id, psychologist_id, name, dose, frequency, prescribed_by, start_date, end_date, is_active, notes)
  SELECT v_new_id, _to_therapist_id, name, dose, frequency, prescribed_by, start_date, end_date, is_active, notes
  FROM public.patient_medications WHERE patient_id = _patient_id;

  -- Build snapshot
  SELECT to_jsonb(v_orig) INTO v_snapshot;
  SELECT COALESCE(jsonb_agg(to_jsonb(m)), '[]'::jsonb) INTO v_meds
    FROM public.patient_medications m WHERE m.patient_id = _patient_id;
  SELECT COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb) INTO v_sessions
    FROM public.sessions s WHERE s.patient_id = _patient_id;
  SELECT COALESCE(jsonb_agg(to_jsonb(d)), '[]'::jsonb) INTO v_docs
    FROM public.adult_documents d WHERE d.patient_id = _patient_id;
  SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb) INTO v_chat
    FROM public.patient_profile_chat c WHERE c.patient_id = _patient_id;

  -- Record the transfer
  INSERT INTO public.patient_transfers (
    patient_id, from_psychologist_id, to_psychologist_id, new_patient_id, notes, snapshot
  ) VALUES (
    _patient_id, v_from_id, _to_therapist_id, v_new_id, _transfer_notes,
    jsonb_build_object(
      'patient', v_snapshot,
      'medications', v_meds,
      'sessions', v_sessions,
      'documents', v_docs,
      'profile_chat', v_chat,
      'taken_at', now()
    )
  );

  RETURN v_new_id;
END;
$$;

-- Allow admins to insert transfers where they are not the from_psychologist
DROP POLICY IF EXISTS "Sender creates transfers" ON public.patient_transfers;
CREATE POLICY "Sender or admin creates transfers"
ON public.patient_transfers
FOR INSERT
TO authenticated
WITH CHECK ((auth.uid() = from_psychologist_id) OR public.is_admin(auth.uid()));