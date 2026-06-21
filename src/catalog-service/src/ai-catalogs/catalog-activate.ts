import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { resolveRepoRoot } from './inventory.js';

const execFileAsync = promisify(execFile);

export type EnsureCatalogsResult = {
  ok: boolean;
  activated: string[];
  skipped: string[];
  error?: string;
};

export async function ensureCatalogsActive(catalogIds: string[]): Promise<EnsureCatalogsResult> {
  const unique = [...new Set(catalogIds.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) {
    return { ok: true, activated: [], skipped: [] };
  }

  const repo = resolveRepoRoot();
  const script = path.join(repo, 'scripts/phase-n3d/aiometadata-config.sh');
  if (!existsSync(script)) {
    return {
      ok: false,
      activated: [],
      skipped: unique,
      error: `missing aiometadata script: ${script}`,
    };
  }

  const importPath = process.env.MANGO_AIOMETADATA_IMPORT?.trim()
    || `${process.env.HOME ?? ''}/.config/mango/aiometadata-import.json`;

  try {
    await execFileAsync(
      'bash',
      [script, 'ensure-catalogs', importPath, ...unique],
      {
        timeout: 90_000,
        env: {
          ...process.env,
          MANGO_REPO_DIR: repo,
        },
      },
    );
    return { ok: true, activated: unique, skipped: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      activated: [],
      skipped: unique,
      error: message,
    };
  }
}
