import { CategoryScore, CheckCategory, DiagnosticFinding, DiagnosticReport } from '../types.js';

const SEVERITY_PENALTIES = {
  critical: 25,
  high: 12,
  medium: 5,
  info: 1,
};

export function calculateHealthScore(findings: DiagnosticFinding[]): {
  healthScore: number;
  grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  categoryScores: Record<CheckCategory, CategoryScore>;
  summary: DiagnosticReport['summary'];
} {
  const categories: CheckCategory[] = [
    'rls',
    'connection_pooler',
    'auth',
    'storage',
    'realtime',
    'performance',
    'hygiene',
    'app_code',
    'egress_cost',
  ];

  const categoryScores: Record<CheckCategory, CategoryScore> = {
    rls: { score: 100, criticalCount: 0, highCount: 0, mediumCount: 0, infoCount: 0 },
    connection_pooler: { score: 100, criticalCount: 0, highCount: 0, mediumCount: 0, infoCount: 0 },
    auth: { score: 100, criticalCount: 0, highCount: 0, mediumCount: 0, infoCount: 0 },
    storage: { score: 100, criticalCount: 0, highCount: 0, mediumCount: 0, infoCount: 0 },
    realtime: { score: 100, criticalCount: 0, highCount: 0, mediumCount: 0, infoCount: 0 },
    performance: { score: 100, criticalCount: 0, highCount: 0, mediumCount: 0, infoCount: 0 },
    hygiene: { score: 100, criticalCount: 0, highCount: 0, mediumCount: 0, infoCount: 0 },
    app_code: { score: 100, criticalCount: 0, highCount: 0, mediumCount: 0, infoCount: 0 },
    egress_cost: { score: 100, criticalCount: 0, highCount: 0, mediumCount: 0, infoCount: 0 },
  };

  let totalDeduction = 0;
  let criticalCount = 0;
  let highCount = 0;
  let mediumCount = 0;
  let infoCount = 0;

  for (const finding of findings) {
    const penalty = SEVERITY_PENALTIES[finding.severity] || 0;
    totalDeduction += penalty;

    const cat = categoryScores[finding.category];
    if (cat) {
      cat.score = Math.max(0, cat.score - penalty * 1.5);
      if (finding.severity === 'critical') cat.criticalCount++;
      else if (finding.severity === 'high') cat.highCount++;
      else if (finding.severity === 'medium') cat.mediumCount++;
      else if (finding.severity === 'info') cat.infoCount++;
    }

    if (finding.severity === 'critical') criticalCount++;
    else if (finding.severity === 'high') highCount++;
    else if (finding.severity === 'medium') mediumCount++;
    else if (finding.severity === 'info') infoCount++;
  }

  // Bound overall score between 0 and 100
  const healthScore = Math.max(0, Math.min(100, Math.round(100 - totalDeduction)));

  let grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F' = 'F';
  if (healthScore >= 97) grade = 'A+';
  else if (healthScore >= 90) grade = 'A';
  else if (healthScore >= 80) grade = 'B';
  else if (healthScore >= 70) grade = 'C';
  else if (healthScore >= 60) grade = 'D';

  return {
    healthScore,
    grade,
    categoryScores,
    summary: {
      totalFindings: findings.length,
      criticalCount,
      highCount,
      mediumCount,
      infoCount,
    },
  };
}
