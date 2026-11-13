-- Sample Exported Supabase Schema Dump (pg_dump --schema-only)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA public;

-- Table with RLS enabled, but foreign key has no index
CREATE TABLE public.organizations (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    name text NOT NULL
);
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.documents (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id uuid REFERENCES public.organizations(id),
    title text NOT NULL,
    created_by uuid NOT NULL
);
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

-- Unwrapped auth.uid() in RLS policy
CREATE POLICY "Users can access org documents" ON public.documents
    FOR SELECT TO authenticated
    USING (created_by = auth.uid());

-- Multiple permissive policies
CREATE POLICY "Admins can access org documents" ON public.documents
    FOR SELECT TO authenticated
    USING (auth.jwt() ->> 'role' = 'admin');

CREATE POLICY "Public auditor read" ON public.documents
    FOR SELECT TO authenticated
    USING (auth.email() LIKE '%@auditor.com');

-- Table with RLS DISABLED in public schema
CREATE TABLE public.audit_logs (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    action text NOT NULL
);

-- Realtime table with REPLICA IDENTITY DEFAULT
ALTER PUBLICATION supabase_realtime ADD TABLE public.documents;
