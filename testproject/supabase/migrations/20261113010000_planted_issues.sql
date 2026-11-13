-- PURPOSELY PLANTED ISSUES: the sniffer should flag all of these.

-- 1) RLS_DISABLED_OR_LOCKED_OUT: public table, RLS never enabled
CREATE TABLE public.secret_notes (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    body text NOT NULL
);

-- 2) RLS enabled with ZERO policies (locked out)
CREATE TABLE public.locked_table (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    data text
);
ALTER TABLE public.locked_table ENABLE ROW LEVEL SECURITY;

-- 3) RLS_MISSING_INDEX: FK without index + 4) RLS_UNWRAPPED_AUTH_FUNC
CREATE TABLE public.tasks (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id uuid REFERENCES public.projects(id),
    assignee_id uuid NOT NULL
);
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Assignee reads tasks" ON public.tasks
    FOR SELECT TO authenticated
    USING (assignee_id = auth.uid());
