import {
  DiagnosticFinding,
  DiagnosticReport,
  DiagnosticSnapshot,
} from './types.js';
import { runAllChecks } from './checks/index.js';
import { calculateHealthScore } from './report/scorer.js';
import { formatFixAllSql, formatReportMarkdown } from './report/formatters.js';

export * from './types.js';
export * from './checks/index.js';
export * from './parsers/schemaDumpParser.js';
export * from './parsers/statStatementsParser.js';
export * from './parsers/studioJsonParser.js';
export * from './parsers/appCodeParser.js';
export * from './report/scorer.js';
export * from './report/formatters.js';
export * from './introspectionSql.js';
export * from './parsers/logParser.js';
export * from './demo/brokenSupabaseLogs.js';
export * from './demo/brokenSupabaseProject.js';

/**
 * Main engine entrypoint: analyzes a DiagnosticSnapshot and produces a complete DiagnosticReport.
 */
export function analyzeSnapshot(snapshot: DiagnosticSnapshot): DiagnosticReport {
  const findings: DiagnosticFinding[] = runAllChecks(snapshot);
  const scoreResult = calculateHealthScore(findings);

  return {
    timestamp: snapshot.timestamp || new Date().toISOString(),
    source: snapshot.source,
    healthScore: scoreResult.healthScore,
    grade: scoreResult.grade,
    categoryScores: scoreResult.categoryScores,
    findings,
    summary: scoreResult.summary,
  };
}
