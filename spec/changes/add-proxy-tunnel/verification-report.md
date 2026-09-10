# 验证报告：add-proxy-tunnel

> ⚠️ 本报告由框架于 2026-09-10T12:32:46Z 自动合成（裁决 Agent 未写报告，已由框架合成），内容为结构化验证产物（report.json / .fenix-run-result.json）的忠实渲染。

## 结论：✅ 通过（verified）

**状态：verified — 7/10 场景通过，3 失败，0 错误（全部场景通过）**

全部 3 个失败场景均为环境问题（容器名冲突级联，清理残留后复现通过），无产品缺陷。7/10 场景 PASS，3/10 场景归因 env 并放行。

| 指标 | 数量 |
| --- | --- |
| 通过 | 7 |
| 失败 | 3 |
| 错误 | 0 |
| 产品 Bug | 0 |
| 本链增量 Token（输入） | 2.24M |
| 本链增量 Token（输出） | 0.05M |


## 场景结果

| 场景 | 描述 | 状态 | 失败断言 | 分类 |
| --- | --- | --- | --- | --- |
| cli-build-typecheck | TypeScript 编译与类型检查：npm run build + tsc --noEmit 零错误，验证新增 tunnel.ts、proxy-inject.ts 编译通过且类型契约正确。出处：package.json（build/scripts）、tsconfig.server.json | pass | 0/3 | - |
| cli-tunnel-helpers-unit | 隧道辅助函数单元测试：parseProxyAddress 正确解析 host:port 与 IPv6 形式、拒绝非法地址；nextFreePort 跳过占用与跳过列表、空集返回 null。不依赖 Docker。出处：server/ssh/tunnel.test.ts:337-360（tunnel helpers describe） | pass | 0/2 | - |
| cli-docker-setup | 启动 SSH 测试容器：清理残留 → docker compose up --build -d → 等待 SSH 就绪。为后续集成测试提供 SSH 服务器环境（含 iproute2/curl 供 ss 探测与代理请求）。出处：docker-compose.test.yml、tests/sshd/Dockerfile.sshd、tests/sshd/wait-ssh.ts | fail | 1/3 | env |
| cli-tunnel-chain | 反向隧道全链路验证：容器内 curl -x 经隧道端口访问宿主机目标，验证服务器→隧道→客户端代理→目标全链路通；请求结束后 channel 自动关闭，mock 代理连接数归零不泄漏。出处：server/ssh/tunnel.test.ts:58-86 | pass | 0/2 | - |
| cli-tunnel-port | 隧道端口探测策略：30000 空闲时首选绑定；探测范围覆盖 20122 也永不选择（预留服务器 Clash 服务）；30000 被占时自动顺延至下一个空闲端口。出处：server/ssh/tunnel.test.ts:88-124 | fail | 1/2 | env |
| cli-tunnel-lifecycle | 隧道生命周期管理：重复 open 幂等返回既有隧道且服务器侧仅一个监听端口；显式 close 注销远端监听（ss -tln 确认移除）；SSH 连接断开联动隧道失效并发状态事件。出处：server/ssh/tunnel.test.ts:126-167 | fail | 1/2 | env |
| cli-tunnel-diagnostics | 隧道诊断：状态变更事件 closed→opening→open→closed 每次均发射且携带端口；连通性测试链路正常时返回出口 IP 文本；隧道未开启时快速返回失败原因（10 秒内）不挂起。出处：server/ssh/tunnel.test.ts:176-214 | pass | 0/2 | - |
| cli-tunnel-error | 隧道错误处理：客户端代理地址不可达时 open 明确报错（含「客户端代理不可达」字样）且不注册远端监听。出处：server/ssh/tunnel.test.ts:169-174 | pass | 0/2 | - |
| cli-proxy-inject | 代理注入全场景：needs_proxy 标记命令执行前自动开隧道并注入 http_proxy/https_proxy/HTTP_PROXY/HTTPS_PROXY 四个环境变量且值为隧道地址、命令原文不变；未标记 needs_proxy 不注入且隧道不自动打开；隧道未开时自动建立；客户端代理不可达时 withProxy 失败并报错指明检查代理地址。出处：server/ssh/proxy-inject.test.ts:47-108 | pass | 0/2 | - |
| cli-docker-cleanup | 清理 SSH 测试容器，释放 Docker 资源。出处：docker-compose.test.yml | pass | 0/1 | - |


## 断言级豁免清单

以下失败断言被归类为非产品缺陷（不记产品 Bug），逐条列出供人工复核豁免是否掩盖真实缺陷（场景级一句话归因不足以复核）。

| 场景 | 断言 | 归类 | 豁免理由 | 证据 |
| --- | --- | --- | --- | --- |
| cli-docker-setup | exit_code 期望0 实际1：docker compose up --build -d | env | 环境因素（非产品缺陷） | 容器硬编码名 fenix-sshd-test 与带外残留容器冲突（先前 run 遗留，down 未清掉）；清理残留后复现通过，非产品缺陷 |
| cli-tunnel-port | exit_code 期望0 实际1：vitest 运行首个空闲端口\|跳过 20122\|端口被占 | env | 环境因素（非产品缺陷） | 级联自 cli-docker-setup 容器名冲突（环境残留），同 root cause；清理残留容器后同命令复现 3 passed，非产品缺陷 |
| cli-tunnel-lifecycle | exit_code 期望0 实际1：vitest 运行重复 open\|显式关闭\|SSH 断开 | env | 环境因素（非产品缺陷） | 级联自 cli-docker-setup 容器名冲突（环境残留），同 root cause；清理残留容器后同命令复现 3 passed，非产品缺陷 |
