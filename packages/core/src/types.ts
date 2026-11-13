export type Severity = 'critical' | 'high' | 'medium' | 'info';

export type CheckCategory =
  | 'rls'
  | 'connection_pooler'
  | 'auth'
  | 'storage'
  | 'realtime'
  | 'performance'
  | 'hygiene'
  | 'app_code'
  | 'egress_cost';

export interface AffectedObject {
  schema?: string;
  name: string;
  type:
    | 'table'
    | 'policy'
    | 'index'
    | 'trigger'
    | 'function'
    | 'connection'
    | 'extension'
    | 'query'
    | 'env'
    | 'code'
    | 'bucket'
    | 'view'
    | 'matview'
    | 'foreign_table';
  detail?: string;
}

export interface DiagnosticFinding {
  id: string; // e.g., 'RLS_UNWRAPPED_AUTH_FUNC'
  category: CheckCategory;
  severity: Severity;
  title: string;
  summary: string;
  whyItClogsSupport: string;
  affectedObjects: AffectedObject[];
  remediationExplanation: string;
  fixSql?: string;
  documentationUrl?: string;
  metadata?: Record<string, any>;
}

export interface PolicyInfo {
  schema: string;
  table: string;
  name: string;
  command: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'ALL';
  permissive: 'PERMISSIVE' | 'RESTRICTIVE';
  roles: string[];
  qual?: string | null;
  withCheck?: string | null;
}

export interface TableInfo {
  schema: string;
  name: string;
  rlsEnabled: boolean;
  replicaIdentity: 'd' | 'n' | 'f' | 'i'; // default, nothing, full, index
  totalRowsEstimate?: number;
  deadTuples?: number;
  liveTuples?: number;
}

export interface IndexInfo {
  schema: string;
  table: string;
  name: string;
  columns: string[];
  isUnique: boolean;
  isPrimary: boolean;
  isValid?: boolean;
  scans?: number;
  sizeBytes?: number;
}

export interface ForeignKeyInfo {
  schema: string;
  table: string;
  name: string;
  columns: string[];
  foreignSchema: string;
  foreignTable: string;
  foreignColumns: string[];
}

export interface TriggerInfo {
  schema: string;
  table: string;
  name: string;
  functionSchema: string;
  functionName: string;
  timing: string;
  event: string;
  functionDef?: string;
  isSecurityDefiner?: boolean;
  proConfig?: string[] | null;
}

export interface ExtensionInfo {
  name: string;
  schema: string;
  version: string;
}

export interface ConnectionInfo {
  port?: number;
  maxConnections: number;
  activeConnections: number;
  idleConnections: number;
  idleInTransaction: number;
  idleInTransactionLongestSeconds?: number;
  connectionsByApp?: Record<string, number>;
  preparedStatementsCount?: number;
  isSupavisorDetected?: boolean;
  poolerMode?: 'transaction' | 'session' | 'direct';
}

export interface StatStatementInfo {
  queryId?: string;
  query: string;
  calls: number;
  totalExecTimeMs: number;
  meanExecTimeMs: number;
  rows: number;
  sharedBlksHit: number;
  sharedBlksRead: number;
  cacheHitRatio?: number;
}

export interface StatActivityInfo {
  pid: number;
  user: string;
  clientAddr?: string;
  applicationName: string;
  state: 'active' | 'idle' | 'idle in transaction' | 'idle in transaction (aborted)' | 'fastpath function call' | 'disabled';
  waitEventType?: string | null;
  waitEvent?: string | null;
  query: string;
  durationSeconds: number;
  stateChange?: string;
}

export interface StatTableInfo {
  schema: string;
  table: string;
  seqScan: number;
  seqTupRead: number;
  idxScan: number;
  idxTupFetch: number;
  nLiveTup: number;
  nDeadTup: number;
  deadTupleRatio: number;
  lastVacuum?: string | null;
  lastAutovacuum?: string | null;
  sizeBytes?: number;
}

export interface StatUserIndexInfo {
  schema: string;
  table: string;
  indexName: string;
  idxScan: number;
  idxTupRead: number;
  idxTupFetch: number;
  sizeBytes: number;
  isUnused: boolean;
}

export interface StorageObjectInfo {
  bucketId: string;
  name: string;
  owner?: string | null;
  createdAt?: string;
}

export interface StorageBucketInfo {
  id: string;
  name: string;
  public: boolean;
}

export interface RealtimeTableInfo {
  schema: string;
  table: string;
  inPublication: boolean;
  replicaIdentity: 'd' | 'n' | 'f' | 'i';
  rlsEnabled: boolean;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  service: 'postgres' | 'auth' | 'pooler' | 'storage' | 'api';
  level: 'fatal' | 'error' | 'warning' | 'info' | 'debug';
  message: string;
  metadata?: Record<string, any>;
  matchedCheckId?: string; // Links log line directly to one of the 10 diagnostic checks!
}

export interface AppCodeFindingItem {
  file: string;
  line: number;
  snippet: string;
  kind:
    | 'service_role_leak'
    | 'pooler_6543_missing_pgbouncer'
    | 'drizzle_missing_prepare_false'
    | 'insecure_get_session'
    | 'unbounded_select_star'
    | 'app_filter_call';
  table?: string;
  column?: string;
  detail: string;
}

export interface AppCodeSnapshot {
  scannedFiles: number;
  items: AppCodeFindingItem[];
}

export interface ViewInfo {
  schema: string;
  name: string;
  securityInvoker: boolean;
  definition?: string;
}

export interface MaterializedViewInfo {
  schema: string;
  name: string;
  definition?: string;
}

export interface ForeignTableInfo {
  schema: string;
  name: string;
}

export interface DiagnosticSnapshot {
  timestamp: string;
  projectName?: string;
  source: 'live_connection' | 'schema_dump' | 'studio_json' | 'demo';
  tables: TableInfo[];
  policies: PolicyInfo[];
  indexes: IndexInfo[];
  foreignKeys: ForeignKeyInfo[];
  triggers: TriggerInfo[];
  extensions: ExtensionInfo[];
  views?: ViewInfo[];
  materializedViews?: MaterializedViewInfo[];
  foreignTables?: ForeignTableInfo[];
  connections?: ConnectionInfo;
  statStatements?: StatStatementInfo[];
  statActivity?: StatActivityInfo[];
  statTables?: StatTableInfo[];
  statUserIndexes?: StatUserIndexInfo[];
  storageObjects?: StorageObjectInfo[];
  storageBuckets?: StorageBucketInfo[];
  realtimeTables?: RealtimeTableInfo[];
  logs?: LogEntry[];
  appCode?: AppCodeSnapshot;
  rawMeta?: Record<string, any>;
}

export interface CategoryScore {
  score: number; // 0 - 100
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  infoCount: number;
}

export interface DiagnosticReport {
  timestamp: string;
  source: string;
  healthScore: number; // 0 - 100
  grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  categoryScores: Record<CheckCategory, CategoryScore>;
  findings: DiagnosticFinding[];
  summary: {
    totalFindings: number;
    criticalCount: number;
    highCount: number;
    mediumCount: number;
    infoCount: number;
  };
}
