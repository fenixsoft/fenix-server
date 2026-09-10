/**
 * Temporary validation script for assets/tasks.yaml (used by the implementer).
 * Validates: schema, cycle-free graph, proxy flags, verify commands, file refs.
 */
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../../server/engine/manifest.js';
import { detectCycle, topoSort } from '../../server/engine/planner.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('assets/tasks.yaml 校验', () => {
  it('通过 schema 校验：约 17 任务、id 无重复、无环、install-claude-code 无前置排最前', async () => {
    const result = await loadManifest(resolve('assets/tasks.yaml'));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    const m = result.manifest;

    expect(m.meta.name).toBe('fenix-server-init');
    expect(m.tasks.length).toBeGreaterThanOrEqual(15);

    const ids = m.tasks.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);

    // install-claude-code root, first
    const icc = m.tasks.find((t) => t.id === 'install-claude-code');
    expect(icc).toBeDefined();
    expect(icc!.requires).toEqual([]);
    expect(m.tasks[0].id).toBe('install-claude-code');
  });

  it('依赖图无环；install-claude-code/apt-aliyun-mirror 位于前部，config-zshrc 在 zsh 系之后', async () => {
    const result = await loadManifest(resolve('assets/tasks.yaml'));
    if (!result.ok) throw new Error('manifest load failed');
    const m = result.manifest;

    expect(detectCycle(m.tasks)).toBeNull();

    const order = topoSort(m.tasks.map((t) => t.id), m.tasks);
    expect(order).not.toBeNull();
    if (!order) return;

    expect(order.indexOf('install-claude-code')).toBeLessThan(order.indexOf('install-docker'));
    expect(order.indexOf('apt-aliyun-mirror')).toBeLessThan(order.indexOf('install-base-tools'));
    const zshTasks = ['install-zsh', 'install-ohmyzsh', 'install-zsh-plugins', 'install-fzf'];
    expect(order.indexOf('config-zshrc')).toBeGreaterThan(
      Math.max(...zshTasks.map((id) => order.indexOf(id))),
    );
  });

  it('海外任务全部标 needs_proxy；其余为 false', async () => {
    const result = await loadManifest(resolve('assets/tasks.yaml'));
    if (!result.ok) throw new Error('manifest load failed');
    const m = result.manifest;

    const overseas = ['install-docker', 'install-gh-cli', 'install-playwright', 'install-superpowers', 'install-openspec', 'install-zsh-plugins', 'install-clash', 'install-claude-code'];
    for (const id of overseas) {
      const t = m.tasks.find((x) => x.id === id);
      expect(t, `task ${id} exists`).toBeDefined();
      expect(t!.needs_proxy, `${id} should need proxy`).toBe(true);
    }
    const noProxy = ['apt-aliyun-mirror', 'install-base-tools', 'config-git', 'config-sshd'];
    for (const id of noProxy) {
      const t = m.tasks.find((x) => x.id === id);
      expect(t, `task ${id} exists`).toBeDefined();
      expect(t!.needs_proxy, `${id} should not need proxy`).toBe(false);
    }
  });

  it('关键任务带 verify 命令', async () => {
    const result = await loadManifest(resolve('assets/tasks.yaml'));
    if (!result.ok) throw new Error('manifest load failed');
    const m = result.manifest;

    for (const id of ['install-zsh', 'install-docker', 'install-gh-cli', 'install-openspec', 'config-sshd', 'apt-aliyun-mirror']) {
      const t = m.tasks.find((x) => x.id === id);
      expect(t, `task ${id} exists`).toBeDefined();
      expect(t!.verify, `${id} should have verify`).toBeTruthy();
    }
  });

  it('files 无悬空引用（每个引用都对应 assets 下的实际文件）', async () => {
    const result = await loadManifest(resolve('assets/tasks.yaml'));
    if (!result.ok) throw new Error('manifest load failed');
    const m = result.manifest;

    const allFiles = new Set<string>();
    for (const t of m.tasks) for (const f of t.files) allFiles.add(f);
    expect(allFiles.size).toBeGreaterThan(0);
    for (const f of allFiles) {
      expect(existsSync(resolve('assets', f)), `assets/${f} should exist`).toBe(true);
    }
  });
});