import { DiagnosticFinding, DiagnosticSnapshot } from '../types.js';

export function checkStorageOrphanedObjects(snapshot: DiagnosticSnapshot): DiagnosticFinding | null {
  const storageObjects = snapshot.storageObjects || [];
  const storageBuckets = snapshot.storageBuckets || [];
  const validBucketIds = new Set(storageBuckets.map((b) => b.id));

  // Find storage policies
  const storagePolicies = snapshot.policies.filter((p) => p.schema === 'storage');

  // Check 1: Orphaned objects whose bucket does not exist
  const orphanedByBucket: typeof storageObjects = [];
  for (const obj of storageObjects) {
    if (validBucketIds.size > 0 && !validBucketIds.has(obj.bucketId)) {
      orphanedByBucket.push(obj);
    }
  }

  // Check 2: Missing RLS policies on storage.objects
  const objectsPolicies = storagePolicies.filter((p) => p.table === 'objects');
  const hasStorageObjectsPolicies = objectsPolicies.length > 0;

  // Check 3: Storage objects uploaded with no owner or invalid owner
  const unownedObjects = storageObjects.filter((o) => !o.owner);

  if (orphanedByBucket.length === 0 && hasStorageObjectsPolicies && unownedObjects.length === 0) {
    return null;
  }

  const affectedObjects: {
    schema?: string;
    name: string;
    type: 'table' | 'policy';
    detail: string;
  }[] = [];

  if (!hasStorageObjectsPolicies && (storageBuckets.length > 0 || storageObjects.length > 0)) {
    affectedObjects.push({
      schema: 'storage',
      name: 'objects',
      type: 'table',
      detail: 'storage.objects has 0 RLS policies configured. Client uploads or downloads will fail with "new row violates row-level security policy".',
    });
  }

  if (orphanedByBucket.length > 0) {
    affectedObjects.push({
      schema: 'storage',
      name: 'objects',
      type: 'table',
      detail: `${orphanedByBucket.length} storage object(s) point to non-existent buckets (${Array.from(new Set(orphanedByBucket.map((o) => o.bucketId))).join(', ')}).`,
    });
  }

  if (unownedObjects.length > 10) {
    affectedObjects.push({
      schema: 'storage',
      name: 'objects',
      type: 'table',
      detail: `${unownedObjects.length} storage object(s) have NULL owner. Common when files are uploaded anonymously before user signups.`,
    });
  }

  if (affectedObjects.length === 0) {
    return null;
  }

  const fixSql =
    '-- 1. Identify and purge orphaned objects from deleted buckets:\n' +
    'DELETE FROM storage.objects\n' +
    'WHERE bucket_id NOT IN (SELECT id FROM storage.buckets);\n\n' +
    '-- 2. Identify orphaned objects where owner does not exist in auth.users:\n' +
    'DELETE FROM storage.objects\n' +
    'WHERE owner IS NOT NULL AND owner NOT IN (SELECT id::text FROM auth.users);\n\n' +
    '-- 3. Example standard RLS policy allowing authenticated users to upload into their own folder:\n' +
    'CREATE POLICY "Allow authenticated user folder uploads" ON storage.objects\n' +
    'FOR INSERT TO authenticated\n' +
    'WITH CHECK (\n' +
    '  bucket_id = \'avatars\' AND\n' +
    '  (storage.foldername(name))[1] = (select auth.uid()::text)\n' +
    ');';

  return {
    id: 'STORAGE_ORPHANED_OBJECTS_AND_POLICIES',
    category: 'storage',
    severity: !hasStorageObjectsPolicies ? 'high' : 'medium',
    title: 'Storage Orphaned Objects and Missing Storage RLS Policies',
    summary:
      !hasStorageObjectsPolicies
        ? 'storage.objects has zero RLS policies defined, blocking client-side uploads.'
        : `Detected ${orphanedByBucket.length} orphaned storage object(s) referencing deleted buckets or owners.`,
    whyItClogsSupport:
      'A very common anti-pattern in apps is uploading an avatar or document to Supabase Storage before calling `supabase.auth.signUp()`. If signup fails or is abandoned, the object sits orphaned forever, driving up storage bills. Furthermore, developers often report `new row violates row-level security policy for table "objects"` because they forgot to add RLS policies on `storage.objects`.',
    affectedObjects,
    remediationExplanation:
      '1. Enforce client-side sequence: call `signUp()` first, obtain the `user.id`, then upload files to a path prefixed with that ID.\n' +
      '2. Ensure `storage.objects` has RLS policies scoped to `(storage.foldername(name))[1] = (select auth.uid()::text)`.\n' +
      '3. Periodically purge orphaned objects referencing deleted buckets or removed users.',
    fixSql,
    documentationUrl: 'https://supabase.com/docs/guides/storage/security/access-control',
    metadata: {
      orphanedCount: orphanedByBucket.length,
      unownedCount: unownedObjects.length,
      hasPolicies: hasStorageObjectsPolicies,
    },
  };
}
