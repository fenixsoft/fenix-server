/**
 * server/config.ts
 *
 * Local config.json read/write with in-memory cache.
 *
 * Data model:
 *   - servers[]       – name / host / port / username / rememberPassword / password
 *   - clientProxy     – e.g. "127.0.0.1:7890"
 *   - lastTaskManifestPath
 *
 * Semantics:
 *   - File missing → default empty config
 *   - Save = atomic write (temp file → rename)
 *   - Password is NOT persisted unless rememberPassword = true
 *   - Single-process access only; no file locking needed
 */
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
//  Public types
// ---------------------------------------------------------------------------

export interface ServerConfig {
  name: string;
  host: string;
  port: number;
  username: string;
  /** When true the password is persisted in plaintext. */
  rememberPassword?: boolean;
  /** Optional password; only meaningful when rememberPassword = true. */
  password?: string;
}

export interface AppConfig {
  servers: ServerConfig[];
  /** Client-side proxy address (e.g. "127.0.0.1:7890"). */
  clientProxy?: string;
  /** Absolute path to the last-used task manifest YAML. */
  lastTaskManifestPath?: string;
}

export interface AppConfigManagerOptions {
  /** Directory that contains config.json. Default: CWD. */
  configDir: string;
  /** Filename. Default: "config.json". */
  filename?: string;
}

// ---------------------------------------------------------------------------
//  Default
// ---------------------------------------------------------------------------

export function defaultConfig(): AppConfig {
  return { servers: [], clientProxy: undefined, lastTaskManifestPath: undefined };
}

// ---------------------------------------------------------------------------
//  AppConfigManager
// ---------------------------------------------------------------------------

export class AppConfigManager {
  private readonly filePath: string;
  private cache: AppConfig;
  private loaded = false;

  constructor(private readonly opts: AppConfigManagerOptions) {
    this.filePath = join(opts.configDir, opts.filename ?? 'config.json');
    this.cache = defaultConfig();
  }

  /** Load config.json from disk. Missing file → default empty config. */
  async load(): Promise<AppConfig> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cache = defaultConfig();
        this.loaded = true;
        return this.cache;
      }
      throw err;
    }
    try {
      this.cache = JSON.parse(raw) as AppConfig;
    } catch {
      // Corrupted file → treat as empty config (don't crash).
      this.cache = defaultConfig();
    }
    this.loaded = true;
    return this.cache;
  }

  /** Get the current (cached) config. Loads from disk first if needed. */
  async get(): Promise<AppConfig> {
    if (!this.loaded) await this.load();
    return this.cache;
  }

  /**
   * Save the provided config to disk and update the in-memory cache.
   * Password handling: entries without rememberPassword are stripped of
   * the password field before being persisted.
   *
   * Atomic write: write to a temp file in the same directory, then rename.
   */
  async save(config: AppConfig): Promise<void> {
    const cleaned = sanitizeForPersist(config);
    const data = JSON.stringify(cleaned, null, 2) + '\n';

    // Atomic write via temp + rename
    const tmpFile = join(tmpdir(), `config-${process.pid}-${Date.now()}.json`);
    try {
      await fs.writeFile(tmpFile, data, 'utf8');
      await fs.rename(tmpFile, this.filePath);
    } catch (err) {
      // Clean up temp file on failure (best effort).
      await fs.unlink(tmpFile).catch(() => {});
      throw err;
    }
    this.cache = cleaned;
    this.loaded = true;
  }

  /** Convenience: mutate the cached config and persist. */
  async update(mutator: (draft: AppConfig) => void): Promise<AppConfig> {
    const config = await this.get();
    mutator(config);
    await this.save(config);
    return config;
  }
}

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

/** Strip passwords from servers that have rememberPassword = false/undefined. */
function sanitizeForPersist(config: AppConfig): AppConfig {
  return {
    ...config,
    servers: config.servers.map((s) => {
      if (s.rememberPassword) return s;
      const { password: _pw, ...rest } = s;
      return rest;
    }),
  };
}
