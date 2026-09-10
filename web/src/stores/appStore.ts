/**
 * web/src/stores/appStore.ts
 *
 * Single Zustand store holding all application UI state. The backend pushes
 * ServerMessage frames over WebSocket; `applyServerMessage` reduces them into
 * the store. UI actions send ClientMessage via the shared wsClient singleton.
 *
 * Slices:
 *   connection – ws/SSH status, connected host/user, saved servers, error
 *   tasks      – manifest, selected set, per-task status, progress
 *   log        – ring buffer (5000 rows) of output lines + command headers
 *   tunnel     – tunnel status + test result
 *
 * TODO(deps): state fields and message semantics mirror the runner/ws
 *   contracts in shared/messages.ts; the front-end is only the projection.
 */
import { create } from 'zustand';
import { parse } from 'yaml';
import {
  parseTaskManifest,
  type Task,
  type TaskManifest,
} from '@fenix/shared/schema';
import type { ServerMessage, TaskStatus } from '@fenix/shared/messages';
import { wsClient, type WsStatus } from '../wsClient';

// ---------------------------------------------------------------------------
//  Persisted-server shape (mirrors server/config.ts ServerConfig for display)
// ---------------------------------------------------------------------------

export interface PersistedServer {
  name: string;
  host: string;
  port: number;
  username: string;
  rememberPassword?: boolean;
  password?: string;
}

// ---------------------------------------------------------------------------
//  Log model
// ---------------------------------------------------------------------------

export type LogStream = 'stdout' | 'stderr';

export interface LogHeaderLine {
  kind: 'header';
  taskId: string;
  order: number;
  command: string;
  /** exit code; null while the command is still running */
  exitCode: number | null;
  status: TaskStatus;
  timestamp: number;
}

export interface LogOutputLine {
  kind: 'output';
  taskId: string;
  order: number;
  stream: LogStream;
  data: string;
  timestamp: number;
}

export type LogLine = LogHeaderLine | LogOutputLine;

export const LOG_RING_LIMIT = 5000;

// ---------------------------------------------------------------------------
//  Manifest sources
// ---------------------------------------------------------------------------

export type ManifestSource = 'builtin' | 'custom';

// ---------------------------------------------------------------------------
//  Store state
// ---------------------------------------------------------------------------

export interface AppStore {
  // -- connection -----------------------------------------------------------
  wsStatus: WsStatus;
  sshStatus: 'disconnected' | 'connecting' | 'ready' | 'error';
  sshMessage: string | null;
  host: string | null;
  username: string | null;
  port: number | null;
  servers: PersistedServer[];
  clientProxy: string;
  lastError: string | null;

  // -- tasks ----------------------------------------------------------------
  manifest: TaskManifest | null;
  manifestSource: ManifestSource;
  selected: string[];
  taskStates: Record<string, TaskStatus>;
  progress: { completed: number; total: number };
  currentTaskId: string | null;
  currentTaskTitle: string | null;
  awaitingDecision: string | null;
  /** Task whose detail is shown in the detail panel (clicked row). */
  focusedTaskId: string | null;

  // -- log ------------------------------------------------------------------
  logLines: LogLine[];
  claudeOutput: string;
  runStartedAt: number | null;

  // -- tunnel ---------------------------------------------------------------
  tunnel: { open: boolean; remotePort?: number; message?: string } | null;
  tunnelTestResult: { ip?: string; error?: string } | null;

  // -- actions --------------------------------------------------------------
  init(): void;
  setServers(servers: PersistedServer[]): void;
  addServer(server: PersistedServer): void;
  removeServer(name: string): void;
  setClientProxy(proxy: string): void;
  loadBuiltinManifest(): void;
  loadCustomManifest(yamlText: string): { ok: boolean; error?: string };
  connect(server: PersistedServer, opts: { clientProxy?: string; manifestSource: ManifestSource }): void;
  disconnect(): void;
  toggleTask(taskId: string): void;
  selectAll(): void;
  clearSelection(): void;
  focusTask(taskId: string | null): void;
  exec(ids?: string[]): void;
  stop(): void;
  retry(taskId: string): void;
  skip(taskId: string): void;
  fixWithClaude(taskId: string): void;
  sendPtyInput(data: string): void;
  requestTunnelTest(): void;
  openTunnel(): void;
  applyServerMessage(msg: ServerMessage): void;
}

// ---------------------------------------------------------------------------
//  Built-in default manifest (a representative subset of the init checklist)
// ---------------------------------------------------------------------------

export const BUILTIN_MANIFEST: TaskManifest = {
  meta: { name: 'fenix-server-init', version: '1.0' },
  tasks: [
    {
      id: 'apt-aliyun-mirror',
      title: '设置阿里云 APT 源',
      group: '系统基础配置',
      description: '将默认 Ubuntu 官方源替换为阿里云镜像源，加速软件包下载。',
      commands: [
        'cp /etc/apt/sources.list /etc/apt/sources.list.bak',
        'cat > /etc/apt/sources.list << EOF\n... （按版本写入镜像源）\nEOF',
        'apt update',
      ],
      verify: 'apt-get update',
      needs_proxy: false,
      requires: [],
      files: [],
    },
    {
      id: 'install-tools',
      title: '安装常用工具',
      group: '基础工具安装',
      description: '安装 zip、unzip、net-tools、git 等基础开发运维工具包。',
      commands: ['apt install -y zip unzip zlib1g-dev net-tools git'],
      verify: 'git --version',
      requires: ['apt-aliyun-mirror'],
      needs_proxy: false,
      files: [],
    },
    {
      id: 'config-git',
      title: '配置 Git 用户信息',
      group: '基础工具安装',
      description: '设置全局 Git 用户名与邮箱。',
      commands: [
        "git config --global user.name 'fenix-user'",
        "git config --global user.email 'fenix@example.com'",
      ],
      verify: 'git config --global --list',
      requires: ['install-tools'],
      needs_proxy: false,
      files: [],
    },
    {
      id: 'install-zsh',
      title: '安装 ZSH 并设为默认 Shell',
      group: 'Shell 环境配置',
      description: '安装 zsh 并设置用户默认 shell。',
      commands: ['apt install -y zsh', 'chsh -s $(which zsh)'],
      verify: 'zsh --version',
      requires: ['install-tools'],
      needs_proxy: false,
      files: [],
    },
    {
      id: 'install-ohmyzsh',
      title: '安装 Oh My Zsh',
      group: 'Shell 环境配置',
      description: '从 GitHub 安装 Oh My Zsh（依赖代理配置后可用）。',
      commands: ['sh install_ohmyzsh.sh'],
      requires: ['install-zsh', 'setup-proxy'],
      needs_proxy: true,
      files: [],
    },
    {
      id: 'setup-proxy',
      title: '安装 Clash 代理服务',
      group: '网络代理配置',
      description: '部署 Clash 客户端作为服务器出口代理（关键前置）。',
      commands: ['./install-clash.sh', 'sleep 3', 'clash --version'],
      verify: 'curl -s http://127.0.0.1:7890/version',
      needs_proxy: false,
      requires: [],
      files: [],
    },
    {
      id: 'install-docker',
      title: '安装 Docker',
      group: '需要代理的软件安装',
      description: '使用阿里云镜像安装 Docker Engine（需要代理下载 GPG 密钥）。',
      commands: ['apt install -y docker.io', 'systemctl enable --now docker'],
      verify: 'docker --version',
      requires: ['apt-aliyun-mirror', 'setup-proxy'],
      needs_proxy: true,
      files: [],
    },
    {
      id: 'install-gh',
      title: '安装 GitHub CLI (gh)',
      group: '需要代理的软件安装',
      description: '通过代理安装 GitHub CLI。',
      commands: ['apt install -y gh'],
      verify: 'gh --version',
      requires: ['setup-proxy'],
      needs_proxy: true,
      files: [],
    },
    {
      id: 'install-claude-code',
      title: '安装 Claude Code',
      group: 'Claude Code 安装',
      description: '全局安装 Claude Code CLI。',
      commands: ['npm install -g @anthropic-ai/claude-code'],
      verify: 'claude --version',
      requires: ['setup-proxy'],
      needs_proxy: true,
      files: [],
    },
    {
      id: 'secure-ssh',
      title: '安全加固 SSH 服务',
      group: '服务配置',
      description: '配置 sshd 禁止 root 密码登录等安全项。',
      commands: [
        "sed -i 's/^#PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config",
        'systemctl restart sshd',
      ],
      verify: 'sshd -t',
      requires: ['install-tools'],
      needs_proxy: false,
      files: [],
    },
  ],
};

// ---------------------------------------------------------------------------
//  Store
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'fenix.servers';

export const useAppStore = create<AppStore>()((set, get) => {
  // ---- local helpers (leveraged by actions) -------------------------------

  /** Cascade select a task, including all transitive `requires` dependencies. */
  function cascade(ids: string[], tasks: Task[]): string[] {
    const selectedSet = new Set(ids);
    const deps = new Map(tasks.map((t) => [t.id, t.requires]));
    const stack = [...selectedSet];
    while (stack.length > 0) {
      const id = stack.pop()!;
      for (const dep of deps.get(id) ?? []) {
        if (!selectedSet.has(dep)) {
          selectedSet.add(dep);
          stack.push(dep);
        }
      }
    }
    return tasks.filter((t) => selectedSet.has(t.id)).map((t) => t.id);
  }

  /** A task is blocked while any direct dependency has not succeeded. */
  function isBlocked(task: Task, states: Record<string, TaskStatus>): boolean {
    return (task.requires ?? []).some((dep) => states[dep] !== 'success');
  }

  /** Replace the current open header of a task's latest run with a terminal one. */
  function closeHeader(
    lines: LogLine[],
    taskId: string,
    status: TaskStatus,
    exitCode: number | null,
  ): LogLine[] {
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (line.kind === 'header' && line.taskId === taskId && line.status === 'running') {
        const next = [...lines];
        next[i] = { ...line, status, exitCode };
        return next;
      }
    }
    return lines;
  }

  /** Ordered task index, filled from the manifest by id. */
  function taskById(id: string): Task | undefined {
    return get().manifest?.tasks.find((t) => t.id === id);
  }

  // ---- state --------------------------------------------------------------

  return {
    wsStatus: 'closed',
    sshStatus: 'disconnected',
    sshMessage: null,
    host: null,
    username: null,
    port: null,
    servers: loadServers(),
    clientProxy: '127.0.0.1:7890',
    lastError: null,

    manifest: null,
    manifestSource: 'builtin',
    selected: [],
    taskStates: {},
    progress: { completed: 0, total: 0 },
    currentTaskId: null,
    currentTaskTitle: null,
    awaitingDecision: null,
    focusedTaskId: null,

    logLines: [],
    claudeOutput: '',
    runStartedAt: null,

    tunnel: null,
    tunnelTestResult: null,

    // ---- actions ----------------------------------------------------------

    init() {
      set({ servers: loadServers() });
      wsClient.onStatus((status) => {
        set((s) => ({
          wsStatus: status,
          // A transport-level drop demotes the SSH view until reconnect lands.
          sshStatus: status === 'ready' ? s.sshStatus : status === 'closed' ? 'disconnected' : s.sshStatus,
        }));
      });
      wsClient.onMessage((msg) => get().applyServerMessage(msg));
    },

    setServers(servers) {
      saveServers(servers);
      set({ servers });
    },

    addServer(server) {
      const existing = get().servers.filter((s) => s.name !== server.name);
      const next = [...existing, server];
      saveServers(next);
      set({ servers: next });
    },

    removeServer(name) {
      const next = get().servers.filter((s) => s.name !== name);
      saveServers(next);
      set({ servers: next });
    },

    setClientProxy(proxy) {
      set({ clientProxy: proxy });
    },

    loadBuiltinManifest() {
      set({
        manifest: BUILTIN_MANIFEST,
        manifestSource: 'builtin',
        taskStates: initialStates(BUILTIN_MANIFEST),
        selected: [],
        logLines: [],
        progress: { completed: 0, total: 0 },
        currentTaskId: null,
        currentTaskTitle: null,
        awaitingDecision: null,
        focusedTaskId: null,
        runStartedAt: null,
      });
    },

    loadCustomManifest(yamlText) {
      let data: unknown;
      try {
        data = parse(yamlText);
      } catch (err) {
        return { ok: false, error: `YAML 解析失败: ${(err as Error).message}` };
      }
      const result = parseTaskManifest(data);
      if (!result.ok) {
        const first = result.errors[0];
        return {
          ok: false,
          error: first ? `${first.path}: ${first.reason}` : '任务清单校验失败',
        };
      }
      const manifest = result.manifest;
      set({
        manifest,
        manifestSource: 'custom',
        taskStates: initialStates(manifest),
        selected: [],
        logLines: [],
        progress: { completed: 0, total: 0 },
        currentTaskId: null,
        currentTaskTitle: null,
        awaitingDecision: null,
        focusedTaskId: null,
        runStartedAt: null,
      });
      return { ok: true };
    },

    connect(server, opts) {
      if (!get().manifest) {
        if (opts.manifestSource === 'custom') {
          set({ lastError: '请先提供自定义任务清单内容' });
          return;
        }
        get().loadBuiltinManifest();
      }
      set({
        host: server.host,
        username: server.username,
        port: server.port,
        clientProxy: opts.clientProxy ?? get().clientProxy,
        sshStatus: 'connecting',
        sshMessage: null,
        lastError: null,
        runStartedAt: null,
      });
      const url = wsUrl();
      wsClient.connect(url);
      wsClient.send({
        type: 'connect',
        payload: {
          host: server.host,
          port: server.port,
          username: server.username,
          ...(server.password ? { password: server.password } : {}),
          clientProxy: opts.clientProxy ?? get().clientProxy,
        },
      });
    },

    disconnect() {
      wsClient.send({ type: 'disconnect' });
      wsClient.disconnect();
      set((s) => ({
        sshStatus: 'disconnected',
        sshMessage: null,
        selected: [],
        taskStates: s.manifest ? initialStates(s.manifest) : {},
        progress: { completed: 0, total: 0 },
        currentTaskId: null,
        currentTaskTitle: null,
        awaitingDecision: null,
        focusedTaskId: null,
        tunnel: null,
        tunnelTestResult: null,
        logLines: [],
        runStartedAt: null,
      }));
    },

    toggleTask(taskId) {
      const tasks = get().manifest?.tasks ?? [];
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;
      const states = get().taskStates;
      if (isBlocked(task, states)) return; // greyed out — not selectable

      const selected = new Set(get().selected);
      if (selected.has(taskId)) selected.delete(taskId);
      else selected.add(taskId);
      set({ selected: cascade([...selected], tasks) });
    },

    selectAll() {
      const tasks = get().manifest?.tasks ?? [];
      const states = get().taskStates;
      const available = tasks
        .filter((t) => !isBlocked(t, states))
        .map((t) => t.id);
      set({ selected: cascade(available, tasks) });
    },

    clearSelection() {
      set({ selected: [] });
    },

    focusTask(taskId) {
      set({ focusedTaskId: taskId });
    },

    exec(ids) {
      const tasks = get().manifest?.tasks ?? [];
      const target = ids ?? get().selected;
      if (target.length === 0) return;

      // Optimistic UI: set the run as started and mark tasks pending.
      const states: Record<string, TaskStatus> = {};
      for (const t of tasks) states[t.id] = 'pending';
      const queue = cascade(target, tasks);
      set({
        taskStates: states,
        selected: queue,
        progress: { completed: 0, total: queue.length },
        currentTaskId: null,
        currentTaskTitle: null,
        awaitingDecision: null,
        focusedTaskId: null,
        runStartedAt: Date.now(),
        lastError: null,
      });
      wsClient.send({ type: 'exec', payload: { taskIds: queue } });
    },

    stop() {
      wsClient.send({ type: 'stop' });
      set({ progress: { completed: 0, total: get().progress.total }, lastError: null });
    },

    retry(taskId) {
      wsClient.send({ type: 'retry', payload: { taskId } });
      set((s) => ({
        taskStates: { ...s.taskStates, [taskId]: 'pending' },
        awaitingDecision: null,
      }));
    },

    skip(taskId) {
      wsClient.send({ type: 'skip', payload: { taskId } });
      set((s) => ({ taskStates: { ...s.taskStates, [taskId]: 'skipped' } }));
    },

    fixWithClaude(taskId) {
      // Back-end orchestration is owned by add-claude-fallback; the front-end
      // only surfaces the request and reports a "not ready" error if the
      // handle hasn't materialised on the receiving side (server replies with
      // an `error` message which applyServerMessage surfaces).
      wsClient.send({ type: 'fixWithClaude', payload: { taskId } });
    },

    sendPtyInput(data) {
      wsClient.send({ type: 'pty-input', payload: { data } });
    },

    requestTunnelTest() {
      wsClient.send({ type: 'tunnel-test' });
    },

    openTunnel() {
      wsClient.send({ type: 'tunnel-open' });
    },

    applyServerMessage(msg) {
      const state = get();
      switch (msg.type) {
        case 'connection-status': {
          const p = msg.payload;
          set((s) => ({
            sshStatus: p.state,
            sshMessage: p.message ?? s.sshMessage,
            // A failed connect surfaces its reason as the status bar error.
            lastError: p.state === 'error' ? p.message ?? s.lastError : s.lastError,
          }));
          break;
        }
        case 'task-state': {
          const { taskId, status } = msg.payload;
          const states = { ...state.taskStates, [taskId]: status };
          const patch: Partial<AppStore> = { taskStates: states };
          if (status === 'running') {
            const task = taskById(taskId);
            // open a new command header for this run
            set((s) => {
              const order = s.logLines.length > 0 ? s.logLines[s.logLines.length - 1].order : 0;
              const header: LogHeaderLine = {
                kind: 'header',
                taskId,
                order: order + 1,
                command: task?.commands[0] ?? '',
                exitCode: null,
                status: 'running',
                timestamp: Date.now(),
              };
              const logLines = pushLine(s.logLines, header);
              return {
                ...patch,
                currentTaskId: taskId,
                currentTaskTitle: task?.title ?? null,
                awaitingDecision: null,
                logLines,
              };
            });
          } else if (status === 'success' || status === 'failed' || status === 'skipped') {
            const exitCode = status === 'success' ? 0 : status === 'failed' ? parseFailedExitCode(state, taskId) : null;
            set((s) => ({
              ...patch,
              logLines: closeHeader(s.logLines, taskId, status, exitCode),
              currentTaskId: status === 'success' || status === 'skipped' ? s.currentTaskId === taskId ? null : s.currentTaskId : s.currentTaskId,
              currentTaskTitle: status === 'success' || status === 'skipped' ? (s.currentTaskId === taskId ? null : s.currentTaskTitle) : s.currentTaskTitle,
              awaitingDecision: status === 'failed' ? taskId : s.awaitingDecision,
            }));
          } else if (status === 'fixing') {
            set((s) => ({
              ...patch,
              logLines: closeHeader(s.logLines, taskId, 'fixing', null),
              awaitingDecision: null,
            }));
          }
          break;
        }
        case 'progress': {
          const { completed, total } = msg.payload;
          set({ progress: { completed, total } });
          break;
        }
        case 'log': {
          const { taskId, stream, data } = msg.payload;
          const chunks = data.split('\n');
          const stateNow = get();
          let order = stateNow.logLines.length > 0 ? stateNow.logLines[stateNow.logLines.length - 1].order : 0;
          const additions: LogLine[] = [];
          for (const chunk of chunks) {
            if (chunk === '') continue;
            order += 1;
            additions.push({
              kind: 'output',
              taskId,
              stream: stream as LogStream,
              order,
              data: chunk,
              timestamp: Date.now(),
            });
          }
          if (additions.length > 0) {
            set((s) => ({ logLines: pushLines(s.logLines, additions) }));
          }
          break;
        }
        case 'claude-output': {
          const data = msg.payload.data;
          if (data) set((s) => ({ claudeOutput: (s.claudeOutput + data).slice(-CLAUDE_BUFFER_LIMIT) }));
          break;
        }
        case 'tunnel-status': {
          const p = msg.payload;
          set({ tunnel: { open: p.open, remotePort: p.remotePort, message: p.message } });
          break;
        }
        case 'error': {
          set({ lastError: msg.payload.message });
          break;
        }
      }
    },
  };
});

// ---------------------------------------------------------------------------
//  Helpers (module level)
// ---------------------------------------------------------------------------

/** Hard cap on the retained claude-output buffer (characters). */
const CLAUDE_BUFFER_LIMIT = 2_000_000;

function initialStates(manifest: TaskManifest): Record<string, TaskStatus> {
  const states: Record<string, TaskStatus> = {};
  for (const t of manifest.tasks) states[t.id] = 'pending';
  return states;
}

/** Ring buffer push: keep at most LOG_RING_LIMIT most recent lines. */
function pushLine(lines: LogLine[], line: LogLine): LogLine[] {
  const next = [...lines, line];
  return next.length > LOG_RING_LIMIT ? next.slice(next.length - LOG_RING_LIMIT) : next;
}

function pushLines(lines: LogLine[], additions: LogLine[]): LogLine[] {
  const next = [...lines, ...additions];
  return next.length > LOG_RING_LIMIT ? next.slice(next.length - LOG_RING_LIMIT) : next;
}

/** Derive a failed command's exit code from the runner's stderr log text. */
function parseFailedExitCode(state: AppStore, taskId: string): number {
  for (let i = state.logLines.length - 1; i >= 0; i--) {
    const line = state.logLines[i];
    if (line.kind === 'output' && line.taskId === taskId && line.stream === 'stderr') {
      const m = line.data.match(/退出码非 0（(\d+)）/);
      if (m) return Number(m[1]);
    }
  }
  return -1;
}

function wsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws`;
}

function loadServers(): PersistedServer[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as PersistedServer[]) : [];
  } catch {
    return [];
  }
}

function saveServers(servers: PersistedServer[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(servers));
  } catch {
    // Storage unavailable (private mode / quota) — degrade to memory only.
  }
}