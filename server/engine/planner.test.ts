/**
 * server/engine/planner.test.ts
 *
 * Unit tests covering the execution-planner spec:
 *   - detectCycle: acyclic chain passes; cycle reports a path
 *   - topoSort: dependency-first queue; declaration-order stability;
 *     transitive deps included; cycle → null
 *   - cascadeSelect: transitive dependency completion
 *   - isBlocked: dependency-not-complete → blocked
 */
import { describe, expect, it } from 'vitest';
import {
  detectCycle,
  topoSort,
  cascadeSelect,
  isBlocked,
  type PlannerTask,
} from './planner.js';

// ---------------------------------------------------------------------------
//  Fixtures
// ---------------------------------------------------------------------------

const chain: PlannerTask[] = [
  { id: 'A', requires: [] },
  { id: 'B', requires: ['A'] },
  { id: 'C', requires: ['B'] },
];

const cycleTasks: PlannerTask[] = [
  { id: 'A', requires: ['B'] },
  { id: 'B', requires: ['C'] },
  { id: 'C', requires: ['A'] },
];

// X, Y mutually independent; declared X first.
const independent: PlannerTask[] = [
  { id: 'X', requires: [] },
  { id: 'Y', requires: [] },
];

// Declaration order is deliberately different from dependency order:
// Z is declared first but depends on A (declared second).
const mixed: PlannerTask[] = [
  { id: 'Z', requires: ['A'] },
  { id: 'A', requires: [] },
  { id: 'B', requires: ['A'] },
];

describe('detectCycle', () => {
  it('无环清单通过（A→B→C 链）', () => {
    expect(detectCycle(chain)).toBeNull();
  });

  it('单任务无自环通过', () => {
    expect(detectCycle([{ id: 'solo', requires: [] }])).toBeNull();
  });

  it('环依赖报错并给出 A→B→C→A 环路径', () => {
    const cycle = detectCycle(cycleTasks);
    expect(cycle).not.toBeNull();
    // 环上任务依次为 A、B、C，并以 A 闭合
    expect(cycle).toEqual(['A', 'B', 'C', 'A']);
  });

  it('自环 A→A 也被检测', () => {
    const cycle = detectCycle([{ id: 'A', requires: ['A'] }]);
    expect(cycle).toEqual(['A', 'A']);
  });

  it('混合清单中环仍被定位（非起始节点入环）', () => {
    const tasks: PlannerTask[] = [
      { id: 'root', requires: ['P'] },
      { id: 'P', requires: ['Q'] },
      { id: 'Q', requires: ['P'] },
    ];
    const cycle = detectCycle(tasks);
    expect(cycle).not.toBeNull();
    expect(cycle).toContain('P');
    expect(cycle).toContain('Q');
  });
});

describe('topoSort', () => {
  it('选中 C（依赖 B→A）→ 队列为 A、B、C', () => {
    expect(topoSort(['C'], chain)).toEqual(['A', 'B', 'C']);
  });

  it('选中全部 → 队列仍满足依赖先序', () => {
    expect(topoSort(['A', 'B', 'C'], chain)).toEqual(['A', 'B', 'C']);
  });

  it('互不依赖的任务保持声明顺序（X 在前）', () => {
    expect(topoSort(['X', 'Y'], independent)).toEqual(['X', 'Y']);
  });

  it('乱序声明也按依赖先序排列', () => {
    expect(topoSort(['Z'], mixed)).toEqual(['A', 'Z']);
    // B、Z 互不依赖 → 保持声明顺序（Z 声明在 B 前）
    expect(topoSort(['B', 'Z'], mixed)).toEqual(['A', 'Z', 'B']);
  });

  it('选中任务的全部传递依赖自动进入队列', () => {
    // chain: C→B→A；再叠加独立任务 X
    const tasks = [...chain, ...independent];
    expect(topoSort(['C', 'X'], tasks)).toEqual(['A', 'B', 'C', 'X']);
  });

  it('存在环时返回 null（不产出队列）', () => {
    expect(topoSort(['A'], cycleTasks)).toBeNull();
    expect(topoSort(['C'], cycleTasks)).toBeNull();
  });

  it('空选择 → 空队列', () => {
    expect(topoSort([], chain)).toEqual([]);
  });
});

describe('cascadeSelect', () => {
  it('勾选 C（链 C→B→A）自动补齐 A 与 B', () => {
    const sel = cascadeSelect(['C'], chain);
    expect(sel).toContain('A');
    expect(sel).toContain('B');
    expect(sel).toContain('C');
  });

  it('结果保持声明顺序', () => {
    expect(cascadeSelect(['C'], chain)).toEqual(['A', 'B', 'C']);
  });

  it('互不依赖时仅含被勾选任务', () => {
    expect(cascadeSelect(['X'], independent)).toEqual(['X']);
  });
});

describe('isBlocked', () => {
  it('依赖 A 未成功完成时 B 阻塞', () => {
    const states = { A: 'running' as const, B: 'pending' as const };
    expect(isBlocked('B', states, chain)).toBe(true);
  });

  it('依赖 A 处于 failed 时 B 阻塞', () => {
    const states = { A: 'failed' as const, B: 'pending' as const };
    expect(isBlocked('B', states, chain)).toBe(true);
  });

  it('依赖 A 成功完成后 B 不阻塞', () => {
    const states = { A: 'success' as const, B: 'pending' as const };
    expect(isBlocked('B', states, chain)).toBe(false);
  });

  it('无依赖的任务永不阻塞', () => {
    expect(isBlocked('A', {}, chain)).toBe(false);
  });

  it('依赖状态缺失（从未执行）视为阻塞', () => {
    expect(isBlocked('B', {}, chain)).toBe(true);
  });
});
