import {
  DiagnosticFinding,
  DiagnosticReport,
  DiagnosticSnapshot,
} from '@sb-sniffer/core';
import pc from 'picocolors';

export function renderTerminalReport(report: DiagnosticReport): void {
  const { healthScore, grade, summary, findings } = report;

  // Grade color
  let gradeColor = pc.red;
  if (healthScore >= 90) gradeColor = pc.green;
  else if (healthScore >= 80) gradeColor = pc.cyan;
  else if (healthScore >= 70) gradeColor = pc.yellow;

  console.log('\n' + pc.bold(pc.cyan('╔═══════════════════════════════════════════════════════════════════╗')));
  console.log(pc.bold(pc.cyan('║           🕵️‍♂️  SUPABASE DIAGNOSTIC & HEALTH SNIFFER                ║')));
  console.log(pc.bold(pc.cyan('╚═══════════════════════════════════════════════════════════════════╝')));
  console.log(`\n  ${pc.dim('Timestamp:')} ${new Date(report.timestamp).toLocaleString()}`);
  console.log(`  ${pc.dim('Source:')}    ${pc.bold(report.source)}`);

  console.log(
    `\n  ${pc.bold('Health Score:')} ` +
      gradeColor(pc.bold(`${healthScore}/100`)) +
      `  [Grade: ` +
      gradeColor(pc.bold(grade)) +
      `]`
  );

  console.log(`\n  ${pc.bold('Findings Breakdown:')}`);
  console.log(`    ${pc.red('● Critical:')} ${summary.criticalCount}`);
  console.log(`    ${pc.yellow('● High:')}     ${summary.highCount}`);
  console.log(`    ${pc.cyan('● Medium:')}   ${summary.mediumCount}`);
  console.log(`    ${pc.dim('● Info:')}     ${summary.infoCount}`);
  console.log(`    ${pc.bold('Total:')}      ${summary.totalFindings}`);

  console.log('\n' + pc.dim('─'.repeat(67)) + '\n');

  if (findings.length === 0) {
    console.log(pc.green(pc.bold('  🎉 Congratulations! No issues flagged. Your project is in optimal health.\n')));
    return;
  }

  findings.forEach((finding, index) => {
    let badge = pc.dim(`[INFO]`);
    if (finding.severity === 'critical') badge = pc.bgRed(pc.white(pc.bold(` CRITICAL `)));
    else if (finding.severity === 'high') badge = pc.bgYellow(pc.black(pc.bold(` HIGH `)));
    else if (finding.severity === 'medium') badge = pc.bgCyan(pc.black(pc.bold(` MEDIUM `)));

    console.log(`  ${pc.bold(`${index + 1}.`)} ${badge} ${pc.bold(finding.title)}`);
    console.log(`     ${pc.dim('Check ID:')} ${pc.italic(finding.id)} | ${pc.dim('Category:')} ${finding.category}`);
    console.log(`     ${pc.dim('Summary:')}  ${finding.summary}`);

    console.log(`\n     ${pc.yellow(pc.bold('⚠️ Why It Clogs Supabase Support:'))}`);
    console.log(`     ${pc.dim(finding.whyItClogsSupport.replace(/\n/g, '\n     '))}`);

    if (finding.affectedObjects.length > 0) {
      console.log(`\n     ${pc.bold('Affected Objects:')}`);
      finding.affectedObjects.slice(0, 5).forEach((obj) => {
        console.log(`       • ${pc.cyan(obj.name)} ${pc.dim(`(${obj.type})`)}: ${obj.detail || ''}`);
      });
      if (finding.affectedObjects.length > 5) {
        console.log(`       ${pc.dim(`... and ${finding.affectedObjects.length - 5} more.`)}`);
      }
    }

    if (finding.fixSql) {
      console.log(`\n     ${pc.green(pc.bold('Copy-Paste SQL Remediation:'))}`);
      const sqlLines = finding.fixSql.trim().split('\n');
      sqlLines.forEach((l) => console.log(`       ${pc.gray(l)}`));
    }

    if (finding.documentationUrl) {
      console.log(`\n     ${pc.dim('Docs:')} ${pc.underline(pc.blue(finding.documentationUrl))}`);
    }

    console.log('\n' + pc.dim('─'.repeat(67)) + '\n');
  });
}
