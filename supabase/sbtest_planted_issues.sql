-- PURPOSELY PLANTED ISSUES for sb-sniffer testing. Drop with supabase/sbtest_cleanup.sql
CREATE TABLE IF NOT EXISTS public.sbtest_parent (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, name text);
CREATE TABLE IF NOT EXISTS public.sbtest_secret_notes (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, body text);
CREATE TABLE IF NOT EXISTS public.sbtest_locked (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, data text);
ALTER TABLE public.sbtest_locked ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS public.sbtest_tasks (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, parent_id uuid REFERENCES public.sbtest_parent(id), assignee_id uuid NOT NULL);
ALTER TABLE public.sbtest_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sbtest assignee reads" ON public.sbtest_tasks FOR SELECT TO authenticated USING (assignee_id = auth.uid());
ALTER TABLE public.sbtest_secret_notes DISABLE ROW LEVEL SECURITY;
