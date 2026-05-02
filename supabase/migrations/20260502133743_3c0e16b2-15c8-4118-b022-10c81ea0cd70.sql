ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS session_day text CHECK (session_day IN (
    'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'
  ));

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS session_time time;

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS session_frequency text CHECK (session_frequency IN (
    'semanal', 'quincenal', 'mensual', 'a_demanda'
  )) DEFAULT 'semanal';

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS session_duration integer DEFAULT 50;
