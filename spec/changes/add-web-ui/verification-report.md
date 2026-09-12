# 验证报告：add-web-ui

> ⚠️ 本报告由框架于 2026-09-11T05:25:18Z 自动合成（裁决 Agent 未写报告，已由框架合成），内容为结构化验证产物（report.json / .fenix-run-result.json）的忠实渲染。

## 结论：❌ 未通过（Bug Found）

**状态：bug-found — 12/32 场景通过，20 失败，0 错误（1 个真实产品 Bug）**

| 指标 | 数量 |
| --- | --- |
| 通过 | 12 |
| 失败 | 20 |
| 错误 | 0 |
| 产品 Bug | 1 |
| 本链增量 Token（输入） | 23.31M |
| 本链增量 Token（输出） | 0.38M |


## 真实产品 Bug

### BUG-01（severity=BLOCKING）· -

- 证据：
  - screenshots/rerun/connect-stuck-loading.png
  - node 直连 ws://127.0.0.1:56173/ws 发送 connect → connection-status ready + 17 task-state + progress
  - playwright 打点：WS CREATE→OPEN 成功；__sendLog=[] 无任何发送帧


## 场景结果

| 场景 | 描述 | 状态 | 失败断言 | 分类 |
| --- | --- | --- | --- | --- |
| disconnected-shows-connection-view | 未连接时显示连接视图全屏。路径出处：App.tsx:84-92, server/index.ts:70 | pass | 0/4 | - |
| server-form-all-fields-visible | 连接表单正确渲染所有字段。路径出处：ConnectionView.tsx:129-318 | pass | 0/9 | - |
| server-form-required-validation | 必填字段为空时提交显示验证错误。路径出处：ConnectionView.tsx:190-218 | pass | 0/6 | - |
| server-form-host-validation | 主机地址格式不正确时显示格式错误。路径出处：ConnectionView.tsx:200-203 | pass | 0/5 | - |
| remember-password-shows-risk-warning | 打开记住密码开关时显示明文存储风险提示。路径出处：ConnectionView.tsx:227-237 | pass | 0/4 | - |
| remember-password-hides-warning-on-off | 关闭记住密码开关时风险提示消失。路径出处：ConnectionView.tsx:227-237 | pass | 0/4 | - |
| proxy-address-format-validation | 客户端代理地址格式错误时显示格式提示。路径出处：ConnectionView.tsx:245-251 | pass | 0/4 | - |
| manifest-builtin-selectable | 可选择内置默认任务清单。路径出处：ConnectionView.tsx:255-258 | pass | 0/4 | - |
| manifest-custom-yaml-input | 可选择自定义 YAML 并输入内容。路径出处：ConnectionView.tsx:261-291 | pass | 0/5 | - |
| connect-button-loading-state | 连接按钮在提交后显示加载状态。路径出处：ConnectionView.tsx:304-313 | pass | 0/3 | - |
| connect-success-enters-task-view | 连接成功后进入任务视图，顶栏显示 user@host:port，Tab 布局渲染。路径出处：App.tsx:98-117, TaskView.tsx:30-76 | fail | 7/8 | env |
| task-tree-groups-and-icons | 任务树按分组折叠，各任务状态图标（░待执行）正确渲染。路径出处：TaskTree.tsx:28-141 | fail | 5/6 | env |
| task-cascade-selection | 全选时只选中未被阻塞的任务（级联规则），阻塞任务保持未选中。路径出处：appStore.ts:277-291, 500-510 | fail | 1/1 | env |
| task-blocked-greyed-out | 依赖未完成的任务复选框置灰禁用。路径出处：TaskTree.tsx:98, appStore.ts:294-296 | fail | 4/6 | env |
| exec-toolbar-buttons-visible | 执行工具栏包含全选/清空/执行选中/停止按钮。路径出处：ExecutionToolbar.tsx:38-58 | fail | 6/7 | env |
| select-all-and-clear | 全选按钮选中所有可选任务，清空按钮清空所有勾选。路径出处：ExecutionToolbar.tsx:40-45, appStore.ts:500-510 | fail | 1/1 | env |
| exec-selected-shows-progress | 勾选任务并点击执行显示进度条。路径出处：ExecutionToolbar.tsx:60-70 | fail | 1/1 | env |
| stop-execution | 执行中点击停止。路径出处：ExecutionToolbar.tsx:55-57, appStore.ts:540-543 | fail | 1/1 | env |
| task-detail-panel-empty-state | 未点击任务时详情面板显示空状态。路径出处：TaskDetailPanel.tsx:41-44 | fail | 1/1 | env |
| task-detail-panel-content | 点击任务后详情面板显示描述/命令/验证/依赖/文件。路径出处：TaskDetailPanel.tsx:48-119 | fail | 1/1 | env |
| log-viewer-empty-state | 未执行时日志视图显示0行。路径出处：LogViewer.tsx:137-146 | fail | 3/4 | env |
| log-viewer-auto-scroll | 执行时日志自动滚动保持最新行可见。路径出处：LogViewer.tsx:96-101 | fail | 1/1 | env |
| log-command-header-exit-code | 命令分隔头显示命令文本和退出码徽标。路径出处：LogViewer.tsx:34-65 | fail | 1/1 | env |
| log-line-count-updates | 日志行数计数器实时更新。路径出处：LogViewer.tsx:137-146 | fail | 1/1 | env |
| claude-terminal-renders | Claude终端组件正确渲染。路径出处：ClaudeTerminal.tsx:87-105 | fail | 1/1 | env |
| claude-terminal-dual-input | 终端键盘输入和辅助输入框提交均发送 pty-input。路径出处：ClaudeTerminal.tsx:48-50, 81-85 | fail | 1/1 | env |
| top-bar-and-status-bar | 顶栏显示 user@host:port、已连接、隧道指示器、断开按钮；状态栏显示 SSH/隧道。路径出处：App.tsx:98-150 | fail | 4/7 | env |
| tunnel-indicator-closed-state | 隧道关闭时指示器显示关闭态与开启入口。路径出处：TunnelIndicator.tsx:24-29, 56-58 | fail | 4/5 | env |
| tunnel-test-popover | 隧道测试气泡显示测试说明。路径出处：TunnelIndicator.tsx:47-53 | fail | 1/1 | env |
| disconnect-returns-to-connection-view | 点击断开按钮返回连接视图。路径出处：App.tsx:116, appStore.ts:467-485 | fail | 1/1 | env |
| server-persistence-local-storage | 保存的服务器配置持久化到 localStorage。路径出处：appStore.ts:724-739 | pass | 0/4 | - |
| server-delete-removes-from-list | 删除服务器后从下拉列表移除。路径出处：ConnectionView.tsx:172-181, appStore.ts:377-380 | pass | 0/6 | test-defect |


## 断言级豁免清单

以下失败断言被归类为非产品缺陷（不记产品 Bug），逐条列出供人工复核豁免是否掩盖真实缺陷（场景级一句话归因不足以复核）。

| 场景 | 断言 | 归类 | 豁免理由 | 证据 |
| --- | --- | --- | --- | --- |
| connect-success-enters-task-view | element_visible [text=●已连接] 已连接状态 | env | 环境因素（非产品缺陷） | selector=text=●已连接 expected= Locator.wait_for: Timeout 3000ms exceeded.
Call log:
  - waiting for locator("text=●已连接").first to be visible |
| connect-success-enters-task-view | element_visible [text=全] 执行工具栏 | env | 环境因素（非产品缺陷） | selector=text=全 expected= Locator.wait_for: Timeout 3000ms exceeded.
Call log:
  - waiting for locator("text=全").first to be visible |
| connect-success-enters-task-view | element_visible [text=执行日志] 日志标签 | env | 环境因素（非产品缺陷） | selector=text=执行日志 expected= Locator.wait_for: Timeout 3000ms exceeded.
Call log:
  - waiting for locator("text=执行日志").first to be visible |
| connect-success-enters-task-view | element_visible [text=任务详情] 详情标签 | env | 环境因素（非产品缺陷） | selector=text=任务详情 expected= Locator.wait_for: Timeout 3000ms exceeded.
Call log:
  - waiting for locator("text=任务详情").first to be visible |
| connect-success-enters-task-view | element_visible [text=⚡ Claude修复] Claude标签 | env | 环境因素（非产品缺陷） | selector=text=⚡ Claude修复 expected= Locator.wait_for: Timeout 3000ms exceeded.
Call log:
  - waiting for locator("text=⚡ Claude修复").first to be visible |
| connect-success-enters-task-view | text_contains [root@127.0.0.1] text_contains | env | 环境因素（非产品缺陷） | selector= expected= |
| connect-success-enters-task-view | no_click_interception [text=全] 全选可点击 | env | 环境因素（非产品缺陷） | selector=text=全 expected= Locator.click: Timeout 3000ms exceeded.
Call log:
  - waiting for locator("text=全").first |
| task-tree-groups-and-icons | element_visible [[data-testid='task-row-apt-aliyun-mirror']] APT源任务行 | env | 环境因素（非产品缺陷） | selector=[data-testid='task-row-apt-aliyun-mirror'] expected= Locator.wait_for: Timeout 3000ms exceeded.
Call log:
  - waiting for locator("[data-testid='tas... |
| task-tree-groups-and-icons | element_visible [text=系统基础配置] 分组标题 | env | 环境因素（非产品缺陷） | selector=text=系统基础配置 expected= Locator.wait_for: Timeout 3000ms exceeded.
Call log:
  - waiting for locator("text=系统基础配置").first to be visible |
| task-tree-groups-and-icons | element_visible [text=设置阿里云 APT 源] 任务名称 | env | 环境因素（非产品缺陷） | selector=text=设置阿里云 APT 源 expected= Locator.wait_for: Timeout 3000ms exceeded.
Call log:
  - waiting for locator("text=设置阿里云 APT 源").first to be visible |
| task-tree-groups-and-icons | text_contains [root@127.0.0.1] text_contains | env | 环境因素（非产品缺陷） | selector= expected= |
| task-tree-groups-and-icons | no_click_interception [[data-testid='task-row-apt-aliyun-mirror']] 任务行可点击 | env | 环境因素（非产品缺陷） | selector=[data-testid='task-row-apt-aliyun-mirror'] expected= Locator.click: Timeout 3000ms exceeded.
Call log:
  - waiting for locator("[data-testid='task-r... |
| task-cascade-selection | step click [button:has-text('全')] | env | 环境因素（非产品缺陷） | Locator.wait_for: Timeout 5000ms exceeded.
Call log:
  - waiting for locator("button:has-text('全')").first to be visible
 |
| task-blocked-greyed-out | element_visible [[data-testid='task-row-install-tools'] .ant-checkbox-disabled] install-tools 禁用 | env | 环境因素（非产品缺陷） | selector=[data-testid='task-row-install-tools'] .ant-checkbox-disabled expected= Locator.wait_for: Timeout 3000ms exceeded.
Call log:
  - waiting for locator... |
| task-blocked-greyed-out | element_visible [[data-testid='task-row-config-git'] .ant-checkbox-disabled] config-git 禁用 | env | 环境因素（非产品缺陷） | selector=[data-testid='task-row-config-git'] .ant-checkbox-disabled expected= Locator.wait_for: Timeout 3000ms exceeded.
Call log:
  - waiting for locator("[... |
| task-blocked-greyed-out | text_contains [root@127.0.0.1] text_contains | env | 环境因素（非产品缺陷） | selector= expected= |
| task-blocked-greyed-out | no_click_interception [[data-testid='task-row-apt-aliyun-mirror']] 未禁用行可点击 | env | 环境因素（非产品缺陷） | selector=[data-testid='task-row-apt-aliyun-mirror'] expected= Locator.click: Timeout 3000ms exceeded.
Call log:
  - waiting for locator("[data-testid='task-r... |
| exec-toolbar-buttons-visible | element_visible [button:has-text('全')] 全选按钮 | env | 环境因素（非产品缺陷） | selector=button:has-text('全') expected= Locator.wait_for: Timeout 3000ms exceeded.
Call log:
  - waiting for locator("button:has-text('全')").first to be visible |
| exec-toolbar-buttons-visible | element_visible [button:has-text('清')] 清空按钮 | env | 环境因素（非产品缺陷） | selector=button:has-text('清') expected= Locator.wait_for: Timeout 3000ms exceeded.
Call log:
  - waiting for locator("button:has-text('清')").first to be visible |
| exec-toolbar-buttons-visible | element_visible [button:has-text('执行选中')] 执行按钮 | env | 环境因素（非产品缺陷） | selector=button:has-text('执行选中') expected= Locator.wait_for: Timeout 3000ms exceeded.
Call log:
  - waiting for locator("button:has-text('执行选中')").first to b... |
| exec-toolbar-buttons-visible | element_visible [button:has-text('停')] 停止按钮 | env | 环境因素（非产品缺陷） | selector=button:has-text('停') expected= Locator.wait_for: Timeout 3000ms exceeded.
Call log:
  - waiting for locator("button:has-text('停')").first to be visible |
| exec-toolbar-buttons-visible | text_contains [root@127.0.0.1] text_contains | env | 环境因素（非产品缺陷） | selector= expected= |
| exec-toolbar-buttons-visible | no_click_interception [button:has-text('全')] 全选可点击 | env | 环境因素（非产品缺陷） | selector=button:has-text('全') expected= Locator.click: Timeout 3000ms exceeded.
Call log:
  - waiting for locator("button:has-text('全')").first |
| select-all-and-clear | step click [button:has-text('全')] | env | 环境因素（非产品缺陷） | Locator.wait_for: Timeout 5000ms exceeded.
Call log:
  - waiting for locator("button:has-text('全')").first to be visible
 |
| exec-selected-shows-progress | step click [[data-testid='task-row-apt-aliyun-mirror'] .ant-checkbox] | env | 环境因素（非产品缺陷） | Locator.wait_for: Timeout 5000ms exceeded.
Call log:
  - waiting for locator("[data-testid='task-row-apt-aliyun-mirror'] .ant-checkbox").first to be visible
 |
| stop-execution | step click [[data-testid='task-row-apt-aliyun-mirror'] .ant-checkbox] | env | 环境因素（非产品缺陷） | Locator.wait_for: Timeout 5000ms exceeded.
Call log:
  - waiting for locator("[data-testid='task-row-apt-aliyun-mirror'] .ant-checkbox").first to be visible
 |
| task-detail-panel-empty-state | step click [.ant-tabs-tab:has-text('任务详情')] | env | 环境因素（非产品缺陷） | Locator.wait_for: Timeout 5000ms exceeded.
Call log:
  - waiting for locator(".ant-tabs-tab:has-text('任务详情')").first to be visible
 |
| task-detail-panel-content | step click [[data-testid='task-row-install-tools']] | env | 环境因素（非产品缺陷） | Locator.wait_for: Timeout 5000ms exceeded.
Call log:
  - waiting for locator("[data-testid='task-row-install-tools']").first to be visible
 |
| log-viewer-empty-state | element_visible [text=0 行] 行数为0 | env | 环境因素（非产品缺陷） | selector=text=0 行 expected= Locator.wait_for: Timeout 3000ms exceeded.
Call log:
  - waiting for locator("text=0 行").first to be visible |
| log-viewer-empty-state | no_click_interception [.ant-tabs-tab:has-text('执行日志')] 日志标签可点击 | env | 环境因素（非产品缺陷） | selector=.ant-tabs-tab:has-text('执行日志') expected= Locator.click: Timeout 3000ms exceeded.
Call log:
  - waiting for locator(".ant-tabs-tab:has-text('执行日志')")... |
| log-viewer-empty-state | text_contains [root@127.0.0.1] text_contains | env | 环境因素（非产品缺陷） | selector= expected= |
| log-viewer-auto-scroll | step click [[data-testid='task-row-apt-aliyun-mirror'] .ant-checkbox] | env | 环境因素（非产品缺陷） | Locator.wait_for: Timeout 5000ms exceeded.
Call log:
  - waiting for locator("[data-testid='task-row-apt-aliyun-mirror'] .ant-checkbox").first to be visible
 |
| log-command-header-exit-code | step click [[data-testid='task-row-apt-aliyun-mirror'] .ant-checkbox] | env | 环境因素（非产品缺陷） | Locator.wait_for: Timeout 5000ms exceeded.
Call log:
  - waiting for locator("[data-testid='task-row-apt-aliyun-mirror'] .ant-checkbox").first to be visible
 |
| log-line-count-updates | step click [[data-testid='task-row-apt-aliyun-mirror'] .ant-checkbox] | env | 环境因素（非产品缺陷） | Locator.wait_for: Timeout 5000ms exceeded.
Call log:
  - waiting for locator("[data-testid='task-row-apt-aliyun-mirror'] .ant-checkbox").first to be visible
 |
| claude-terminal-renders | step click [.ant-tabs-tab:has-text('⚡ Claude修复')] | env | 环境因素（非产品缺陷） | Locator.wait_for: Timeout 5000ms exceeded.
Call log:
  - waiting for locator(".ant-tabs-tab:has-text('⚡ Claude修复')").first to be visible
 |
| claude-terminal-dual-input | step click [.ant-tabs-tab:has-text('⚡ Claude修复')] | env | 环境因素（非产品缺陷） | Locator.wait_for: Timeout 5000ms exceeded.
Call log:
  - waiting for locator(".ant-tabs-tab:has-text('⚡ Claude修复')").first to be visible
 |
| top-bar-and-status-bar | element_visible [text=●已连接] 已连接状态 | env | 环境因素（非产品缺陷） | selector=text=●已连接 expected= Locator.wait_for: Timeout 3000ms exceeded.
Call log:
  - waiting for locator("text=●已连接").first to be visible |
| top-bar-and-status-bar | element_visible [button:has-text('断')] 断开按钮 | env | 环境因素（非产品缺陷） | selector=button:has-text('断') expected= Locator.wait_for: Timeout 3000ms exceeded.
Call log:
  - waiting for locator("button:has-text('断')").first to be visible |
| top-bar-and-status-bar | no_click_interception [button:has-text('断')] 断开可点击 | env | 环境因素（非产品缺陷） | selector=button:has-text('断') expected= Locator.click: Timeout 3000ms exceeded.
Call log:
  - waiting for locator("button:has-text('断')").first |
| top-bar-and-status-bar | text_contains [root@127.0.0.1] text_contains | env | 环境因素（非产品缺陷） | selector= expected= |
| tunnel-indicator-closed-state | element_visible [text=隧道关闭] 关闭态 | env | 环境因素（非产品缺陷） | selector=text=隧道关闭 expected= Locator.wait_for: Timeout 3000ms exceeded.
Call log:
  - waiting for locator("text=隧道关闭").first to be visible |
| tunnel-indicator-closed-state | element_visible [button:has-text('开启隧道')] 开启入口 | env | 环境因素（非产品缺陷） | selector=button:has-text('开启隧道') expected= Locator.wait_for: Timeout 3000ms exceeded.
Call log:
  - waiting for locator("button:has-text('开启隧道')").first to b... |
| tunnel-indicator-closed-state | no_click_interception [button:has-text('开启隧道')] 开启按钮可点击 | env | 环境因素（非产品缺陷） | selector=button:has-text('开启隧道') expected= Locator.click: Timeout 3000ms exceeded.
Call log:
  - waiting for locator("button:has-text('开启隧道')").first |
| tunnel-indicator-closed-state | text_contains [root@127.0.0.1] text_contains | env | 环境因素（非产品缺陷） | selector= expected= |
| tunnel-test-popover | step click [text=隧道连通性测试] | env | 环境因素（非产品缺陷） | Locator.wait_for: Timeout 5000ms exceeded.
Call log:
  - waiting for locator("text=隧道连通性测试").first to be visible
 |
| disconnect-returns-to-connection-view | step click [button:has-text('断')] | env | 环境因素（非产品缺陷） | Locator.wait_for: Timeout 5000ms exceeded.
Call log:
  - waiting for locator("button:has-text('断')").first to be visible
 |
| server-delete-removes-from-list | element_not_exist [text=待删服务器] 已删除服务器不在列表 | test-defect | 测试用例自身缺陷（非产品缺陷） | 断言选择器 text= 命中 antd 隐藏测量容器（0×0），非产品缺陷；已复现删除成功（重开下拉为[]、选中态清零） |

## 本轮场景集变更

场景集与持久化集一致，无变更。

