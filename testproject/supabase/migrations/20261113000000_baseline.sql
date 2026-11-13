-- Healthy baseline
CREATE TABLE public.projects (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    owner_id uuid NOT NULL,
    name text NOT NULL
);
CREATE INDEX projects_owner_id_idx ON public.projects(owner_id);
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read projects" ON public.projects
    FOR SELECT TO authenticated
    USING (owner_id = (select auth.uid()));
