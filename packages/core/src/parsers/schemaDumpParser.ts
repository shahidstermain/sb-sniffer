import { parse, Statement } from 'pgsql-ast-parser';
import {
  DiagnosticSnapshot,
  ExtensionInfo,
  ForeignKeyInfo,
  ForeignTableInfo,
  IndexInfo,
  MaterializedViewInfo,
  PolicyInfo,
  RealtimeTableInfo,
  TableInfo,
  TriggerInfo,
  ViewInfo,
} from '../types.js';

/**
 * Splits SQL into individual statements while respecting single-quoted strings,
 * double-quoted identifiers, line comments (--), block comments, and $$ dollar-quoted blocks.
 */
function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let dollarTag: string | null = null;

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    // Line comment
    if (!inSingleQuote && !inDoubleQuote && !dollarTag && ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      if (end === -1) break;
      i = end + 1;
      continue;
    }

    // Block comment
    if (!inSingleQuote && !inDoubleQuote && !dollarTag && ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      if (end === -1) break;
      i = end + 2;
      continue;
    }

    // Dollar-quoted string ($tag$...$tag$ or $$...$$)
    if (!inSingleQuote && !inDoubleQuote && ch === '$') {
      const tagMatch = sql.slice(i).match(/^\$[a-zA-Z0-9_]*\$/);
      if (tagMatch) {
        const tag = tagMatch[0];
        if (!dollarTag) {
          dollarTag = tag;
          current += tag;
          i += tag.length;
          continue;
        } else if (dollarTag === tag) {
          dollarTag = null;
          current += tag;
          i += tag.length;
          continue;
        }
      }
    }

    if (!dollarTag && !inDoubleQuote && ch === "'") {
      if (inSingleQuote && next === "'") {
        current += "''";
        i += 2;
        continue;
      }
      inSingleQuote = !inSingleQuote;
    } else if (!dollarTag && !inSingleQuote && ch === '"') {
      inDoubleQuote = !inDoubleQuote;
    } else if (!dollarTag && !inSingleQuote && !inDoubleQuote && ch === ';') {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed + ';');
      current = '';
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  const tail = current.trim();
  if (tail) statements.push(tail + (tail.endsWith(';') ? '' : ';'));
  return statements;
}

/**
 * Extracts the balanced parenthesized expression following a SQL keyword (e.g. USING (...) or WITH CHECK (...)).
 */
function extractParenClause(text: string, keywordRegex: RegExp): string | null {
  const match = keywordRegex.exec(text);
  if (!match) return null;

  const openIdx = text.indexOf('(', match.index + match[0].length - 1);
  if (openIdx === -1) return null;

  let depth = 0;
  let inSingle = false;
  let inDouble = false;

  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (!inDouble && ch === "'") {
      if (inSingle && next === "'") {
        i++;
        continue;
      }
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && ch === '"') {
      inDouble = !inDouble;
      continue;
    }
    if (inSingle || inDouble) continue;
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) {
        return text.slice(openIdx + 1, i).trim();
      }
    }
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parses raw SQL statements typically output by `pg_dump --schema-only`
 * or Supabase migration scripts into a DiagnosticSnapshot using `pgsql-ast-parser`
 * with resilient statement-level fallback for Supabase/PG extensions (RLS policies, publications, triggers).
 */
export function parseSchemaDump(sqlContent: string): DiagnosticSnapshot {
  const tables: TableInfo[] = [];
  const policies: PolicyInfo[] = [];
  const indexes: IndexInfo[] = [];
  const foreignKeys: ForeignKeyInfo[] = [];
  const triggers: TriggerInfo[] = [];
  const extensions: ExtensionInfo[] = [];
  const realtimeTables: RealtimeTableInfo[] = [];
  const views: ViewInfo[] = [];
  const materializedViews: MaterializedViewInfo[] = [];
  const foreignTables: ForeignTableInfo[] = [];

  const statements = splitSqlStatements(sqlContent);

  const ensureTable = (schema: string, name: string): TableInfo => {
    let found = tables.find((t) => t.schema === schema && t.name === name);
    if (!found) {
      found = { schema, name, rlsEnabled: false, replicaIdentity: 'd' };
      tables.push(found);
    }
    return found;
  };

  for (const stmtSql of statements) {
    let parsedAst: Statement[] | null = null;
    try {
      parsedAst = parse(stmtSql);
    } catch {
      parsedAst = null;
    }

    if (parsedAst && parsedAst.length > 0) {
      for (const stmt of parsedAst) {
        if (stmt.type === 'create table') {
          const schema = stmt.name.schema || 'public';
          const tableName = stmt.name.name;
          ensureTable(schema, tableName);

          for (const col of stmt.columns) {
            if (col.kind === 'column' && col.constraints) {
              for (const c of col.constraints) {
                if (c.type === 'primary key' || c.type === 'unique') {
                  const isPk = c.type === 'primary key';
                  indexes.push({
                    schema,
                    table: tableName,
                    name: `${tableName}_${col.name.name}_${isPk ? 'pkey' : 'key'}`,
                    columns: [col.name.name],
                    isUnique: true,
                    isPrimary: isPk,
                  });
                }
                if (c.type === 'reference') {
                  foreignKeys.push({
                    schema,
                    table: tableName,
                    name: `fk_${tableName}_${col.name.name}`,
                    columns: [col.name.name],
                    foreignSchema: c.foreignTable.schema || 'public',
                    foreignTable: c.foreignTable.name,
                    foreignColumns: c.foreignColumns.map((fc) => fc.name),
                  });
                }
              }
            }
          }

          for (const c of stmt.constraints || []) {
            if (c.type === 'primary key' || c.type === 'unique') {
              const isPk = c.type === 'primary key';
              const cols = (c.columns || []).map((x: any) => x.name);
              indexes.push({
                schema,
                table: tableName,
                name: c.constraintName?.name || `${tableName}_${cols.join('_')}_${isPk ? 'pkey' : 'key'}`,
                columns: cols,
                isUnique: true,
                isPrimary: isPk,
              });
            }
            if (c.type === 'foreign key') {
              const cols = c.localColumns.map((lc) => lc.name);
              foreignKeys.push({
                schema,
                table: tableName,
                name: c.constraintName?.name || `fk_${tableName}_${cols.join('_')}`,
                columns: cols,
                foreignSchema: c.foreignTable.schema || 'public',
                foreignTable: c.foreignTable.name,
                foreignColumns: c.foreignColumns.map((fc) => fc.name),
              });
            }
          }
          continue;
        }

        if (stmt.type === 'create index') {
          const schema = stmt.table.schema || 'public';
          const tableName = stmt.table.name;
          const idxName = stmt.indexName?.name || `idx_${tableName}`;
          const cols = stmt.expressions
            .map((e) => (e.expression.type === 'ref' ? e.expression.name : ''))
            .filter(Boolean);
          indexes.push({
            schema,
            table: tableName,
            name: idxName,
            columns: cols,
            isUnique: !!stmt.unique,
            isPrimary: false,
          });
          continue;
        }

        if (stmt.type === 'create view') {
          const schema = stmt.name.schema || 'public';
          const viewName = stmt.name.name;
          const hasSecurityInvoker = /security_invoker\s*=\s*(true|on|1)/i.test(stmtSql);
          views.push({
            schema,
            name: viewName,
            securityInvoker: hasSecurityInvoker,
            definition: stmtSql,
          });
          continue;
        }

        if (stmt.type === 'create materialized view') {
          const schema = stmt.name.schema || 'public';
          materializedViews.push({
            schema,
            name: stmt.name.name,
            definition: stmtSql,
          });
          continue;
        }
      }
    }

    // Fallback / Supabase-specific DDL handling (ALTER TABLE RLS/FK/REPLICA, CREATE POLICY, EXTENSION, TRIGGER, PUBLICATION, VIEW options)
    let match: RegExpExecArray | null;

    // CREATE VIEW fallback (when WITH (security_invoker = true) isn't supported by pgsql-ast-parser)
    if (!parsedAst && /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+/i.test(stmtSql)) {
      const viewMatch = stmtSql.match(
        /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:([a-zA-Z0-9_"]+)\.)?([a-zA-Z0-9_"]+)/i
      );
      if (viewMatch) {
        const sName = viewMatch[1] ? viewMatch[1].replace(/"/g, '') : 'public';
        const vName = viewMatch[2].replace(/"/g, '');
        if (!views.some((v) => v.schema === sName && v.name === vName)) {
          views.push({
            schema: sName,
            name: vName,
            securityInvoker: /security_invoker\s*=\s*(true|on|1)/i.test(stmtSql),
            definition: stmtSql,
          });
        }
      }
    }

    // CREATE MATERIALIZED VIEW fallback
    if (!parsedAst && /^\s*CREATE\s+MATERIALIZED\s+VIEW\s+/i.test(stmtSql)) {
      const mvMatch = stmtSql.match(
        /CREATE\s+MATERIALIZED\s+VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:([a-zA-Z0-9_"]+)\.)?([a-zA-Z0-9_"]+)/i
      );
      if (mvMatch) {
        const sName = mvMatch[1] ? mvMatch[1].replace(/"/g, '') : 'public';
        const mvName = mvMatch[2].replace(/"/g, '');
        if (!materializedViews.some((m) => m.schema === sName && m.name === mvName)) {
          materializedViews.push({ schema: sName, name: mvName, definition: stmtSql });
        }
      }
    }

    // CREATE FOREIGN TABLE
    if (/^\s*CREATE\s+FOREIGN\s+TABLE\s+/i.test(stmtSql)) {
      const ftMatch = stmtSql.match(
        /CREATE\s+FOREIGN\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:([a-zA-Z0-9_"]+)\.)?([a-zA-Z0-9_"]+)/i
      );
      if (ftMatch) {
        foreignTables.push({
          schema: ftMatch[1] ? ftMatch[1].replace(/"/g, '') : 'public',
          name: ftMatch[2].replace(/"/g, ''),
        });
      }
    }

    // ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY
    const alterFkRegex = /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:([a-zA-Z0-9_"]+)\.)?([a-zA-Z0-9_"]+)\s+ADD\s+CONSTRAINT\s+([a-zA-Z0-9_"]+)\s+FOREIGN\s+KEY\s*\(([a-zA-Z0-9_,\s"]+)\)\s*REFERENCES\s+(?:([a-zA-Z0-9_"]+)\.)?([a-zA-Z0-9_"]+)\s*\(([a-zA-Z0-9_,\s"]+)\)/gi;
    while ((match = alterFkRegex.exec(stmtSql)) !== null) {
      const sName = match[1] ? match[1].replace(/"/g, '') : 'public';
      const tName = match[2].replace(/"/g, '');
      const cName = match[3].replace(/"/g, '');
      const cols = match[4].split(',').map((c) => c.trim().replace(/"/g, ''));
      const fSchema = match[5] ? match[5].replace(/"/g, '') : 'public';
      const fTable = match[6].replace(/"/g, '');
      const fCols = match[7].split(',').map((c) => c.trim().replace(/"/g, ''));

      foreignKeys.push({
        schema: sName,
        table: tName,
        name: cName,
        columns: cols,
        foreignSchema: fSchema,
        foreignTable: fTable,
        foreignColumns: fCols,
      });
    }

    // ALTER TABLE ... ENABLE ROW LEVEL SECURITY
    const rlsRegex = /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:([a-zA-Z0-9_"]+)\.)?([a-zA-Z0-9_"]+)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi;
    while ((match = rlsRegex.exec(stmtSql)) !== null) {
      const sName = match[1] ? match[1].replace(/"/g, '') : 'public';
      const tName = match[2].replace(/"/g, '');
      ensureTable(sName, tName).rlsEnabled = true;
    }

    // ALTER TABLE ... DISABLE ROW LEVEL SECURITY
    const rlsOffRegex = /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:([a-zA-Z0-9_"]+)\.)?([a-zA-Z0-9_"]+)\s+DISABLE\s+ROW\s+LEVEL\s+SECURITY/gi;
    while ((match = rlsOffRegex.exec(stmtSql)) !== null) {
      const sName = match[1] ? match[1].replace(/"/g, '') : 'public';
      ensureTable(sName, match[2].replace(/"/g, '')).rlsEnabled = false;
    }

    // ALTER TABLE ... ADD [CONSTRAINT x] PRIMARY KEY / UNIQUE (cols)  (pg_dump style)
    const alterKeyRegex = /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:([a-zA-Z0-9_"]+)\.)?([a-zA-Z0-9_"]+)\s+ADD\s+(?:CONSTRAINT\s+([a-zA-Z0-9_"]+)\s+)?(PRIMARY\s+KEY|UNIQUE)\s*\(([a-zA-Z0-9_,\s"]+)\)/gi;
    while ((match = alterKeyRegex.exec(stmtSql)) !== null) {
      const sName = match[1] ? match[1].replace(/"/g, '') : 'public';
      const tName = match[2].replace(/"/g, '');
      const isPk = /PRIMARY/i.test(match[4]);
      const cols = match[5].split(',').map((c) => c.trim().replace(/"/g, ''));
      indexes.push({
        schema: sName,
        table: tName,
        name: match[3] ? match[3].replace(/"/g, '') : `${tName}_${cols.join('_')}_${isPk ? 'pkey' : 'key'}`,
        columns: cols,
        isUnique: true,
        isPrimary: isPk,
      });
    }

    // DROP TABLE [IF EXISTS]
    const dropTableRegex = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:([a-zA-Z0-9_"]+)\.)?([a-zA-Z0-9_"]+)/gi;
    while ((match = dropTableRegex.exec(stmtSql)) !== null) {
      const sName = match[1] ? match[1].replace(/"/g, '') : 'public';
      const tName = match[2].replace(/"/g, '');
      const idx = tables.findIndex((t) => t.schema === sName && t.name === tName);
      if (idx >= 0) tables.splice(idx, 1);
      for (let i = policies.length - 1; i >= 0; i--) {
        if (policies[i].schema === sName && policies[i].table === tName) policies.splice(i, 1);
      }
      for (let i = indexes.length - 1; i >= 0; i--) {
        if (indexes[i].schema === sName && indexes[i].table === tName) indexes.splice(i, 1);
      }
      for (let i = foreignKeys.length - 1; i >= 0; i--) {
        if (foreignKeys[i].schema === sName && foreignKeys[i].table === tName) foreignKeys.splice(i, 1);
      }
    }

    // DROP INDEX [IF EXISTS]
    const dropIndexRegex = /DROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?(?:([a-zA-Z0-9_"]+)\.)?([a-zA-Z0-9_"]+)/gi;
    while ((match = dropIndexRegex.exec(stmtSql)) !== null) {
      const sName = match[1] ? match[1].replace(/"/g, '') : 'public';
      const iName = match[2].replace(/"/g, '');
      const idx = indexes.findIndex((x) => x.schema === sName && x.name === iName);
      if (idx >= 0) indexes.splice(idx, 1);
    }

    // DROP POLICY [IF EXISTS] "name" ON table
    const dropPolicyRegex = /DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?("[^"]+"|[a-zA-Z0-9_]+)\s+ON\s+(?:([a-zA-Z0-9_"]+)\.)?([a-zA-Z0-9_"]+)/gi;
    while ((match = dropPolicyRegex.exec(stmtSql)) !== null) {
      const n = match[1].replace(/"/g, '');
      const sName = match[2] ? match[2].replace(/"/g, '') : 'public';
      const tName = match[3].replace(/"/g, '');
      const i = policies.findIndex((p) => p.name === n && p.schema === sName && p.table === tName);
      if (i >= 0) policies.splice(i, 1);
    }

    // ALTER TABLE ... REPLICA IDENTITY
    const replicaRegex = /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:([a-zA-Z0-9_"]+)\.)?([a-zA-Z0-9_"]+)\s+REPLICA\s+IDENTITY\s+([A-Z]+)/gi;
    while ((match = replicaRegex.exec(stmtSql)) !== null) {
      const sName = match[1] ? match[1].replace(/"/g, '') : 'public';
      const tName = match[2].replace(/"/g, '');
      const mode = match[3].toUpperCase();
      const code = mode === 'FULL' ? 'f' : mode === 'NOTHING' ? 'n' : mode === 'INDEX' ? 'i' : 'd';
      ensureTable(sName, tName).replicaIdentity = code;
    }

    // CREATE POLICY
    const policyRegex = /CREATE\s+POLICY\s+("[^"]+"|[a-zA-Z0-9_]+)\s+ON\s+(?:([a-zA-Z0-9_"]+)\.)?([a-zA-Z0-9_"]+)([\s\S]*?);/gi;
    while ((match = policyRegex.exec(stmtSql)) !== null) {
      const pName = match[1].replace(/"/g, '');
      const sName = match[2] ? match[2].replace(/"/g, '') : 'public';
      const tName = match[3].replace(/"/g, '');
      const rest = match[4];

      const permissiveMatch = rest.match(/AS\s+(PERMISSIVE|RESTRICTIVE)/i);
      const permissive = (permissiveMatch ? permissiveMatch[1].toUpperCase() : 'PERMISSIVE') as 'PERMISSIVE' | 'RESTRICTIVE';

      const commandMatch = rest.match(/FOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)/i);
      const command = (commandMatch ? commandMatch[1].toUpperCase() : 'ALL') as PolicyInfo['command'];

      const rolesMatch = rest.match(/TO\s+([a-zA-Z0-9_,\s"]+?)(?:\s+USING|\s+WITH\s+CHECK|$)/i);
      const roles = rolesMatch ? rolesMatch[1].split(',').map((r) => r.trim().replace(/"/g, '')) : ['public'];

      const qual = extractParenClause(rest, /\bUSING\s*\(/i);
      const withCheck = extractParenClause(rest, /\bWITH\s+CHECK\s*\(/i);

      policies.push({
        schema: sName,
        table: tName,
        name: pName,
        command,
        permissive,
        roles,
        qual,
        withCheck,
      });
    }

    // CREATE EXTENSION
    const extRegex = /CREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?("[^"]+"|[a-zA-Z0-9_-]+)(?:[\s\S]*?SCHEMA\s+([a-zA-Z0-9_"]+))?/gi;
    while ((match = extRegex.exec(stmtSql)) !== null) {
      extensions.push({
        name: match[1].replace(/"/g, ''),
        schema: match[2] ? match[2].replace(/"/g, '') : 'public',
        version: '1.0',
      });
    }

    // CREATE TRIGGER
    const triggerRegex = /CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+([a-zA-Z0-9_"]+)\s+(BEFORE|AFTER|INSTEAD\s+OF)\s+([a-zA-Z0-9_\s]+?)\s+ON\s+(?:([a-zA-Z0-9_"]+)\.)?([a-zA-Z0-9_"]+)\s+FOR\s+EACH\s+ROW\s+EXECUTE\s+(?:FUNCTION|PROCEDURE)\s+(?:([a-zA-Z0-9_"]+)\.)?([a-zA-Z0-9_"]+)\s*\(([\s\S]*?)\)/gi;
    while ((match = triggerRegex.exec(stmtSql)) !== null) {
      const fnSchema = match[6] ? match[6].replace(/"/g, '') : 'public';
      const fnName = match[7].replace(/"/g, '');
      const escapedSchema = escapeRegExp(fnSchema);
      const escapedFn = escapeRegExp(fnName);
      const fnRegex = new RegExp(
        `CREATE(?:\\s+OR\\s+REPLACE)?\\s+FUNCTION\\s+(?:"?${escapedSchema}"?\\.)?"?${escapedFn}"?\\s*\\([\\s\\S]*?\\)([\\s\\S]*?)(\\$[a-zA-Z0-9_]*\\$)([\\s\\S]*?)\\2`,
        'i'
      );
      const fnMatch = sqlContent.match(fnRegex);
      const fnHeader = fnMatch ? fnMatch[1] : '';
      const fnBody = fnMatch ? fnMatch[3] : undefined;
      const isSecDef = /\bSECURITY\s+DEFINER\b/i.test(fnHeader);
      const searchPathMatch = fnHeader.match(/\bSET\s+search_path\s*(?:=|TO)\s*([^\s;]+)/i);

      triggers.push({
        schema: match[4] ? match[4].replace(/"/g, '') : 'public',
        table: match[5].replace(/"/g, ''),
        name: match[1].replace(/"/g, ''),
        functionSchema: fnSchema,
        functionName: fnName,
        timing: match[2],
        event: match[3].trim(),
        functionDef: fnBody,
        isSecurityDefiner: isSecDef || undefined,
        proConfig: searchPathMatch ? [`search_path=${searchPathMatch[1]}`] : undefined,
      });
    }

    // ALTER PUBLICATION supabase_realtime ADD TABLE (supports comma-separated tables)
    const realtimeRegex = /ALTER\s+PUBLICATION\s+supabase_realtime\s+ADD\s+TABLE\s+([^;]+);/gi;
    while ((match = realtimeRegex.exec(stmtSql)) !== null) {
      const tableRefs = match[1].split(',');
      for (const rawRef of tableRefs) {
        const refMatch = rawRef.trim().match(/^(?:([a-zA-Z0-9_"]+)\.)?([a-zA-Z0-9_"]+)$/);
        if (!refMatch) continue;
        const sName = refMatch[1] ? refMatch[1].replace(/"/g, '') : 'public';
        const tName = refMatch[2].replace(/"/g, '');
        if (!realtimeTables.some((rt) => rt.schema === sName && rt.table === tName)) {
          const tbl = tables.find((t) => t.schema === sName && t.name === tName);
          realtimeTables.push({
            schema: sName,
            table: tName,
            inPublication: true,
            replicaIdentity: tbl?.replicaIdentity || 'd',
            rlsEnabled: tbl?.rlsEnabled || false,
          });
        }
      }
    }
  }

  // Sync realtimeTables replicaIdentity & rlsEnabled with final table state (handles out-of-order DDL)
  for (const rt of realtimeTables) {
    const tbl = tables.find((t) => t.schema === rt.schema && t.name === rt.table);
    if (tbl) {
      rt.replicaIdentity = tbl.replicaIdentity;
      rt.rlsEnabled = tbl.rlsEnabled;
    }
  }

  return {
    timestamp: new Date().toISOString(),
    source: 'schema_dump',
    tables,
    policies,
    indexes,
    foreignKeys,
    triggers,
    extensions,
    realtimeTables,
    views,
    materializedViews,
    foreignTables,
  };
}
