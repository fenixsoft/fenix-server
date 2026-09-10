/**
 * server/engine/manifest.ts
 *
 * Task manifest loading: read YAML → shared schema validation → strongly
 * typed manifest object, or a structured error.
 *
 * Error model (never throws unstructured exceptions):
 *   - not-found    – the path does not exist
 *   - read-failed  – the file exists but could not be read (permissions…)
 *   - yaml-syntax  – the file content is not valid YAML (with line info)
 *   - validation   – schema validation failed (task-scoped paths from
 *                    shared parseTaskManifest, e.g. tasks.install-claude-code.commands)
 */
import { promises as fs } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { parseTaskManifest, type TaskManifest, type SchemaError } from '../../shared/schema.js';

// ---------------------------------------------------------------------------
//  Result types
// ---------------------------------------------------------------------------

export type ManifestLoadResult =
  | { ok: true; manifest: TaskManifest }
  | { ok: false; error: ManifestError };

export type ManifestError =
  | { kind: 'not-found'; path: string; reason: string }
  | { kind: 'read-failed'; path: string; reason: string }
  | { kind: 'yaml-syntax'; path: string; line: number | null; reason: string }
  | { kind: 'validation'; path: string; errors: SchemaError[]; reason: string };

// ---------------------------------------------------------------------------
//  loadManifest
// ---------------------------------------------------------------------------

/**
 * Load a task manifest from a YAML file.
 *
 * - Missing file        → { kind: 'not-found' }
 * - Unreadable file     → { kind: 'read-failed' }
 * - Invalid YAML        → { kind: 'yaml-syntax' } (with the first error line)
 * - Schema failure      → { kind: 'validation' } (structured SchemaError list,
 *                           task-scoped paths already resolved by the shared
 *                           parser)
 * - Success             → { ok: true, manifest }
 */
export async function loadManifest(path: string): Promise<ManifestLoadResult> {
  let raw: string;
  try {
    raw = await fs.readFile(path, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return {
        ok: false,
        error: { kind: 'not-found', path, reason: `任务清单文件不存在: ${path}` },
      };
    }
    return {
      ok: false,
      error: {
        kind: 'read-failed',
        path,
        reason: `任务清单文件读取失败: ${(err as Error).message}`,
      },
    };
  }

  let data: unknown;
  try {
    data = parseYaml(raw);
  } catch (err) {
    const yamlErr = err as { message?: string; linePos?: Array<{ line: number }> };
    const line = yamlErr.linePos?.[0]?.line ?? null;
    const at = line !== null ? `（第 ${line} 行）` : '';
    return {
      ok: false,
      error: {
        kind: 'yaml-syntax',
        path,
        line,
        reason: `YAML 语法错误${at}: ${yamlErr.message ?? '无法解析'}`,
      },
    };
  }

  const result = parseTaskManifest(data);
  if (!result.ok) {
    return {
      ok: false,
      error: {
        kind: 'validation',
        path,
        errors: result.errors,
        reason: `任务清单校验失败（${result.errors.length} 处错误）`,
      },
    };
  }

  return { ok: true, manifest: result.manifest };
}
