# Spec: task-manifest

## ADDED Requirements

### Requirement: 从 YAML 文件加载任务清单

系统 SHALL 提供从指定路径加载任务清单的能力：读取 YAML、经 shared schema 校验、返回强类型清单对象；文件不存在、YAML 语法错误、schema 校验失败 SHALL 返回包含具体原因（文件级或任务级定位）的错误，SHALL NOT 抛出未结构化的异常。

#### Scenario: 加载合法清单

- **WHEN** 加载一份合法的 YAML 任务清单文件
- **THEN** 返回含 meta 与任务数组的强类型对象

#### Scenario: 文件不存在

- **WHEN** 指定路径不存在
- **THEN** 返回错误并明确指出路径不存在

#### Scenario: YAML 语法错误

- **WHEN** 文件内容不是合法 YAML
- **THEN** 返回错误并包含解析失败的行信息

#### Scenario: 校验失败定位到任务

- **WHEN** 清单中某任务缺少 `commands`
- **THEN** 错误信息定位到该任务 id 与缺失字段

### Requirement: 清单内任务 id 唯一与依赖存在性

加载时 SHALL 校验任务 id 在清单内唯一、`requires` 引用的 id 存在（shared schema 已具备，本能力要求 manifest 加载路径完整暴露该校验结果）。

#### Scenario: 重复 id 拒绝加载

- **WHEN** 清单含两个相同 id 的任务
- **THEN** 加载失败并指明重复 id
