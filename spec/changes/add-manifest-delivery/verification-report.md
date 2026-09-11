# 验证报告：add-manifest-delivery

> ⚠️ 本报告由框架于 2026-09-11T15:32:33Z 自动合成（裁决 Agent 未写报告，已由框架合成），内容为结构化验证产物（report.json / .fenix-run-result.json）的忠实渲染。

## 结论：❌ 未通过（Bug Found）

**状态：bug-found — 9/12 场景通过，3 失败，0 错误（1 个真实产品 Bug）**

12 场景 9 过 3 败。真实产品 bug：连接后任务树缺 install-claude-code 行（服务端已下发 17 任务、前端 manifest 整体覆盖无过滤，根因 Collapse 动态新增分组面板未渲染 children，复现确认 DOM 仅 16 行）→ 场景 web-manifest-override-17-tasks（count 16≠17）与 web-dependency-greyout-server-requires（install-claude-code 复选框不存在）均 failed，同根因聚合为 1 个 bug。另 3 条断言时序错置（连接后查询已移出 DOM 的 submit 按钮、执行中查询防重复提交的 disabled 按钮）为场景文件缺陷，已就地修复 test_scenarios.json：web-manifest-override-17-tasks 移除 element_enabled/no_click_interception(submit)、web-dependency-greyout-server-requires 移除 no_click_interception(submit)、web-exec-no-unknown-task-error 移除 element_enabled(执行按钮)；场景3 修复后断言全过，场景1/2 待产品 bug 修复后重验。

| 指标 | 数量 |
| --- | --- |
| 通过 | 9 |
| 失败 | 3 |
| 错误 | 0 |
| 产品 Bug | 1 |
| 本链增量 Token（输入） | 9.75M |
| 本链增量 Token（输出） | 0.16M |


## 真实产品 Bug

### BUG-01（severity=major）· element_count / element_enabled

- 关联场景：web-manifest-override-17-tasks、web-dependency-greyout-server-requires
- 描述：UI 连接后任务树仅渲染 16/17 行：install-claude-code（「Claude Code」分组唯一任务）整行缺失，其复选框不可见，无法在 UI 上勾选执行
- 根因：web/src/components/TaskTree.tsx 的 Collapse defaultActiveKey 在组件首次挂载（连接前 loadBuiltinManifest，无「Claude Code」分组）已固化；服务端 manifest 覆盖后新增分组面板处于未激活态，且 Collapse 缺省 forceRender=false 不渲染折叠面板 children，导致 install-claude-code 行未挂载
- 证据（场景 web-manifest-override-17-tasks 结构化证据，引用）：
  - failed_assertions: [{"type": "element_count", "selector": "[data-testid^='task-row-']", "expected": 17, "actual": 16, "note": "复现实抓 DOM=16 行，面板 Claude Code(0/1) children 为空，install-claude-code 行缺失"}, {"type": "element_enabled", "selector": "button[type='submit']", "expected": "可启用", "actual": "元素不存在（断言时序错置，场景文件已修复）"}, {"type": "no_click_interception", "selector": "button[type='submit']", "expected": "可点击", "actual": "Locator.click: Timeout 3000ms（断言时序错置，场景文件已修复）"}]
  - screenshots: ["/root/fenix-server/.fenix/verify-progress/add-manifest-delivery/screenshots/web-manifest-override-17-tasks_assert_fail.png"]
  - first_failed_step: 步骤10 等待连接后: element_count 断言 task-row 期望17 实际16
  - repro: playwright 直连 127.0.0.1:58851 填表连接: task-row 计数=16，DOM_IDS 缺 install-claude-code；WS 直连服务端 manifest=17 含 install-claude-code


## 场景结果

| 场景 | 描述 | 状态 | 失败断言 | 分类 |
| --- | --- | --- | --- | --- |
| cli-build-typecheck | server + shared + web 编译 + 类型检查通过，确保交付物编译零错误。路径出处：package.json scripts.build / scripts.typecheck, tsconfig.server.json | pass | 0/1 | - |
| cli-unit-tests | server handlers（含 manifest 广播序列 + error 分支）+ web appStore（manifest 覆盖分支）+ shared schema 单元测试通过。路径出处：server/handlers.test.ts, web/src/stores/appStore.test.ts, shared/schema.test.ts | pass | 0/1 | - |
| cli-ensure-ssh-container | 确保 fenix-sshd-test 容器运行（ubuntu:24.04, root/testpass123, 宿主 2222）。路径出处：docker-compose.test.yml, tests/e2e/exec-flow.test.ts:56-104 | pass | 0/2 | - |
| cli-manifest-connect-order | connect 成功后 manifest 先于首个 task-state 到达，manifest 任务数 = 后续 task-state 数 = 17，包含服务端真实 ID（install-claude-code/install-base-tools/install-clash/config-sshd），不含前端硬编码 ID（install-tools/setup-proxy/secure-ssh）。路径出处：handlers.ts:456-468 sendManifestSnapshot, shared/messages.ts:151-154 ManifestPayload, assets/tasks.yaml | pass | 0/7 | - |
| cli-manifest-snapshot-resend | 重连 snapshot 请求时，服务端先回 manifest 再回全量 task-state，清单为当前会话清单（17 任务）。路径出处：handlers.ts:470-500 sendFullSnapshot | pass | 0/5 | - |
| cli-custom-yaml-delivery | connect 携带自定义 YAML（echo-ok/echo-dep/fail-always fixture）→ 服务端下发 manifest 任务 id 与 fixture 一致（3 任务），不下发内置清单。路径出处：handlers.ts:268-312 resolveManifest, handlers.ts:461-468 sendManifestSnapshot | pass | 0/4 | - |
| cli-exec-error-unknown-task | exec 发送服务端清单不存在的任务 id → 服务端回 error「未知任务 id: ...」，验证错误消息正确。路径出处：handlers.ts:623-629 handleExec unknown id branch | pass | 0/2 | - |
| cli-exec-error-blocked-task | exec 仅发送 echo-dep（缺少依赖 echo-ok）→ 服务端回 BLOCKED_TASK 错误指明缺失依赖。路径出处：handlers.ts:631-643 findBlockedTask BLOCKED_TASK branch | pass | 0/2 | - |
| cli-exec-flow-e2e | 运行 exec-flow e2e 测试（真实 SSH 容器 + fixture 清单）→ 覆盖无依赖任务执行至成功（pending→running→success + log + progress）、依赖闭包串行、失败决策态（重试/跳过）、内置清单 17 任务 id 一致性。路径出处：tests/e2e/exec-flow.test.ts, tests/e2e/fixtures/exec-flow-tasks.yaml, assets/tasks.yaml | pass | 0/2 | - |
| web-manifest-override-17-tasks | UI 连接后任务树显示服务端真实 17 任务（install-base-tools/install-clash/config-sshd/install-gh-cli 等），不显示前端硬编码 10 任务子集（install-tools/setup-proxy/secure-ssh/install-gh）。路径出处：appStore.ts:581-598 manifest case, TaskTree.tsx:76-141, assets/tasks.yaml | failed（已修正） | 3/13 | product-bug |
| web-dependency-greyout-server-requires | 连接后无依赖任务（install-claude-code/apt-aliyun-mirror）复选框可交互，有依赖任务（install-base-tools/config-git/install-clash/config-sshd）置灰禁用，置灰规则与 manifest.requires 推导一致。路径出处：TaskTree.tsx:54-56 isBlocked, TaskTree.tsx:98 disabled, appStore.ts:294-296 isBlocked | failed（已修正） | 2/10 | product-bug |
| web-exec-no-unknown-task-error | UI 勾选无依赖任务（apt-aliyun-mirror）并执行 → 进入 running 状态且进度条出现，全程无「未知任务 id」错误 Alert（.ant-alert-error），确认 manifest 覆盖后前后端任务 id 一致不再产生错配。路径出处：appStore.ts:581-598, ExecutionToolbar.tsx:46-54, TaskView.tsx:36-43 | failed（已修正） | 1/7 | test-defect |


## 断言级豁免清单

以下失败断言被归类为非产品缺陷（不记产品 Bug），逐条列出供人工复核豁免是否掩盖真实缺陷（场景级一句话归因不足以复核）。

| 场景 | 断言 | 归类 | 豁免理由 | 证据 |
| --- | --- | --- | --- | --- |
| web-manifest-override-17-tasks | element_enabled button[type='submit'] 连接按钮可启用 | test-defect | 测试用例自身缺陷（非产品缺陷） | 断言时序错置：text=●已连接 已通过，连接后登录表单移出 DOM，submit 按钮必然不存在；该断言已在 test_scenarios.json 原地移除 |
| web-manifest-override-17-tasks | no_click_interception button[type='submit'] 连接按钮可点击 | test-defect | 测试用例自身缺陷（非产品缺陷） | 同上：连接后按钮随表单消失，Locator.click 超时 3000ms；该断言已在 test_scenarios.json 原地移除 |
| web-dependency-greyout-server-requires | no_click_interception button[type='submit'] 连接按钮可点击 | test-defect | 测试用例自身缺陷（非产品缺陷） | 断言时序错置：连接后登录表单已移出 DOM，submit 按钮必然不存在，超时 3000ms；该断言已在 test_scenarios.json 原地移除 |
| web-exec-no-unknown-task-error | element_enabled button:has-text('执行选中') 执行后仍可启用 | test-defect | 测试用例自身缺陷（非产品缺陷） | 断言时序错置：计划同场景断言验证执行进入 running；点击后 ExecToolbar running=true 使按钮 disabled（产品防重复提交正确行为）；同场景 .ant-progress 可见/执行中/无 .ant-alert-error 全部通过，功能正常；该断言已在 test_scenario... |

## 本轮场景集变更

当前稳定场景集共 12 个（第 1 轮）。

- 首轮写入 12 个场景

