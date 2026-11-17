import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeSnapshot, BROKEN_SUPABASE_PROJECT_SNAPSHOT, formatReportSarif,
  type DiagnosticFinding,
} from '../index.js';

const base = analyzeSnapshot(BROKEN_SUPABASE_PROJECT_SNAPSHOT);

test('SARIF maps all severities, deduplicates rules and preserves database objects', () => {
  const findings: DiagnosticFinding[] = ['critical', 'high', 'medium', 'info'].map((severity, i) => ({
    ...base.findings[0],
    id: i < 2 ? 'SHARED_RULE' : `RULE_${i}`,
    severity: severity as DiagnosticFinding['severity'],
    title: 'Policy "check"',
    summary: 'A summary\nwith a newline',
    affectedObjects: [
      { name: 'widgets', schema: 'public', type: 'table', detail: 'No policy' },
      { name: 'widgets', schema: 'public', type: 'table', detail: 'Another matching condition' },
    ],
  }));
  const sarif = JSON.parse(formatReportSarif({ ...base, findings }, 'schema.sql'));
  assert.equal(sarif.version, '2.1.0');
  assert.equal(sarif.$schema, 'https://json.schemastore.org/sarif-2.1.0.json');
  const run = sarif.runs[0];
  assert.equal(run.tool.driver.name, 'sb-sniffer');
  assert.equal(run.tool.driver.rules.length, 3);
  assert.deepEqual(run.results.map((r: { level: string }) => r.level), ['error', 'error', 'warning', 'note']);
  assert.deepEqual(run.results.map((r: { ruleId: string }) => r.ruleId), ['SHARED_RULE', 'SHARED_RULE', 'RULE_2', 'RULE_3']);
  assert.equal(run.tool.driver.rules[0].shortDescription.text, 'Policy "check"');
  assert.equal(run.results[0].message.text, 'Policy "check": A summary\nwith a newline');
  assert.equal(run.results[0].locations[0].physicalLocation.artifactLocation.uri, 'schema.sql');
  assert.equal(run.results[0].locations[0].physicalLocation.region, undefined);
  assert.equal(run.results[0].locations[0].logicalLocations[0].fullyQualifiedName, 'public.widgets');
  assert.equal(run.results[0].locations[0].logicalLocations.length, 1);
  assert.deepEqual(run.results[0].properties.affectedObjects, findings[0].affectedObjects);
});

test('SARIF handles empty reports and findings without source locations', () => {
  const empty = JSON.parse(formatReportSarif({ ...base, findings: [] }));
  assert.deepEqual(empty.runs[0].results, []);
  assert.deepEqual(empty.runs[0].tool.driver.rules, []);

  const finding = { ...base.findings[0], affectedObjects: [], documentationUrl: undefined };
  const result = JSON.parse(formatReportSarif({ ...base, findings: [finding] }));
  assert.equal(result.runs[0].results[0].locations, undefined);
  assert.equal(result.runs[0].tool.driver.rules[0].helpUri, undefined);
  const logicalOnly = JSON.parse(formatReportSarif(base));
  assert.equal(logicalOnly.runs[0].results[0].locations[0].physicalLocation, undefined);
});
