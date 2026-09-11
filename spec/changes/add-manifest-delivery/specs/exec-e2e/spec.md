# Spec: exec-e2e

## ADDED Requirements

### Requirement: 执行链路真实 SSH e2e 覆盖

e2e 测试 SHALL 使用真实 SSH 测试容器（ubuntu:24.04、root/password 密码登录、宿主端口 2222），覆盖「连接 → 清单展示 → 勾选 → 执行 → 状态迁移 → 日志/进度 → 成功」完整链路；断言以真实浏览器/WS 交互与 DOM 状态为准，不得 mock 被测 API。

#### Scenario: 无依赖任务执行至成功

- **WHEN** 连接后勾选单个无依赖任务并触发执行
- **THEN** 断言该任务状态依次 pending → running → success，且收到该任务的日志输出（stdout 含预期内容）与进度更新（completed/total 递增）

#### Scenario: 多个依赖闭合任务执行

- **WHEN** 勾选包含依赖闭包的多个任务并执行
- **THEN** 断言依赖先行、全部任务达到 success，进度最终 completed==total

### Requirement: 失败任务决策态 e2e 覆盖

e2e 测试 SHALL 使用含故意失败任务的测试清单（fixture YAML，含 `exit 1` 命令的任务），覆盖「失败 → 决策态 → 重试/跳过」交互；断言 runner 停在 awaiting-decision 且 UI 呈现决策入口。

#### Scenario: 失败任务触发决策态

- **WHEN** 执行一个命令返回非零退出码的失败任务
- **THEN** 断言该任务状态为 failed，UI 出现重试/跳过（或停止）决策入口，队列未继续

#### Scenario: 失败后重试

- **WHEN** 失败任务处于决策态时用户触发重试
- **THEN** 断言该任务重新进入 running 并再次产出日志（重试动作生效，状态离开 failed）

#### Scenario: 失败后跳过

- **WHEN** 失败任务处于决策态时用户触发跳过
- **THEN** 断言该任务状态变为 skipped，队列继续推进后续任务

### Requirement: 清单一致性 e2e 覆盖

e2e 测试 SHALL 验证 manifest 下发后前端展示清单与服务端一致：任务中任务数与 id 集合与服务端 `assets/tasks.yaml`（或测试 fixture 清单）逐一对齐；执行返回的成功任务 id 存在于前端清单，杜绝前轮「未知任务 id」错配回归。

#### Scenario: 前后端任务 id 一致

- **WHEN** 连接成功后扫描前端任务树
- **THEN** 断言前端渲染的任务 id 集合 == 服务端清单任务 id 集合，且无可选任务在服务端不存在

#### Scenario: 执行无「未知任务 id」错误

- **WHEN** 勾选前端可见任务并执行
- **THEN** 断言全程无「未知任务 id」错误消息，执行按清单语义推进