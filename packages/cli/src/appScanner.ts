import fs from 'node:fs';
import path from 'node:path';
import { AppSourceFile } from '@sb-sniffer/core';

const IGNORED_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.turbo', '.vercel', 'coverage']);
const MAX_FILE_BYTES = 512 * 1024; // 512 KB cap per file

/**
 * Loads SQL from either a single .sql file or a directory of ordered migration files (e.g. supabase/migrations).
 */
export function loadSchemaFromPath(schemaPath: string): string {
  const resolved = path.resolve(schemaPath);
  const stat = fs.statSync(resolved);

  if (stat.isFile()) {
    return fs.readFileSync(resolved, 'utf-8');
  }

  if (stat.isDirectory()) {
    const entries = fs
      .readdirSync(resolved)
      .filter((f) => f.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b));

    if (entries.length === 0) {
      throw new Error(`No .sql files found in directory: ${resolved}`);
    }

    return entries
      .map((file) => {
        const full = path.join(resolved, file);
        return `-- >>> Migration: ${file}\n` + fs.readFileSync(full, 'utf-8');
      })
      .join('\n\n');
  }

  throw new Error(`Invalid schema path: ${resolved}`);
}

/**
 * Walks an application directory to collect .env*, Prisma/Drizzle configs, and JS/TS source files.
 */
export function collectAppSourceFiles(rootDir: string): AppSourceFile[] {
  const resolvedRoot = path.resolve(rootDir);
  const results: AppSourceFile[] = [];

  function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          walk(path.join(dir, entry.name));
        }
        continue;
      }

      if (!entry.isFile()) continue;

      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(resolvedRoot, fullPath);
      const isEnv = /^\.env(\.|$)/i.test(entry.name);
      const isCode = /\.(ts|tsx|js|jsx|mjs|cjs|prisma)$/i.test(entry.name);

      if (!isEnv && !isCode) continue;

      try {
        const stat = fs.statSync(fullPath);
        if (stat.size > MAX_FILE_BYTES) continue;
        const content = fs.readFileSync(fullPath, 'utf-8');
        results.push({ path: relPath, content });
      } catch {
        // Ignore unreadable files
      }
    }
  }

  walk(resolvedRoot);
  return results;
}
