-- 1. Create allowed_therapists table
CREATE TABLE public.allowed_therapists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  first_name text,
  last_name text,
  specialty text,
  phone text,
  institution text,
  is_active boolean NOT NULL DEFAULT true,
  invited_at timestamptz NOT NULL DEFAULT now(),
  joined_at timestamptz,
  notes text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- Normalize email to lowercase
CREATE OR REPLACE FUNCTION public.normalize_allowed_therapist_email()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.email = lower(trim(NEW.email));
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_normalize_allowed_therapist_email
BEFORE INSERT OR UPDATE ON public.allowed_therapists
FOR EACH ROW EXECUTE FUNCTION public.normalize_allowed_therapist_email();

-- 2. Enable RLS
ALTER TABLE public.allowed_therapists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage allowed_therapists"
ON public.allowed_therapists
FOR ALL
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

-- 3. Helper function to check if an email is allowed
CREATE OR REPLACE FUNCTION public.is_email_allowed(_email text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.allowed_therapists
    WHERE email = lower(trim(_email)) AND is_active = true
  )
  OR EXISTS (
    -- Admins always allowed (matched by their auth email via profiles table is not possible; we match via auth.users)
    SELECT 1 FROM auth.users u
    JOIN public.profiles p ON p.id = u.id
    WHERE lower(u.email) = lower(trim(_email)) AND p.is_admin = true
  );
$$;

-- 4. Update handle_new_user trigger to mark joined_at
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, first_name, last_name, rut, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    NEW.raw_user_meta_data->>'rut',
    NEW.raw_user_meta_data->>'phone'
  );

  -- Mark the therapist as joined in the whitelist (if present)
  UPDATE public.allowed_therapists
  SET joined_at = COALESCE(joined_at, now()),
      first_name = COALESCE(NULLIF(first_name, ''), NEW.raw_user_meta_data->>'first_name'),
      last_name = COALESCE(NULLIF(last_name, ''), NEW.raw_user_meta_data->>'last_name'),
      phone = COALESCE(NULLIF(phone, ''), NEW.raw_user_meta_data->>'phone')
  WHERE email = lower(trim(NEW.email));

  RETURN NEW;
END;
$$;

-- Make sure the trigger exists on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
