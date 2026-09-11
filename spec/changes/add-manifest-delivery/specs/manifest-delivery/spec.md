# Spec: manifest-delivery

## ADDED Requirements

### Requirement: manifest 消息下发

服务端 SHALL 在成功建立 SSH 会话后、下发任务状态快照之前，广播 `{ type: 'manifest', payload: { manifest } }`，其 manifest 为本次会话实际解析出的任务清单（内置 `assets/tasks.yaml` 或 connect 消息携带的自定义 YAML，与任务执行所用清单一致）；断线重连后的 `snapshot` 补发 SHALL 同样先发 manifest 再发 task-state，保证前端清单与后端一致。

#### Scenario: connect 成功后下发 manifest

- **WHEN** 客户端 connect 成功建立会话
- **THEN** 客户端在首个 task-state 之前收到 manifest 消息，其任务数与后续 task-state 数一致

#### Scenario: 重连快照补发 manifest

- **WHEN** 会话执行中 WebSocket 重连后客户端发送 snapshot
- **THEN** 服务端先回 manifest 再回全量 task-state，清单为当前会话清单

#### Scenario: 自定义清单同样下发

- **WHEN** connect 消息携带自定义 YAML 且连接成功
- **THEN** 下发的 manifest 即该自定义清单（而非内置清单），任务 id 与前端本地解析结果一致

### Requirement: 前端清单覆盖与视图重建

前端 SHALL 在收到 `manifest` 消息时用其覆盖当前 manifest，按新任务集重建 taskStates（全部 pending，除非随后 task-state 覆盖）、清空勾选集、重置进度与日志，并保持当前连接状态不被重置；任务树 SHALL 基于服务端清单渲染（任务数、分组、依赖图、置灰规则）。

#### Scenario: 内置清单覆盖代表性子集

- **WHEN** 前端选择内置清单并连接成功收到 manifest
- **THEN** 任务树显示服务端真实任务集（17 个），依赖置灰按服务端 requires 计算，不再出现 id 错位

#### Scenario: 依赖置灰与真实依赖图一致

- **WHEN** 连接后任务均未执行（pending）
- **THEN** 仅无依赖任务可选，有依赖任务置灰，且可选任务集与 manifest.requires 推导一致

### Requirement: 任务视图错误可见化

执行区 SHALL 提供全局错误出口：服务端 `error` 消息（未知任务 id、BLOCKED_TASK、NO_SESSION 等）在任务视图 SHALL 可见展示（非仅连接视图），用户据此可定位「执行选中无反应」类静默失败；错误 SHALL 在下次成功动作发起时清除，避免残留误导。

#### Scenario: 执行未知任务显示错误

- **WHEN** 前端发送含后端清单不存在任务 id 的 exec
- **THEN** 服务端回 error「未知任务 id: …」，任务视图可见该错误文案

#### Scenario: 阻塞任务显示依赖提示

- **WHEN** 执行的任务集缺依赖时
- **THEN** 任务视图可见 BLOCKED_TASK 错误（指明任务与缺失依赖）

#### Scenario: 错误随新动作清除

- **WHEN** 错误展示后用户再次发起合法执行
- **THEN** 旧错误被清除，任务视图不再显示