/**
 * server/engine/planner.ts
 *
 * Execution planning over a task manifest's `requires` dependency graph.
 *
 *   detectCycle     – dependency cycle detection with the cycle path
 *   topoSort        – serial execution queue: dependency-first + stable
 *                     declaration order among independents; null on cycle
 *   cascadeSelect   – expand a selection with all transitive dependencies
 *   isBlocked       – a task is blocked when any direct dependency is not
 *                     in a completed ('success') state (UI grey-out)
 *
 * Edge model: an edge `A → B` means "A requires B", i.e. B must execute
 * before A. Tasks are consumed structurally (id + requires) so the module
 * stays independent of the full manifest schema.
 */

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

/** Minimum task shape consumed by the planner (Task satisfies it). */
export interface PlannerTask {
  id: string;
  requires: string[];
}

export type TaskStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'fixing'
  | 'skipped';

// ---------------------------------------------------------------------------
//  Cycle detection
// ---------------------------------------------------------------------------

/**
 * Detect a cycle in the `requires` graph.
 *
 * Returns the ids along the cycle INCLUDING the closing edge, e.g.
 * ['A', 'B', 'C', 'A'] for A→B→C→A — suitable for a "环路径" error message.
 * Returns null when the graph is acyclic.
 *
 * The returned path follows the ORDER of the cycle found (A→B→C→A), not
 * necessarily declaration order.
 */
export function detectCycle(tasks: readonly PlannerTask[]): string[] | null {
  const deps = new Map(tasks.map((t) => [t.id, t.requires]));
  const color = new Map<string, 'gray' | 'black'>();

  /** Current DFS stack — used to reconstruct the cycle path. */
  const path: string[] = [];

  const visit = (id: string): string[] | null => {
    const c = color.get(id);
    if (c === 'black') return null;
    if (c === 'gray') {
      // Back edge: id is already on the current stack → cycle.
      const start = path.indexOf(id);
      return path.slice(start).concat(id);
    }
    color.set(id, 'gray');
    path.push(id);
    for (const dep of deps.get(id) ?? []) {
      const cycle = visit(dep);
      if (cycle) return cycle;
    }
    path.pop();
    color.set(id, 'black');
    return null;
  };

  for (const t of tasks) {
    const cycle = visit(t.id);
    if (cycle) return cycle;
  }
  return null;
}

// ---------------------------------------------------------------------------
//  Topological sort → execution queue
// ---------------------------------------------------------------------------

/**
 * Build the serial execution queue for a selection.
 *
 * - Includes the selection and ALL its transitive dependencies.
 * - Dependency order is guaranteed: every task comes after all its deps.
 * - Tasks with no ordering constraint keep their manifest declaration order.
 * - Returns null when a cycle exists among the reachable tasks (no valid
 *   queue exists). Throws when a selected id is not in `tasks`.
 */
export function topoSort(
  selected: readonly string[],
  tasks: readonly PlannerTask[],
): string[] | null {
  const deps = new Map(tasks.map((t) => [t.id, t.requires]));

  for (const id of selected) {
    if (!deps.has(id)) throw new Error(`未知任务 id: ${id}`);
  }

  const reachable = closure(selected, deps);

  // No valid order when the reachable subgraph contains a cycle.
  const reachableTasks = tasks.filter((t) => reachable.has(t.id));
  if (detectCycle(reachableTasks) !== null) return null;

  // Kahn's algorithm. The ready set is kept in declaration order so that
  // mutually-independent tasks execute in their manifest order.
  const indegree = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const id of reachable) {
    const depsOf = (deps.get(id) ?? []).filter((d) => reachable.has(d));
    indegree.set(id, depsOf.length);
    for (const d of depsOf) {
      if (!children.has(d)) children.set(d, []);
      children.get(d)!.push(id);
    }
  }

  const declIndex = new Map(tasks.map((t, i) => [t.id, i]));
  const ready: string[] = [];
  for (const id of reachable) {
    if ((indegree.get(id) ?? 0) === 0) ready.push(id);
  }
  sortByDeclaration(ready, declIndex);

  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(id);
    for (const next of children.get(id) ?? []) {
      const d = indegree.get(next)! - 1;
      indegree.set(next, d);
      if (d === 0) {
        ready.push(next);
        sortByDeclaration(ready, declIndex);
      }
    }
  }

  return order.length === reachable.size ? order : null;
}

// ---------------------------------------------------------------------------
//  Cascade selection
// ---------------------------------------------------------------------------

/**
 * Expand a selection with all transitive dependencies, preserving the
 * manifest declaration order. Selecting C (chain C→B→A) yields
 * [A, B, C] when those tasks are declared in that order.
 */
export function cascadeSelect(
  selected: readonly string[],
  tasks: readonly PlannerTask[],
): string[] {
  const deps = new Map(tasks.map((t) => [t.id, t.requires]));
  const reachable = closure(selected, deps);
  return tasks.filter((t) => reachable.has(t.id)).map((t) => t.id);
}

// ---------------------------------------------------------------------------
//  Blocking check
// ---------------------------------------------------------------------------

/**
 * Whether a task is currently blocked (not executable) because at least one
 * of its DIRECT dependencies has not reached the completed ('success')
 * state. Pure UI predicate — does not mutate any state.
 */
export function isBlocked(
  taskId: string,
  states: Readonly<Record<string, TaskStatus>>,
  tasks: readonly PlannerTask[],
): boolean {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return false;
  return task.requires.some((dep) => states[dep] !== 'success');
}

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

/** Transitive closure of `seed` over the requires graph (ignores unknown refs). */
function closure(seed: readonly string[], deps: Map<string, string[]>): Set<string> {
  const visited = new Set<string>();
  const stack = [...seed];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const dep of deps.get(id) ?? []) stack.push(dep);
  }
  return visited;
}

function sortByDeclaration(ids: string[], declIndex: Map<string, number>): void {
  ids.sort((a, b) => declIndex.get(a)! - declIndex.get(b)!);
}