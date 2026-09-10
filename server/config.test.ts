import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppConfigManager, defaultConfig } from './config.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fenix-config-'));
});

describe('AppConfigManager', () => {
  it('无配置文件时 load → 返回结构完整的默认空配置', async () => {
    const mgr = new AppConfigManager({ configDir: dir });
    const config = await mgr.load();

    expect(config).toEqual(defaultConfig());
    expect(config.servers).toEqual([]);
    expect(config.clientProxy).toBeUndefined();
    expect(config.lastTaskManifestPath).toBeUndefined();
  });

  it('保存含一台服务器的配置后再 load → 内容一致', async () => {
    const mgr = new AppConfigManager({ configDir: dir });
    await mgr.save({
      servers: [
        { name: 'prod', host: '1.2.3.4', port: 22, username: 'root', rememberPassword: true, password: 'secret' },
      ],
      clientProxy: '127.0.0.1:7890',
      lastTaskManifestPath: '/tmp/tasks.yaml',
    });

    const reread = await new AppConfigManager({ configDir: dir }).load();
    expect(reread.servers).toHaveLength(1);
    expect(reread.servers[0]).toMatchObject({
      name: 'prod',
      host: '1.2.3.4',
      port: 22,
      username: 'root',
      rememberPassword: true,
      password: 'secret',
    });
    expect(reread.clientProxy).toBe('127.0.0.1:7890');
    expect(reread.lastTaskManifestPath).toBe('/tmp/tasks.yaml');
  });

  it('rememberPassword=false 的服务器密码不持久化，读回含密码字段的输入被剥离', async () => {
    const mgr = new AppConfigManager({ configDir: dir });
    await mgr.save({
      servers: [
        { name: 'no-save', host: '10.0.0.1', port: 22, username: 'root', password: 'hunter2' },
      ],
    });

    // File on disk must not contain the plaintext password
    const raw = await readFile(join(dir, 'config.json'), 'utf8');
    expect(raw).not.toContain('hunter2');

    const reread = await new AppConfigManager({ configDir: dir }).load();
    expect(reread.servers[0].password).toBeUndefined();
  });

  it('update 变更后再读回反映变更', async () => {
    const mgr = new AppConfigManager({ configDir: dir });
    await mgr.update((draft) => {
      draft.clientProxy = '127.0.0.1:8567';
      draft.servers.push({ name: 'a', host: 'h', port: 22, username: 'root' });
    });

    const reread = await new AppConfigManager({ configDir: dir }).load();
    expect(reread.clientProxy).toBe('127.0.0.1:8567');
    expect(reread.servers).toHaveLength(1);
  });

  it('损坏的 config.json → 返回默认配置不抛错', async () => {
    await import('node:fs/promises').then((fs) =>
      fs.writeFile(join(dir, 'config.json'), '{ not valid json', 'utf8'),
    );

    const mgr = new AppConfigManager({ configDir: dir });
    const config = await mgr.load();
    expect(config).toEqual(defaultConfig());
  });
});

// Cleanup helper at end of run (vitest teardown)
import { afterAll } from 'vitest';
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});