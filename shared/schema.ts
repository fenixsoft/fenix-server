/**
 * shared/schema.ts
 *
 * Task manifest YAML zod schema and inferred TypeScript types.
 * Field semantics follow the design doc §4.1.
 *
 * Validation scope (this SPEC):
 *   - id uniqueness within the manifest
 *   - requires references must exist in the manifest
 *   - commands must be a non-empty array of non-empty strings
 *   - default values are filled for needs_proxy / requires / files
 *
 * NOT in scope: requires cycle detection (owned by add-task-engine's planner).
 * The validation consumer is add-task-engine.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
//  Leaf schemas
// ---------------------------------------------------------------------------

export const metaSchema = z.object({
  /** Manifest name, e.g. "fenix-server-init". */
  name: z.string().min(1),
  /** Manifest version. */
  version: z.union([z.string(), z.number()]),
});

export const taskSchema = z.object({
  /** Globally unique task id within the manifest. */
  id: z.string().min(1),
  /** Human-readable task title. */
  title: z.string().min(1),
  /** UI grouping label. */
  group: z.string().optional(),
  /** Free-form task description. */
  description: z.string().optional(),
  /** Ordered shell commands; empty array is invalid. */
  commands: z.array(z.string().min(1)).min(1),
  /** Optional verification command; exit code 0 means pass. */
  verify: z.string().optional(),
  /** Whether execution needs the reverse tunnel proxy env. Default false. */
  needs_proxy: z.boolean().default(false),
  /** Dependent task ids. Default empty. */
  requires: z.array(z.string()).default([]),
  /** Asset relative paths to upload before execution. Default empty. */
  files: z.array(z.string()).default([]),
  /** Domain hint appended to Claude fix prompts. */
  claude_hint: z.string().optional(),
});

// ---------------------------------------------------------------------------
//  Manifest schema with cross-field validation
// ---------------------------------------------------------------------------

export const taskManifestSchema = z
  .object({
    meta: metaSchema,
    tasks: z.array(taskSchema),
  })
  .superRefine((manifest, ctx) => {
    const ids = new Set(manifest.tasks.map((t) => t.id));

    // -- id uniqueness -------------------------------------------------------
    const seen = new Set<string>();
    manifest.tasks.forEach((task, index) => {
      if (seen.has(task.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tasks', index, 'id'],
          message: `任务 id "${task.id}" 重复`,
        });
      }
      seen.add(task.id);
    });

    // -- requires existence ---------------------------------------------------
    manifest.tasks.forEach((task, index) => {
      task.requires.forEach((dep, depIndex) => {
        if (!ids.has(dep)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['tasks', index, 'requires', depIndex],
            message: `requires 引用了不存在的任务 id "${dep}"`,
          });
        }
      });
    });
  });

// ---------------------------------------------------------------------------
//  Inferred types
// ---------------------------------------------------------------------------

export type Meta = z.infer<typeof metaSchema>;
export type Task = z.infer<typeof taskSchema>;
export type TaskManifest = z.infer<typeof taskManifestSchema>;

// ---------------------------------------------------------------------------
//  Error list output
// ---------------------------------------------------------------------------

export interface SchemaError {
  /** Dotted path to the offending field, e.g. "tasks[0].id". */
  path: string;
  /** Human-readable reason. */
  reason: string;
}

export type ParseResult =
  | { ok: true; manifest: TaskManifest }
  | { ok: false; errors: SchemaError[] };

/**
 * Parse and validate a raw task manifest (e.g. deserialized YAML).
 * On failure returns a structured error list (path + reason) instead of
 * throwing a single exception. Task-scoped errors use the task `id`
 * (not the numeric index) in the path so consumers can identify the task.
 */
export function parseTaskManifest(input: unknown): ParseResult {
  const parsed = taskManifestSchema.safeParse(input);
  if (parsed.success) {
    return { ok: true, manifest: parsed.data };
  }
  const errors: SchemaError[] = parsed.error.issues.map((issue) => {
    let path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    // Task-scoped issues have path shape ['tasks', <index>, ...].
    if (issue.path[0] === 'tasks' && typeof issue.path[1] === 'number') {
      const index = issue.path[1];
      const taskId = taskIdAt(input, index);
      const rest = issue.path.slice(2).join('.');
      path = taskId !== undefined
        ? `tasks.${taskId}${rest ? `.${rest}` : ''}`
        : issue.path.map((p) => String(p)).join('.');
    }
    return { path, reason: issue.message };
  });
  return { ok: false, errors };
}

/** Resolve the task `id` at a given index from the raw manifest input. */
function taskIdAt(input: unknown, index: number): string | undefined {
  if (!isObject(input) || !Array.isArray(input.tasks)) return undefined;
  const task = input.tasks[index];
  return isObject(task) && typeof task.id === 'string' ? task.id : undefined;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
