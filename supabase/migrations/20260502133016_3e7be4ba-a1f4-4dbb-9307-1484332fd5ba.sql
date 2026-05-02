CREATE OR REPLACE FUNCTION public.get_user_id_by_email(_email text)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  is_allowed boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Only allow lookups for emails that belong to an active authorized therapist
  -- OR if the caller is an admin.
  SELECT EXISTS (
    SELECT 1 FROM public.allowed_therapists
    WHERE email = lower(trim(_email)) AND is_active = true
  ) INTO is_allowed;

  IF NOT is_allowed AND NOT public.is_admin(auth.uid()) THEN
    RETURN NULL;
  END IF;

  SELECT u.id INTO uid
  FROM auth.users u
  WHERE lower(u.email) = lower(trim(_email))
  LIMIT 1;

  RETURN uid;
END;
$$;
