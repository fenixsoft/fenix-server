# Tasks: add-builtin-tasks-e2e

## Deliverables

```yaml
- path: assets/tasks.yaml
  kind: new
- path: assets/zsh_settings/.zshrc
  kind: new
- path: assets/zsh_settings/install_ohmyzsh.sh
  kind: new
- path: assets/claude_settings/.claude.json
  kind: new
- path: assets/claude_settings/settings.json
  kind: new
- path: assets/clash/config.yaml
  kind: new
- path: assets/fenixserver_key.pub
  kind: new
- path: assets/install-claude-code.sh
  kind: new
- path: tests/e2e/Dockerfile.sshd
  kind: new
- path: tests/e2e/Dockerfile.systemd
  kind: new
- path: tests/e2e/docker-compose.e2e.yml
  kind: new
- path: tests/e2e/mock-proxy.mjs
  kind: new
- path: tests/e2e/e2e.test.ts
  kind: new
- path: docs/acceptance.md
  kind: new
```

## 1. 内置清单与资源

- [ ] 1.1 编写 `assets/tasks.yaml`：逐节转换 task.md（约 15 任务、依赖图、needs_proxy 标注、verify、claude_hint；install-claude-code 无前置排最前），schema 校验通过
- [ ] 1.2 迁移资源文件到 `assets/`（从用户现有 /root/server-init/ 拷贝；clash/config.yaml 待用户提供，暂以占位+文档注明）
- [ ] 1.3 清单-资源交叉校验（files 无悬空引用）与 task.md 对照评审（无遗漏小节）

## 2. ubuntu 24.04 容器验证设施

- [ ] 2.1 编写 `tests/e2e/Dockerfile.sshd`：ubuntu:24.04 + openssh-server（root 密码登录、前台 sshd、随机密码注入），供前序 SPEC 集成测试统一使用
- [ ] 2.2 编写 `tests/e2e/Dockerfile.systemd` + `docker-compose.e2e.yml`：ubuntu:24.04 特权容器（systemd PID1、cgroup 挂载、systemctl 启用 ssh、映射 SSH 端口）
- [ ] 2.3 编写 `tests/e2e/mock-proxy.mjs`：HTTP 代理桩（转发 + 请求记录 + 查询接口）

## 3. 端到端验证

- [ ] 3.1 编写 `tests/e2e/e2e.test.ts`：起 E2E 容器 → 工具连接 → 全量清单串行执行（代理桩模式 + mock claude）→ 逐任务 success 断言 + verify + 产物抽查（.zshrc/authorized_keys/sshd 配置/apt 源）
- [ ] 3.2 失败快照：失败任务日志 + 容器内状态收集到 tests/e2e/out/；代理桩记录断言（needs_proxy 请求经隧道）
- [ ] 3.3 编写 `docs/acceptance.md`：真实服务器手动验收步骤（含真实 claude 修复演练、订阅配置缺失说明、E2E_PROXY 真实代理模式说明）
