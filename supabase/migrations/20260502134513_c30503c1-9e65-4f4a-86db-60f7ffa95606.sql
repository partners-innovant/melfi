-- Admin-readable profiles policy (no recursion: uses is_admin() security definer)
CREATE POLICY "Admins can view all profiles"
ON public.profiles FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));

-- Function: list all registered therapists with email + patient counts
CREATE OR REPLACE FUNCTION public.admin_list_therapists()
RETURNS TABLE (
  id uuid,
  email text,
  first_name text,
  last_name text,
  rut text,
  phone text,
  is_admin boolean,
  created_at timestamptz,
  patient_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    u.email::text AS email,
    p.first_name,
    p.last_name,
    p.rut,
    p.phone,
    p.is_admin,
    p.created_at,
    COALESCE((SELECT count(*) FROM public.patients pa WHERE pa.psychologist_id = p.id), 0)
      + COALESCE((SELECT count(*) FROM public.child_patients cp WHERE cp.psychologist_id = p.id), 0)
      AS patient_count
  FROM public.profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  WHERE public.is_admin(auth.uid())
  ORDER BY p.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.admin_list_therapists() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_therapists() TO authenticated;