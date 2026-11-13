# 🕵️‍♂️ Supabase Diagnostic & Health Report

**Generated At:** Fri, 13 Nov 2026 01:33:15 GMT
**Source:** `schema_dump`

## 🎯 Overall Health Score: **28/100** (Grade: **F**)

| Severity | Count |
|---|---|
| 🔴 Critical | **2** |
| 🟠 High | **1** |
| 🟡 Medium | **2** |
| 🔵 Info | **0** |
| **Total** | **5** |

---

## 🚨 Diagnostic Findings

### 1. [🔴 CRITICAL] Unwrapped auth.uid() or Helper Functions in RLS Policies

**Check ID:** `RLS_UNWRAPPED_AUTH_FUNC` | **Category:** `rls`

> **Summary:** 3 policy/policies call auth helpers directly without a (select ...) wrapper, bypassing PostgreSQL initPlan caching.

#### ⚠️ Why This Clogs the Supabase Support Queue:
Supabase users frequently open high-severity tickets asking why queries on tables with 10k+ rows suddenly time out (504 Gateway Timeout) or spike CPU to 100%. When auth.uid() is called directly, Postgres must execute the PL/pgSQL function on EVERY single candidate row in a sequential scan instead of running it once and using an index lookup.

#### 📌 Affected Database Objects:
| Object | Type | Details |
|---|---|---|
| `documents.Users can access org documents` | `policy` | Calls unwrapped auth.uid() — forces per-row function evaluation instead of initPlan caching. |
| `documents.Admins can access org documents` | `policy` | Calls unwrapped auth.jwt() — forces per-row function evaluation instead of initPlan caching. |
| `documents.Public auditor read` | `policy` | Calls unwrapped auth.email() — forces per-row function evaluation instead of initPlan caching. |
| `public.documents` | `table` | 3 permissive SELECT policies found (Users can access org documents, Admins can access org documents, Public auditor read). Multiple policies combine with OR and multiply execution overhead. |

#### 🛠️ Remediation:
Wrap all auth helpers like `auth.uid()` or `auth.jwt()` inside a sub-select: `(select auth.uid())`. This instructs the Postgres query optimizer to treat the value as an `initPlan`, evaluating it exactly once at query start and reusing the result for B-tree index seeks. Additionally, consolidate redundant permissive policies to avoid evaluating multiple OR expressions per row.

```sql
-- Fix policy "Users can access org documents" on public.documents to use initPlan caching:
ALTER POLICY "Users can access org documents" ON "public"."documents"
  USING (created_by = (select auth.uid()));

-- Fix policy "Admins can access org documents" on public.documents to use initPlan caching:
ALTER POLICY "Admins can access org documents" ON "public"."documents"
  USING ((select auth.jwt()) ->> 'role' = 'admin');

-- Fix policy "Public auditor read" on public.documents to use initPlan caching:
ALTER POLICY "Public auditor read" ON "public"."documents"
  USING ((select auth.email()) LIKE '%@auditor.com');
```

📖 [Supabase Documentation](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select)

---

### 2. [🔴 CRITICAL] Public Tables Missing RLS or Locked Out with Zero Policies

**Check ID:** `RLS_DISABLED_OR_LOCKED_OUT` | **Category:** `rls`

> **Summary:** Found 1 table(s) with RLS disabled in public schema (Rules 0013/0007), and 1 table(s) with RLS enabled with 0 policies (Rule 0008).

#### ⚠️ Why This Clogs the Supabase Support Queue:
Two opposing extremes drive frequent support escalations: (1) Developers create public tables without enabling RLS, inadvertently exposing private company data via the Supabase client SDK. (2) Developers write policies but leave RLS disabled (Rule 0007), or enable RLS without adding any policies (Rule 0008), leading to "Why is my query returning an empty list [] even though I can see rows in the Table Editor?". In Postgres, enabling RLS with no policies denies all non-superuser access.

#### 📌 Affected Database Objects:
| Object | Type | Details |
|---|---|---|
| `audit_logs` | `table` | [Rule 0013] RLS is DISABLED on public table. All rows are completely exposed to public PostgREST API requests (anon/authenticated). |
| `organizations` | `table` | [Rule 0008] RLS is ENABLED but has 0 policies. Non-superuser PostgREST queries silently return empty arrays []. |

#### 🛠️ Remediation:
1. Enable Row Level Security on all public tables: `ALTER TABLE "<schema>"."<table>" ENABLE ROW LEVEL SECURITY;`.
2. Ensure tables with RLS enabled have explicitly scoped policies for `anon` and `authenticated` roles.
3. Verify that tables with defined policies have RLS actively turned on.

```sql
-- Enable RLS on public.audit_logs to enforce access controls:
ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;

-- Table public.organizations has RLS enabled with 0 policies. Add at least one policy for your intended roles, for example:
-- CREATE POLICY "Allow read for authenticated" ON "public"."organizations"
--   FOR SELECT TO authenticated USING (true);
```

📖 [Supabase Documentation](https://supabase.com/docs/guides/database/postgres/row-level-security#enable-row-level-security)

---

### 3. [🟠 HIGH] Missing Indexes on Foreign Keys and RLS Filter Columns

**Check ID:** `RLS_MISSING_INDEX` | **Category:** `rls`

> **Summary:** 1 foreign key or policy filter column(s) lack a covering B-tree index (Supabase Advisor 0001_unindexed_foreign_keys).

#### ⚠️ Why This Clogs the Supabase Support Queue:
In Supabase, PostgREST automatically embeds relationships using foreign keys, and RLS evaluates ownership filters on every query. Without B-tree indexes matching the foreign key column prefix, parent deletions and updates trigger heavy sequential scans or full table locks on child tables, and user queries turn into sluggish Seq Scans, causing connection pooler saturation and 504 Gateway Timeouts.

#### 📌 Affected Database Objects:
| Object | Type | Details |
|---|---|---|
| `documents(organization_id)` | `index` | Missing leading B-tree index. Foreign key "fk_documents_organization_id" referencing public.organizations(id) |

#### 🛠️ Remediation:
Create covering B-tree indexes matching the exact column order of the foreign key constraint using `CREATE INDEX CONCURRENTLY IF NOT EXISTS`. The `CONCURRENTLY` option builds the index without taking an exclusive table lock.

```sql
-- [Rule 0001] Add covering index on public.documents("organization_id"):
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_documents_organization_id"
ON "public"."documents" USING btree ("organization_id");
```

📖 [Supabase Documentation](https://supabase.com/docs/guides/database/database-linter#unindexed_foreign_keys)

---

### 4. [🟡 MEDIUM] Realtime Tables Missing REPLICA IDENTITY FULL

**Check ID:** `REALTIME_PUBLICATION_MISCONFIG` | **Category:** `realtime`

> **Summary:** 1 table(s) in "supabase_realtime" publication use REPLICA IDENTITY DEFAULT, omitting column values from payload.old.

#### ⚠️ Why This Clogs the Supabase Support Queue:
Developers frequently submit questions like: "Why is payload.old empty or only showing { id } when listening to postgres_changes DELETE/UPDATE events in supabase-js?". In PostgreSQL, the Write-Ahead Log (WAL) only records the primary key for updates and deletes by default. To receive previous column states or enable fine-grained client-side row filters, the table must be configured with REPLICA IDENTITY FULL.

#### 📌 Affected Database Objects:
| Object | Type | Details |
|---|---|---|
| `documents` | `table` | Table is in "supabase_realtime" publication with REPLICA IDENTITY DEFAULT ('d'). Realtime DELETE and UPDATE events will lack column values in payload.old. |

#### 🛠️ Remediation:
Set `REPLICA IDENTITY FULL` on tables added to the `supabase_realtime` publication if client-side subscriptions require inspecting previous row values during UPDATE or DELETE operations.

```sql
-- Enable full replica identity so Realtime broadcasts complete payload.old on UPDATE/DELETE:
ALTER TABLE "public"."documents" REPLICA IDENTITY FULL;
```

📖 [Supabase Documentation](https://supabase.com/docs/guides/realtime/postgres-changes#replica-identity)

---

### 5. [🟡 MEDIUM] Schema Hygiene: Extensions in Public, Table Bloat, and Unused Indexes

**Check ID:** `SCHEMA_BLOAT_AND_EXTENSIONS_HYGIENE` | **Category:** `hygiene`

> **Summary:** Found 2 extension(s) in public schema, 0 bloated table(s), and 0 unused index(es).

#### ⚠️ Why This Clogs the Supabase Support Queue:
Installing extensions like `pgvector` or `uuid-ossp` directly in `public` automatically generates API endpoints in PostgREST and clutters TypeScript types generated by supabase-gen-types. Meanwhile, dead tuples from frequent updates without aggressive autovacuum degrade scan speeds, and unused indexes silently eat IOPS on every write.

#### 📌 Affected Database Objects:
| Object | Type | Details |
|---|---|---|
| `uuid-ossp` | `extension` | Extension installed into "public" schema instead of "extensions". Pollutes PostgREST auto-generated OpenAPI schema and client types. |
| `pgcrypto` | `extension` | Extension installed into "public" schema instead of "extensions". Pollutes PostgREST auto-generated OpenAPI schema and client types. |

#### 🛠️ Remediation:
1. Keep the `public` schema reserved strictly for application tables. Install extensions into the dedicated `extensions` schema.
2. Run `VACUUM ANALYZE` or tune autovacuum vacuum scale factor on frequently updated tables.
3. Safely drop unused indexes using `DROP INDEX CONCURRENTLY`.

```sql
-- Move extension "uuid-ossp" from public to extensions schema:
CREATE SCHEMA IF NOT EXISTS extensions;
ALTER EXTENSION "uuid-ossp" SET SCHEMA extensions;

-- Move extension "pgcrypto" from public to extensions schema:
CREATE SCHEMA IF NOT EXISTS extensions;
ALTER EXTENSION "pgcrypto" SET SCHEMA extensions;
```

📖 [Supabase Documentation](https://supabase.com/docs/guides/database/database-linter#extension_in_public)

---
