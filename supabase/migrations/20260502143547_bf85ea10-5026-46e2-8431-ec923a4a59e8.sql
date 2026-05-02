-- Admin: list a therapist's child patients
CREATE OR REPLACE FUNCTION public.admin_list_therapist_child_patients(_therapist_id uuid)
RETURNS TABLE(
  id uuid,
  first_name text,
  last_name text,
  birth_date date,
  diagnosis text,
  guardian_name text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    cp.id,
    cp.first_name,
    cp.last_name,
    cp.birth_date,
    cp.medical_diagnosis AS diagnosis,
    (
      SELECT g.full_name
      FROM public.guardians g
      WHERE g.child_patient_id = cp.id
      ORDER BY g.created_at ASC
      LIMIT 1
    ) AS guardian_name
  FROM public.child_patients cp
  WHERE cp.psychologist_id = _therapist_id
    AND public.is_admin(auth.uid())
  ORDER BY cp.first_name, cp.last_name;
$$;

-- Admin: transfer a child patient (independent copy + medications + guardians + transfer record)
CREATE OR REPLACE FUNCTION public.admin_transfer_child_patient(
  _child_patient_id uuid,
  _to_therapist_id uuid,
  _transfer_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_orig public.child_patients%ROWTYPE;
  v_new_id uuid;
  v_from_id uuid;
  v_from_name text;
  v_snapshot jsonb;
  v_meds jsonb;
  v_sessions jsonb;
  v_docs jsonb;
  v_guardians jsonb;
  v_combined_notes text;
  v_date_str text;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only admins can perform this transfer';
  END IF;

  SELECT * INTO v_orig FROM public.child_patients WHERE id = _child_patient_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Child patient not found';
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

  -- Insert new independent child patient row
  INSERT INTO public.child_patients (
    psychologist_id, first_name, last_name, birth_date, sex,
    school, grade, homeroom_teacher, modality,
    referral_source, referral_reason,
    medical_diagnosis, current_medication,
    specialist_name, notes, extended_notes
  ) VALUES (
    _to_therapist_id, v_orig.first_name, v_orig.last_name, v_orig.birth_date, v_orig.sex,
    v_orig.school, v_orig.grade, v_orig.homeroom_teacher, v_orig.modality,
    v_orig.referral_source, v_orig.referral_reason,
    v_orig.medical_diagnosis, v_orig.current_medication,
    v_orig.specialist_name, v_combined_notes, v_orig.extended_notes
  )
  RETURNING id INTO v_new_id;

  -- Copy medications
  INSERT INTO public.child_patient_medications
    (child_patient_id, psychologist_id, name, dose, frequency, prescribed_by, start_date, end_date, is_active, notes)
  SELECT v_new_id, _to_therapist_id, name, dose, frequency, prescribed_by, start_date, end_date, is_active, notes
  FROM public.child_patient_medications WHERE child_patient_id = _child_patient_id;

  -- Copy guardians
  INSERT INTO public.guardians
    (child_patient_id, psychologist_id, full_name, relationship, phone, email, involvement_level)
  SELECT v_new_id, _to_therapist_id, full_name, relationship, phone, email, involvement_level
  FROM public.guardians WHERE child_patient_id = _child_patient_id;

  -- Build snapshot
  SELECT to_jsonb(v_orig) INTO v_snapshot;
  SELECT COALESCE(jsonb_agg(to_jsonb(m)), '[]'::jsonb) INTO v_meds
    FROM public.child_patient_medications m WHERE m.child_patient_id = _child_patient_id;
  SELECT COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb) INTO v_sessions
    FROM public.sessions s WHERE s.child_patient_id = _child_patient_id;
  SELECT COALESCE(jsonb_agg(to_jsonb(d)), '[]'::jsonb) INTO v_docs
    FROM public.child_documents d WHERE d.child_patient_id = _child_patient_id;
  SELECT COALESCE(jsonb_agg(to_jsonb(g)), '[]'::jsonb) INTO v_guardians
    FROM public.guardians g WHERE g.child_patient_id = _child_patient_id;

  -- Record the transfer
  INSERT INTO public.patient_transfers (
    patient_id, from_psychologist_id, to_psychologist_id, new_patient_id, notes, snapshot
  ) VALUES (
    _child_patient_id, v_from_id, _to_therapist_id, v_new_id, _transfer_notes,
    jsonb_build_object(
      'kind', 'child',
      'patient', v_snapshot,
      'medications', v_meds,
      'sessions', v_sessions,
      'documents', v_docs,
      'guardians', v_guardians,
      'taken_at', now()
    )
  );

  RETURN v_new_id;
END;
$$;
