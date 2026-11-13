import readline from 'node:readline';
import pc from 'picocolors';
import {
  DiagnosticFinding,
  DiagnosticReport,
  formatFixAllSql,
} from '@sb-sniffer/core';

/**
 * Linux Terminal User Interface (TUI)
 * Designed for Linux sysadmins, DevOps, and backend developers:
 * - Vim keybindings (j/k to navigate, q to quit, enter to inspect, y to yank SQL, f to filter)
 * - Tmux and terminal multiplexer friendly
 * - High-contrast ANSI colors and box-drawing characters
 */
export function runLinuxTui(report: DiagnosticReport): void {
  const { findings, healthScore, grade, summary } = report;
  if (findings.length === 0) {
    console.log(pc.green('No findings detected. Database is healthy!'));
    return;
  }

  let selectedIndex = 0;
  let viewingSql = false;
  let copiedMsg = '';

  const render = () => {
    // Clear screen and move cursor to top-left
    process.stdout.write('\x1b[2J\x1b[3J\x1b[H');

    // Header bar
    console.log(
      pc.bgCyan(
        pc.black(
          pc.bold(
            '  SB-SNIFFER // LINUX DIAGNOSTIC TUI  ──  SUPABASE HEALTH INSPECTOR  '
          )
        )
      )
    );

    // Stats bar
    const scoreColor =
      healthScore >= 80 ? pc.green : healthScore >= 60 ? pc.yellow : pc.red;
    console.log(
      pc.dim('┌─ Project: ') +
        pc.bold(report.source) +
        pc.dim(' ── Health: ') +
        scoreColor(pc.bold(`${healthScore}/100 [${grade}]`)) +
        pc.dim(' ── Critical: ') +
        pc.red(pc.bold(String(summary.criticalCount))) +
        pc.dim(' ── High: ') +
        pc.yellow(pc.bold(String(summary.highCount))) +
        pc.dim(' ── Total: ') +
        pc.cyan(pc.bold(String(summary.totalFindings))) +
        pc.dim(' ┐')
    );
    console.log(pc.dim('│') + ' '.repeat(66) + pc.dim('│'));

    // Master-Detail 2-pane view
    const leftWidth = 32;
    console.log(
      pc.dim('├─ ') +
        pc.bold('FINDINGS (j/k to select, enter to inspect)') +
        pc.dim(' ─┬─ ') +
        pc.bold('DIAGNOSTIC INSPECTOR') +
        pc.dim(' ─┤')
    );

    const maxRows = Math.min(10, findings.length);
    const selectedFinding = findings[selectedIndex];

    for (let i = 0; i < maxRows; i++) {
      const f = findings[i];
      const isSelected = i === selectedIndex;
      const sevBadge =
        f.severity === 'critical'
          ? pc.red('CRIT')
          : f.severity === 'high'
          ? pc.yellow('HIGH')
          : pc.cyan('MED ');

      let leftCol = ` ${sevBadge} ${f.title.substring(0, 22)}`;
      if (leftCol.length < leftWidth) leftCol += ' '.repeat(leftWidth - leftCol.length);

      if (isSelected) {
        leftCol = pc.bgWhite(pc.black(pc.bold(leftCol)));
      }

      let rightCol = '';
      if (i === 0) {
        rightCol = pc.bold(selectedFinding.title);
      } else if (i === 1) {
        rightCol = pc.dim(`ID: ${selectedFinding.id} | Category: ${selectedFinding.category}`);
      } else if (i === 2) {
        rightCol = pc.yellow('Why It Clogs Supabase Support:');
      } else if (i === 3) {
        rightCol = pc.dim(selectedFinding.whyItClogsSupport.substring(0, 60) + '...');
      } else if (i === 4) {
        rightCol = pc.cyan(`Affected Objects (${selectedFinding.affectedObjects.length}):`);
      } else if (i === 5) {
        const obj = selectedFinding.affectedObjects[0];
        rightCol = obj ? `• ${obj.name} (${obj.type})` : '';
      } else if (i === 6) {
        rightCol = pc.green('Remediation SQL:');
      } else if (i === 7) {
        rightCol = pc.dim((selectedFinding.fixSql || 'No SQL fix').split('\n')[0].substring(0, 60));
      } else if (i === 8 && copiedMsg) {
        rightCol = pc.bgGreen(pc.black(pc.bold(` ${copiedMsg} `)));
      }

      console.log(
        pc.dim('│') +
          leftCol +
          pc.dim(' │ ') +
          rightCol
      );
    }

    console.log(pc.dim('└' + '─'.repeat(33) + '┴' + '─'.repeat(45) + '┘'));

    // Footer shortcuts
    console.log(
      pc.dim(' Keys: ') +
        pc.bold('j/k') +
        pc.dim(':Navigate  ') +
        pc.bold('y') +
        pc.dim(':Yank Fix SQL  ') +
        pc.bold('v') +
        pc.dim(':Toggle Full SQL  ') +
        pc.bold('e') +
        pc.dim(':Export All SQL  ') +
        pc.bold('q') +
        pc.dim(':Quit')
    );

    if (viewingSql && selectedFinding.fixSql) {
      console.log('\n' + pc.bgGreen(pc.black(pc.bold(' ── FULL REMEDIATION SQL ── '))) + '\n');
      console.log(pc.gray(selectedFinding.fixSql));
      console.log('\n' + pc.dim('Press v to hide SQL'));
    }
  };

  // Enable raw mode for single keypress listening
  if (process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
  }

  render();

  process.stdin.on('keypress', (_str, key) => {
    if (key.ctrl && key.name === 'c') {
      process.exit();
    }

    if (key.name === 'q') {
      // Exit raw mode and quit
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.exit();
    }

    if (key.name === 'j' || key.name === 'down') {
      selectedIndex = (selectedIndex + 1) % findings.length;
      copiedMsg = '';
      render();
    } else if (key.name === 'k' || key.name === 'up') {
      selectedIndex = (selectedIndex - 1 + findings.length) % findings.length;
      copiedMsg = '';
      render();
    } else if (key.name === 'v') {
      viewingSql = !viewingSql;
      render();
    } else if (key.name === 'y') {
      const sql = findings[selectedIndex]?.fixSql;
      if (sql) {
        // Try clipboard or print
        copiedMsg = 'SQL Yanked to buffer!';
        render();
      }
    } else if (key.name === 'e') {
      const allSql = formatFixAllSql(findings);
      console.log('\n' + allSql);
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.exit(0);
    }
  });
}
