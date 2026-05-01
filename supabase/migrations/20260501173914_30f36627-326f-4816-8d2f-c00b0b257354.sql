DROP POLICY IF EXISTS "Delete own documents" ON public.documents;
CREATE POLICY "Delete own or global as admin"
ON public.documents
FOR DELETE
USING (
  (auth.uid() = psychologist_id AND is_global = false)
  OR public.is_admin(auth.uid())
);