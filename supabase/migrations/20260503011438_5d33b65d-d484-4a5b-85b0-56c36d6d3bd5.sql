ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS publication_date date;

CREATE OR REPLACE FUNCTION public.sync_document_year_from_date()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.publication_date IS NOT NULL THEN
    NEW.year := to_char(NEW.publication_date, 'YYYY');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_document_year_from_date ON public.documents;
CREATE TRIGGER sync_document_year_from_date
BEFORE INSERT OR UPDATE OF publication_date ON public.documents
FOR EACH ROW
EXECUTE FUNCTION public.sync_document_year_from_date();