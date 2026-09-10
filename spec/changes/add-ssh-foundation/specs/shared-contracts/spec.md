# Spec: shared-contracts

## ADDED Requirements

### Requirement: WebSocket 消息类型契约

系统 SHALL 在 `shared/messages.ts` 定义前后端共用的 WebSocket 消息判别联合类型，覆盖设计文档 §8.2 全部消息名：

- Client→Server：`connect`、`exec`、`stop`、`retry`、`skip`、`fixWithClaude`、`pty-input`、`tunnel-open`、`tunnel-test`、`disconnect`
- Server→Client：`connection-status`、`task-state`、`log`、`claude-output`、`tunnel-status`、`progress`、`error`

每类消息 SHALL 有明确的 payload TypeScript 类型；本 SPEC 仅要求类型定义与最小 payload 完整性（`connect` 含凭据与代理地址、`exec` 含任务 id 列表、`log` 含任务 id/流标记/数据分片、`task-state` 含任务 id 与状态枚举、`tunnel-status` 含开启状态与端口），扩展字段由后续 SPEC 在各自变更中补充。

#### Scenario: 类型可被两端编译引用

- **WHEN** server 与 web（占位测试）分别 import 消息类型并构造典型消息
- **THEN** TypeScript 编译通过，`type` 字段为字面量联合

#### Scenario: 消息类型与设计文档枚举一致

- **WHEN** 检查 ClientMessage 与 ServerMessage 联合成员
- **THEN** 覆盖上列全部消息名且无遗漏

### Requirement: 任务清单 Schema

系统 SHALL 在 `shared/schema.ts` 提供 YAML 任务清单的 zod schema 与推断类型，字段语义遵循设计文档 §4.1：

- `meta`：`name`、`version`
- `tasks[]`：`id`（必填）、`title`（必填）、`group`、`description`、`commands`（非空字符串数组）、`verify`（可选）、`needs_proxy`（默认 false）、`requires`（任务 id 数组，默认空）、`files`（相对路径数组，默认空）、`claude_hint`（可选）
- `id` 在清单内 SHALL 唯一；`requires` 引用的 id SHALL 存在于清单内（存在性校验属本 schema；环检测属 add-task-engine）

校验失败 SHALL 返回带路径与原因的错误列表（非单一异常文本）。

#### Scenario: 合法清单通过校验

- **WHEN** 校验一份包含依赖、needs_proxy、files 的合法清单
- **THEN** 校验通过并得到强类型对象，缺省字段填充默认值

#### Scenario: 重复 id 报错

- **WHEN** 清单中两个任务使用相同 `id`
- **THEN** 校验失败，错误信息指明重复的 id

#### Scenario: 未知依赖报错

- **WHEN** 某任务 `requires` 引用不存在的任务 id
- **THEN** 校验失败，错误信息指明缺失的依赖 id

#### Scenario: 空命令数组报错

- **WHEN** 任务 `commands` 为空数组
- **THEN** 校验失败，错误信息指明该任务 id
