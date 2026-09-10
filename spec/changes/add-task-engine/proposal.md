# Proposal: add-task-engine

## Why

工具的核心价值是把任务清单变成"可勾选、可执行、有进度、失败可控"的执行流。add-ssh-foundation 提供了连接与命令能力，但缺少任务层面的编排：清单加载校验、依赖排序、执行状态机与失败停等语义。本 SPEC 实现执行引擎，是前端 UI 与 Claude 回退的直接消费方。

## What Changes

- 新增 `server/engine/manifest.ts`：从 YAML 文件加载任务清单并调用 shared schema 校验（含友好错误呈现）
- 新增 `server/engine/planner.ts`：`requires` 依赖环检测、拓扑排序生成执行队列、勾选集级的联勾选计算（含依赖未完成的置灰判定）
- 新增 `server/engine/runner.ts`：执行状态机 runner——按队列逐任务执行（上传 files → 逐条 commands → verify），状态流转 `pending/running/success/failed/fixing/skipped`，失败停等用户决策（重试/跳过），「停止」终止当前命令并清空队列，实时通过事件回调回传任务状态与日志分片
- 集成 add-ssh-foundation 的 SshConnection/executor/sftp；日志分片通过 `log` 消息结构（taskId、stream、data）回调

## Capabilities

### New Capabilities

- `task-manifest`: 任务清单加载——YAML 解析、schema 校验、校验错误的任务级定位与呈现
- `execution-planner`: 执行规划——依赖环检测、拓扑排序、勾选级联与可执行判定
- `execution-runner`: 执行状态机——单队列串行执行、文件预上传、命令序列执行与验证、失败停等、重试/跳过/停止语义、状态与日志事件流

### Modified Capabilities

（无）

## Impact

- 新增文件：`server/engine/`（manifest/planner/runner 及测试）
- 依赖 add-ssh-foundation 的 `shared/schema.ts`、`server/ssh/*`
- 被 add-web-ui（进度/控制交互）、add-claude-fallback（fixing 状态接入）、add-builtin-tasks-e2e（端到端）依赖
