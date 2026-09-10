# Spec: app-shell

## ADDED Requirements

### Requirement: WebSocket 客户端与断线重连补发

前端 SHALL 维持到服务端的 WebSocket 连接：意外断开时按退避自动重连；重连成功 SHALL 请求执行快照并全量还原任务状态/进度/当前任务；连接状态 SHALL 全局可见（未连接时任务功能禁用并显示连接视图）。

#### Scenario: 断线自动重连并还原状态

- **WHEN** 执行中断开 WebSocket 后服务恢复
- **THEN** 前端自动重连并还原全部任务状态与进度

### Requirement: 应用壳布局与状态栏

应用 SHALL 提供顶栏（用户@主机、连接状态、隧道指示器、断开按钮）与底部状态栏（SSH 状态、隧道状态、当前任务、耗时）；主区 SHALL 以 Tab 组织「执行日志」「任务详情」「Claude 修复」。

#### Scenario: 顶栏与状态栏信息一致

- **WHEN** 连接建立并开启隧道后执行任务
- **THEN** 顶栏显示主机与连接/隧道状态，状态栏显示当前任务与耗时

### Requirement: 隧道指示器与测试

顶栏隧道指示器 SHALL 显示隧道状态与端口（颜色区分：已连通/关闭/错误）；「测试」按钮 SHALL 发送 tunnel-test 并以气泡展示测试结果（出口 IP 或失败原因）。

#### Scenario: 测试返回出口 IP

- **WHEN** 隧道已连通时点击测试
- **THEN** 气泡显示出口 IP

#### Scenario: 关闭态指示

- **WHEN** 隧道未开启
- **THEN** 指示器显示关闭态（灰色）与开启入口
