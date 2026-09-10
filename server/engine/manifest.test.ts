/**
 * server/engine/manifest.test.ts
 *
 * Unit tests for loadManifest — covers the task-manifest spec:
 *   - loading a valid manifest returns a strongly typed object
 *   - missing file → structured not-found error
 *   - invalid YAML → yaml-syntax error carrying the failing line
 *   - schema failure → validation error located at the offending task id
 *   - duplicate task id → rejected with the duplicated id surfaced
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadManifest } from './manifest.js';

const validYaml = `
meta:
  name: fenix-server-init
  version: "1.0"
tasks:
  - id: apt-aliyun-mirror
    title: 设置阿里云 APT 源
    group: 系统基础配置
    description: 替换 Ubuntu 官方源为阿里云镜像
    commands:
      - apt update
    needs_proxy: true
  - id: install-claude-code
    title: 安装 Claude Code
    commands:
      - npm install -g @anthropic-ai/claude-code
    requires:
      - apt-aliyun-mirror
    files:
      - claude_settings/.claude.json
    claude_hint: 按 os-release 的 VERSION_CODENAME 调整源代号
`;

describe('loadManifest', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'manifest-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('加载合法清单返回强类型对象（meta + 任务数组，默认值填充）', async () => {
    const path = join(dir, 'valid.yaml');
    await writeFile(path, validYaml, 'utf8');

    const result = await loadManifest(path);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.manifest.meta.name).toBe('fenix-server-init');
    expect(result.manifest.tasks).toHaveLength(2);
    expect(result.manifest.tasks[0].id).toBe('apt-aliyun-mirror');
    expect(result.manifest.tasks[0].needs_proxy).toBe(true);
    // 缺省字段被 schema 默认值填充
    expect(result.manifest.tasks[0].requires).toEqual([]);
    expect(result.manifest.tasks[0].files).toEqual([]);
    expect(result.manifest.tasks[1].needs_proxy).toBe(false);
    expect(result.manifest.tasks[1].requires).toEqual(['apt-aliyun-mirror']);
  });

  it('文件不存在 → not-found 错误，明确指出路径不存在', async () => {
    const path = join(dir, 'nope.yaml');

    const result = await loadManifest(path);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('not-found');
    expect(result.error.path).toBe(path);
    expect(result.error.reason).toContain('不存在');
    expect(result.error.reason).toContain(path);
  });

  it('YAML 语法错误 → yaml-syntax 错误，包含解析失败的行信息', async () => {
    const path = join(dir, 'broken.yaml');
    // 第三行缺少闭合方括号 → 解析失败
    await writeFile(path, 'meta:\n  name: x\n  version: [1, 2\n', 'utf8');

    const result = await loadManifest(path);

    expect(result.ok).toBe(false);
    if (result.ok || result.error.kind !== 'yaml-syntax') return;
    // 行信息存在（未闭合的 flow sequence 由解析器定位到文档末行）
    const line = result.error.line;
    expect(line).toBeTypeOf('number');
    if (line === null) throw new Error('yaml 语法错误缺少行信息');
    expect(line >= 1).toBe(true);
    expect(result.error.reason).toContain(`第 ${line} 行`);
  });

  it('校验失败定位到任务 → 错误路径含任务 id 与缺失字段', async () => {
    const path = join(dir, 'no-commands.yaml');
    // install-claude-code 缺少 commands 字段
    await writeFile(
      path,
      `meta:
  name: x
  version: "1.0"
tasks:
  - id: apt-aliyun-mirror
    title: A
    commands:
      - apt update
  - id: install-claude-code
    title: 安装 Claude Code
`,
      'utf8',
    );

    const result = await loadManifest(path);

    expect(result.ok).toBe(false);
    if (result.ok || result.error.kind !== 'validation') return;
    const errors = result.error.errors;
    expect(errors.length).toBeGreaterThan(0);
    const cmdErr = errors.find((e) => e.path.includes('install-claude-code'));
    expect(cmdErr).toBeDefined();
    expect(cmdErr?.path).toContain('commands');
  });

  it('重复 id 拒绝加载，错误指明重复的 id', async () => {
    const path = join(dir, 'dup.yaml');
    await writeFile(
      path,
      `meta:
  name: x
  version: "1.0"
tasks:
  - id: dup-id
    title: 一
    commands:
      - echo one
  - id: dup-id
    title: 二
    commands:
      - echo two
`,
      'utf8',
    );

    const result = await loadManifest(path);

    expect(result.ok).toBe(false);
    if (result.ok || result.error.kind !== 'validation') return;
    const dup = result.error.errors.find((e) => e.reason.includes('dup-id'));
    expect(dup).toBeDefined();
    expect(dup?.path).toContain('id');
  });
});
