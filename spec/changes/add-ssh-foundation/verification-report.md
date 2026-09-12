# 验证报告：add-ssh-foundation

> ⚠️ 本报告由框架于 2026-09-10T12:16:56Z 自动合成（裁决 Agent 未写报告，已由框架合成），内容为结构化验证产物（report.json / .fenix-run-result.json）的忠实渲染。

## 结论：✅ 通过（verified）

**状态：verified — 16/17 场景通过，0 失败，0 错误（全部场景通过）**

17 个场景全部执行，16 通过、1 warning（web-placeholder-render）。该场景全部 4 条功能断言通过，唯一非 PASS 项为首轮视觉基线健全性判定 baseline_rejected：截图 low_contrast（pixel_std=0.046、主色占比 0.995）属环境性空白伪画面，引擎按设计拒绝固化基线，后续轮次截图干净时正常建立——分类 env，不阻塞。SSH 集成（docker 容器连接/命令/SFTP）、schema/config/ws/server 单测、API 与 WS-live 场景全部通过，未发现产品缺陷。

| 指标 | 数量 |
| --- | --- |
| 通过 | 16 |
| 失败 | 0 |
| 错误 | 0 |
| 产品 Bug | 0 |
| 本链增量 Token（输入） | 5.16M |
| 本链增量 Token（输出） | 0.09M |


## 场景结果

| 场景 | 描述 | 状态 | 失败断言 | 分类 |
| --- | --- | --- | --- | --- |
| cli-server-start | 启动被测 server 实例（127.0.0.1:3773）作为 API/Web/WS-live 场景的自建夹具：先按端口清理残留进程，再 detached 后台启动，轮询 /health 就绪。路径出处：dist/server/index.js（main）、server/index.ts:128-165 | pass | 0/2 | - |
| cli-build-typecheck | TypeScript workspace 构建和类型检查通过，验证 shared-contracts 类型可被两端编译引用。路径出处：package.json scripts（build/typecheck）、tsconfig.server.json | pass | 0/4 | - |
| cli-schema-unit-tests | 运行 shared/schema.test.ts 单元测试，覆盖合法清单、重复id、未知依赖、空命令四个场景全部通过。路径出处：shared/schema.test.ts | pass | 0/2 | - |
| cli-schema-direct-validation | 直接调用 parseTaskManifest 编译产物验证四个校验场景：合法清单+默认值填充、重复id报错、未知依赖报错、空命令数组报错。路径出处：shared/schema.ts:56-89（taskManifestSchema 校验逻辑） | pass | 0/2 | - |
| cli-config-unit-tests | 运行 server/config.test.ts 单元测试，覆盖默认空配置、保存读回一致性、密码脱敏、损坏文件容错。路径出处：server/config.test.ts | pass | 0/2 | - |
| cli-config-live-rw | 直接调用 AppConfigManager 编译产物，在临时目录执行配置读写：首次加载默认空配置、保存后读回一致、rememberPassword=false时密码不持久化、损坏文件回退默认值。路径出处：server/config.ts:63-134（AppConfigManager） | pass | 0/2 | - |
| cli-ws-unit-tests | 运行 server/ws.test.ts 单元测试，覆盖消息按类型分发、未知类型容错、非法JSON不崩溃、handler异常不崩溃。路径出处：server/ws.test.ts | pass | 0/2 | - |
| cli-server-entry-unit | 运行 server/index.test.ts 单元测试，覆盖默认启动健康检查200、非回环地址拒绝、静态目录存在时托管文件、静态目录缺失返回占位页、未知路由404。路径出处：server/index.test.ts | pass | 0/2 | - |
| cli-reject-non-loopback | 直接调用 buildServer({host:'0.0.0.0'}) 验证抛出明确错误拒绝非回环监听。路径出处：server/index.ts:57-59（host 校验） | pass | 0/2 | - |
| cli-static-host-file | 创建临时静态目录含 index.html，调用 buildServer({staticDir}) 后请求 / 返回文件内容，验证静态托管功能。路径出处：server/index.ts:64-76（静态文件托管逻辑） | pass | 0/3 | - |
| cli-graceful-shutdown | 启动服务进程后发送 SIGTERM，验证进程优雅退出（exit code 0）。路径出处：server/index.ts:150-160（SIGTERM handler） | pass | 0/2 | - |
| cli-ssh-integration | 启动 Docker SSH 测试容器，等待 SSH 就绪，运行连接/命令执行/SFTP 三个集成测试文件，验证 ssh-core 全部场景：密码认证成功/失败、不可达、断连事件、命令流式输出、退出码、SFTP上传、关闭后报错。路径出处：docker-compose.test.yml、server/ssh/connection.test.ts、server/ssh/executor.test.ts、server/ssh/sftp.test.ts | pass | 0/2 | - |
| api-health-endpoint | GET /health 返回 200 且响应体含 {"ok": true}。路径出处：server/index.ts:82 | pass | 0/2 | - |
| api-root-placeholder | GET / 返回 200 且响应体含占位页面内容「Fenix Server」，验证静态目录缺失时不阻塞启动。路径出处：server/index.ts:78 | pass | 0/3 | - |
| api-unknown-route-404 | GET /nonexistent 返回 404，验证未知路由处理。路径出处：server/index.ts（Fastify 默认 404） | pass | 0/1 | - |
| web-placeholder-render | 浏览器导航到根路径，验证占位页面正确渲染（h1 可见、标题文本匹配）。路径出处：server/index.ts:78（占位页）、server/index.ts:171-176（placeholderPage 函数） | warning | 0/4 | env |
| cli-ws-live-routing | 连接真实运行实例的 /ws 端点，发送未知消息类型验证错误回复、发送非法JSON验证错误回复且连接保持不崩溃。路径出处：server/ws.ts:49-61（MessageRouter.dispatch）、server/index.ts:86（registerWsPlugin） | pass | 0/3 | - |


## 断言级豁免清单

以下失败断言被归类为非产品缺陷（不记产品 Bug），逐条列出供人工复核豁免是否掩盖真实缺陷（场景级一句话归因不足以复核）。

| 场景 | 断言 | 归类 | 豁免理由 | 证据 |
| --- | --- | --- | --- | --- |
| web-placeholder-render | visual_baseline [web_placeholder_render_baseline] 基线健全性判定 | env | 环境因素（非产品缺陷） | 报告 note 明确声明：首轮截图 low_contrast（空白环境伪画面），引擎按设计拒绝固化基线，后续轮次截图干净时正常建立；场景 4 条功能断言（h1可见/文本匹配/含add-web-ui/无console错误）全部通过，产品渲染正常 |

## 本轮场景集变更

当前稳定场景集共 10 个（第 1 轮）。

- 首轮写入 10 个场景

