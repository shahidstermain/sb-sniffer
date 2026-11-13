import { DiagnosticFinding, DiagnosticSnapshot } from '../types.js';
import { checkRlsUnwrappedAuthFunc } from './rlsUnwrappedAuth.js';
import { checkRlsMissingIndex } from './rlsMissingIndex.js';
import { checkRlsDisabledOrLockedOut } from './rlsDisabledOrLockedOut.js';
import { checkPoolerMismatch } from './poolerMismatch.js';
import { checkConnectionExhaustion } from './connectionExhaustion.js';
import { checkAuthUsersTriggers } from './authTriggers.js';
import { checkStorageOrphanedObjects } from './storageOrphans.js';
import { checkRealtimeConfig } from './realtimeConfig.js';
import { checkStatStatements } from './statStatements.js';
import { checkSchemaHygiene } from './schemaHygiene.js';
import { checkAppCodeSecurity } from './appCodeSecurity.js';
import { checkAppDbCorrelation } from './appDbCorrelation.js';
import { checkEgressCostDrivers } from './egressCostDrivers.js';
import { checkSplinterParity } from './splinterParity.js';

export * from './rlsUnwrappedAuth.js';
export * from './rlsMissingIndex.js';
export * from './rlsDisabledOrLockedOut.js';
export * from './poolerMismatch.js';
export * from './connectionExhaustion.js';
export * from './authTriggers.js';
export * from './storageOrphans.js';
export * from './realtimeConfig.js';
export * from './statStatements.js';
export * from './schemaHygiene.js';
export * from './appCodeSecurity.js';
export * from './appDbCorrelation.js';
export * from './egressCostDrivers.js';
export * from './splinterParity.js';

export const ALL_CHECKS = [
  checkRlsUnwrappedAuthFunc,
  checkRlsMissingIndex,
  checkRlsDisabledOrLockedOut,
  checkPoolerMismatch,
  checkConnectionExhaustion,
  checkAuthUsersTriggers,
  checkStorageOrphanedObjects,
  checkRealtimeConfig,
  checkStatStatements,
  checkSchemaHygiene,
  checkAppCodeSecurity,
  checkAppDbCorrelation,
  checkEgressCostDrivers,
  checkSplinterParity,
];

export function runAllChecks(snapshot: DiagnosticSnapshot): DiagnosticFinding[] {
  const findings: DiagnosticFinding[] = [];

  for (const check of ALL_CHECKS) {
    try {
      const result = check(snapshot);
      if (result) {
        findings.push(result);
      }
    } catch (err) {
      console.error(`Error running check ${check.name}:`, err);
    }
  }

  // Sort findings by severity: critical -> high -> medium -> info
  const severityOrder = { critical: 0, high: 1, medium: 2, info: 3 };
  findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return findings;
}
