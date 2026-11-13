import { LogEntry } from '../types.js';

/**
 * Intelligent Log Parser & Support Issue Matcher for Supabase
 * Parses log lines from PostgreSQL, GoTrue Auth, Supavisor, Storage API, and PostgREST.
 * Automatically links error lines to the relevant Supabase Support Diagnostic Check.
 */
export function parseRawLogs(rawLogText: string): LogEntry[] {
  const lines = rawLogText.split('\n').filter((l) => l.trim().length > 0);
  const entries: LogEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Try parsing as JSON first (Supabase structured log format)
    if (line.startsWith('{') && line.endsWith('}')) {
      try {
        const json = JSON.parse(line);
        const timestamp =
          json.timestamp ||
          json.time ||
          json.created_at ||
          new Date(Date.now() - (lines.length - i) * 1000).toISOString();
        const level = parseLogLevel(json.level || json.severity || json.status || 'info');
        const service = parseLogService(json.service || json.event_message || json.msg || line);
        const message = json.event_message || json.msg || json.message || line;

        entries.push({
          id: json.id || `log-${Date.now()}-${i}`,
          timestamp,
          service,
          level,
          message: typeof message === 'object' ? JSON.stringify(message) : String(message),
          metadata: json,
          matchedCheckId: matchSupportIssue(String(message)),
        });
        continue;
      } catch {
        // Fall back to line parsing
      }
    }

    // Standard text log parsing
    const timestampMatch = line.match(/^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/);
    const timestamp = timestampMatch
      ? new Date(timestampMatch[0]).toISOString()
      : new Date(Date.now() - (lines.length - i) * 2000).toISOString();

    const level = parseLogLevel(line);
    const service = parseLogService(line);
    const matchedCheckId = matchSupportIssue(line);

    entries.push({
      id: `log-${i}-${Date.now()}`,
      timestamp,
      service,
      level,
      message: line,
      matchedCheckId,
    });
  }

  return entries;
}

function parseLogLevel(text: string): LogEntry['level'] {
  const lower = text.toLowerCase();
  if (lower.includes('fatal') || lower.includes('panic') || lower.includes('emerg') || lower.includes('500') || lower.includes('504')) {
    return 'fatal';
  }
  if (lower.includes('error') || lower.includes('err') || lower.includes('fail') || lower.includes('abort')) {
    return 'error';
  }
  if (lower.includes('warn') || lower.includes('warning') || lower.includes('429')) {
    return 'warning';
  }
  if (lower.includes('debug') || lower.includes('trace')) {
    return 'debug';
  }
  return 'info';
}

function parseLogService(text: string): LogEntry['service'] {
  const lower = text.toLowerCase();
  if (lower.includes('gotrue') || lower.includes('auth') || lower.includes('user') || lower.includes('/signup') || lower.includes('/token')) {
    return 'auth';
  }
  if (lower.includes('supavisor') || lower.includes('pgbouncer') || lower.includes('pooler') || lower.includes('6543')) {
    return 'pooler';
  }
  if (lower.includes('storage') || lower.includes('bucket') || lower.includes('multipart') || lower.includes('objects')) {
    return 'storage';
  }
  if (lower.includes('postgrest') || lower.includes('/rest/v1') || lower.includes('rest api')) {
    return 'api';
  }
  return 'postgres';
}

/**
 * Smart Matcher: Maps log messages to Top 10 Supabase Support Bottlenecks
 */
export function matchSupportIssue(message: string): string | undefined {
  const lower = message.toLowerCase();

  // 1. Unwrapped auth.uid() / timeout
  if (
    (lower.includes('statement timeout') || lower.includes('canceling statement due to statement timeout')) &&
    (lower.includes('auth.uid()') || lower.includes('auth.jwt()') || lower.includes('policies'))
  ) {
    return 'RLS_UNWRAPPED_AUTH_FUNC';
  }

  // 2. Prepared statement mismatch on port 6543
  if (
    lower.includes('prepared statement') &&
    (lower.includes('already exists') || lower.includes('does not exist'))
  ) {
    return 'POOLER_PORT_AND_PREPARED_STMT_MISMATCH';
  }

  // 3. GoTrue Auth Trigger Rollback
  if (
    lower.includes('database error saving new user') ||
    (lower.includes('auth.users') && lower.includes('trigger') && lower.includes('rollback')) ||
    (lower.includes('500') && lower.includes('/signup'))
  ) {
    return 'AUTH_USERS_BLOCKING_TRIGGERS';
  }

  // 4. Storage Objects RLS violation
  if (
    lower.includes('new row violates row-level security policy for table "objects"') ||
    (lower.includes('storage.objects') && lower.includes('violates row-level security'))
  ) {
    return 'STORAGE_ORPHANED_OBJECTS_AND_POLICIES';
  }

  // 5. Connection pool exhaustion
  if (
    lower.includes('sorry, too many clients already') ||
    lower.includes('max client connections reached') ||
    (lower.includes('idle in transaction') && lower.includes('timeout'))
  ) {
    return 'CONNECTION_EXHAUSTION_AND_IDLE_LEAKS';
  }

  // 6. Realtime replica identity
  if (
    lower.includes('replica identity default') ||
    (lower.includes('supabase_realtime') && lower.includes('payload.old'))
  ) {
    return 'REALTIME_PUBLICATION_MISCONFIG';
  }

  // 7. Unindexed foreign key lock contention
  if (
    lower.includes('deadlock detected') ||
    (lower.includes('lock wait timeout') && lower.includes('foreign key'))
  ) {
    return 'RLS_MISSING_INDEX';
  }

  return undefined;
}
