import { describe, expect, it } from 'vitest';
import { parseTaskManifest } from './schema.js';

const validManifest = {
  meta: { name: 'fenix-server-init', version: '1.0' },
  tasks: [
    {
      id: 'apt-aliyun-mirror',
      title: '设置阿里云 APT 源',
      group: '系统基础配置',
      description: '替换 Ubuntu 官方源为阿里云镜像',
      commands: ['apt update'],
      needs_proxy: true,
    },
    {
      id: 'install-claude-code',
      title: '安装 Claude Code',
      commands: ['npm install -g @anthropic-ai/claude-code'],
      requires: ['apt-aliyun-mirror'],
      files: ['claude_settings/.claude.json'],
      claude_hint: '按 os-release 的 VERSION_CODENAME 调整源代号',
    },
  ],
};

describe('parseTaskManifest', () => {
  it('接受包含依赖/needs_proxy/files 的合法清单，并填充默认值', () => {
    const result = parseTaskManifest(validManifest);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.manifest.meta.name).toBe('fenix-server-init');
    expect(result.manifest.tasks).toHaveLength(2);

    // 显式字段原样保留
    expect(result.manifest.tasks[0].needs_proxy).toBe(true);
    expect(result.manifest.tasks[1].requires).toEqual(['apt-aliyun-mirror']);
    expect(result.manifest.tasks[1].files).toEqual(['claude_settings/.claude.json']);

    // 缺省字段被默认值填充
    expect(result.manifest.tasks[0].requires).toEqual([]);
    expect(result.manifest.tasks[0].files).toEqual([]);
    expect(result.manifest.tasks[0].needs_proxy).toBe(true);
    expect(result.manifest.tasks[1].needs_proxy).toBe(false);
  });

  it('拒绝重复 id，错误信息指明重复的 id', () => {
    const manifest = structuredClone(validManifest);
    manifest.tasks[1].id = 'apt-aliyun-mirror'; // 与第一个任务重复

    const result = parseTaskManifest(manifest);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThan(0);
    const dup = result.errors.find((e) => e.reason.includes('apt-aliyun-mirror'));
    expect(dup).toBeDefined();
    expect(dup?.path).toContain('id');
  });

  it('拒绝引用不存在的依赖，错误信息指明缺失的依赖 id', () => {
    const manifest = structuredClone(validManifest);
    manifest.tasks[1].requires = ['no-such-task'];

    const result = parseTaskManifest(manifest);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const missing = result.errors.find((e) =>
      e.reason.includes('no-such-task'),
    );
    expect(missing).toBeDefined();
    expect(missing?.path).toContain('requires');
  });

  it('拒绝空命令数组，错误信息指明该任务 id', () => {
    const manifest = structuredClone(validManifest);
    manifest.tasks[1].commands = [];

    const result = parseTaskManifest(manifest);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const emptyCmd = result.errors.find((e) =>
      e.path.startsWith('tasks.install-claude-code.commands'),
    );
    expect(emptyCmd).toBeDefined();
    expect(emptyCmd?.path).toContain('commands');
  });
});
