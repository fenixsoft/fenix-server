## 2026-09-10

- **admin 处置超时被孤儿检测升级人工**
  - 影响：admin-add-web-ui-1789052656 自 15:04 处置至 16:04 无终态（>60min），被 AdminMonitor 孤儿检测升级为人工 critical 告警，处置悬空约 1 小时；16:12 才完成并 closed 1 条 stale escalation，期间 add-web-ui 验证阻塞无人推动。
  - 证据：admin_alerts.json id=3ec0febb0716（16:04:48 critical「Administrator 处置中断…疑似 daemon 重启/崩溃连带杀死 admin，需人工介入」）；fenixd.log 16:12:09「Administrator 处置完成（SPEC add-web-ui）」+「Closed 1 stale escalation(s)…final result=resolved」。config.yaml admin.escalation_cooldown_minutes=60、shutdown_drain_seconds=0。
  - 调查评估：已核实：escalation 与 16:12 完成记录同 run。根因是 admin 单次处置真实耗时超过 60min 孤儿阈值，且 daemon 重启（15:26 曾现 Exit 143 信号）会因 shutdown_drain_seconds=0 直接连杀运行中的 admin。归属：系统性——admin 长任务无心跳续期机制，孤儿判定无法区分「慢处理」与「真孤儿」。结论：需把 admin 处置改为可续期/可恢复的异步任务。
  - 建议：给 admin 处置增加运行中心跳续期（如每 15min 更新 heartbeat 并持久化进度 checkpoint），孤儿判定依据「超时且无心跳」而非单纯超时；同时将 daemon shutdown 改为先排空在跑 admin（drain_seconds>0）或支持重启后续跑。

### 可改进
- **implementer 临近轮次上限应收敛提交**
  - 影响：复发敞口：单 run 400 轮上限内若无收敛策略，整轮实现将计 0 产出空耗（本次 add-ssh-foundation 09:53、add-builtin-tasks-e2e 18:03 两轮命中），每轮代价为一次完整 implementer run 的时长与上下文，事后仍需 a2/attempt2 重跑。
  - 证据：fenixd.log 09:53:10 与 18:03:46 两条 Max turns (400) 记录、tokens counted as 0；对应 .fenix/runs/impl-add-ssh-foundation-1789030937-a1.jsonl、impl-add-builtin-tasks-e2e-1789058381-a1.jsonl 均为整轮无收尾。
  - 调查评估：已核实：两 SPEC 首轮实现均在上限处失败且无提交。根因是 implementer 未感知轮次预算、未在上限前做 checkpoint 提交。归属：系统性缺口，跨实现器通用。与存量：与零变更误报同属 implementer 收尾治理，但收敛提交是更前置的预防。结论：可合并为一个「implementer 收尾策略」SPEC。
  - 建议：向 implementer 注入轮次预算上下文（总上限/已用/剩余），并设定「剩余 ≤15% 时自动执行 git add+commit 已完成任务」的收敛规则；若接近上限仍未完成，输出已完成部分与剩余清单让重派 resume。

- **judge 归因增量落盘防整轮废弃**
  - 影响：复发敞口：judge 单轮产出被整体拒绝时整轮 token 废弃（本次 16:39 单轮 10.06M/$11.16），且重跑仍有再产出模板化归因的风险；若改增量落盘，单次拒绝的浪费可从整轮降为仅重复子集（约 5/23 场景）。
  - 证据：fenixd.log 15:53:16（23 场景拒绝）与 16:39:41（5 场景拒绝）；tokens.json planner-judge 16:39 笔 in=10058104、cost=$11.16 为最大单笔且被整体拒绝，整轮无交付。
  - 调查评估：已核实：拒绝日志与 tokens.json 对应。根因：judge 一次性输出全部归因，查重门只能整批判定「通过/废弃」，无法部分复用。归属：系统性——查重防御已生效，但错误成本回收无机制。与存量：批量归因查重为本窗口新增能力（已工作），本条目是对其成本侧的补强。结论：支撑独立小 SPEC。
  - 建议：planner-judge 改为逐场景增量写盘（每场景归因独立文件/条目），查重拒绝时仅回炉重复子集；或降低单轮 judge 输出规模、分批多次小输出，避免 10M 级单轮大产出被整体废弃。


## 2026-09-12

### 浪费
- **add-web-ui 验证空转 16M**
  - 影响：窗口内 add-web-ui 一个 spec 累计 11 次 planner-judge（含 3 次 r1 重跑）+ 2 次 verify run + 4 次 admin 处置 run 互相踩踏；其 _tokens_in 从 79.75M 增至 95.72M（+15.97M）、_cost_usd 从 $91.5 增至 $116.1（+$24.6），而最终确认验证早已通过（28 pass + 4 env error = 0 product bug），多轮 run 均为验证基础设施误判买单。
  - 证据：窗口内 run 文件：planner-judge-add-web-ui-1789068699(-r1)/1789109053/1789110264/1789111666(-r1)/1789114582/1789115490/1789125244/1789126176/1789127043 共 11 个 + verify-add-web-ui-1789101823/1789116406；STATE.md 增量时间线 08:29 _tokens_in=79754005/$91.5 → 11:56 95723690/$116.1；fenixd.log 05:46:39 预算耗尽（4/4）冻结、05:49:31 升级闸门第 3 轮冻结。
  - 调查评估：已核实：11+2+4 个 run 文件均在窗口内，STATE.md 成本增量与 fenixd.log 冻结时间戳互相印证。根因链：planner 端口臆测致应用不可达→多次自动启动；08:46 worktree 冲突致 planner-judge 降级 legacy；legacy 读主树共享文件（implementer 残留 status=success）误判 unknown-status→blocked；期间叠加预算耗尽+升级闸门双冻结，验证实际已通过却反复空转。归属：系统性验证基础设施缺陷，非单次失误。结论：属「验证基础设施可靠性」域，值得 SPEC 立项限定。
  - 建议：report.json final_verdict=verified 后应一次性放行，不允许 legacy/planner 各自独立误判；对同一 spec 的 judge 重跑设上限（如 verdict 连续稳定即复用上次结果），避免 16M token 级空转；修复 IS-1 的读取路径后重验本次成本基线。

- **blocked 信号 9 小时刷屏 40 余条**
  - 影响：add-web-ui 自 09-10 19:48 置 blocked 后，00:04~03:24+ 每 5 分钟产生一条 blocked_stuck 节流信号（约 40+ 条，占窗口 95 条信号绝大多数），blocked 悬置约 9.5 小时才首次实质处置，监控信噪比被严重拉低且期间无推进。
  - 证据：fenixd.log 00:04:28~03:24:31 连续「Signal throttled: blocked_stuck for 'add-web-ui' (cooldown 60m)」（evidence updated=2026-09-10T19:48:02）；fenixd.log 05:25:18 才有首个验证 rerun（admin run 1789068272/1789073418 分别在 03:35/04:54 干预，仍未解除 blocked）。
  - 调查评估：已核实：信号时间序列连续、同一 spec 同一类型；admin_alerts 窗口 95 条信号与该系列吻合。根因：add-web-ui 09-10 验证环境阻塞处置后未真正解 blocked，admin_monitor 每分钟检查但 cooldown 60m 节流，产生持续刷屏、无实质处置推进，且早期 admin 干预（03:35/04:54）未能解除卡点。归属：监控语义问题+验证链阻塞叠加。结论：与 09-10 自省「admin 处置超时被孤儿检测升级人工」同 spec 延续，本条聚焦信号机制本身。
  - 建议：admin_monitor 对同一 spec 同类型信号在状态未变时改为「状态沉淀」单条记录（只记首次+最近一次时间戳），不逐轮刷日志；blocked 悬置 ≥2h 时强制重复升级真人而非仅节流。

### 失误
- **legacy verifier 读共享文件误判**
  - 影响：09:06:49 pm_engine 因 legacy verifier 读到主树共享 .fenix/.fenix-run-result.json（implementer 残留 status=success，白名单外 status='success'）将已通过验证的 add-web-ui 判为 blocked，验证链再次冻结，直到 11:56 admin 修改 verification.py:2647 才打通，累计浪费约 3 小时与多轮 run。
  - 证据：fenixd.log 09:06:49.167Z「Verifier (legacy) 结果文件 status 白名单外（reason=unknown-status）：status='success'」，state_machine 同刻置 blocked（tester_run=verify-add-web-ui-1789116406-a1）；admin_alerts 处置记录 1789122581 诊断：「与 _read_planner_result 曾修复的同类问题完全一致——legacy 路径未同步修正」（verification.py 2647 行读取位置错误）。
  - 调查评估：已核实：state_machine 更新记录与 admin 处置诊断互相印证，且 verification.py 磁盘当前版本已含修复注释（D5 fix-verdict-read-failclosed legacy 同门）但运行中 daemon 未加载（见 mistakes 第 2 条）。根因：legacy 路径 _run_legacy_verification 读主树共享文件而非 verify-progress/<spec>/.fenix-run-result.json，且 _verifier_result_is_stale 因 mtime 晚于 run_start 判定不 stale。归属：系统性——同一缺陷 planner 路径修复、legacy 路径漏修。结论：与 improvements 第 1 条互补，本条为即时修复动作。
  - 建议：将 legacy verifier 结果读取改为与 planner 同源（verify-progress/<spec>/.fenix-run-result.json 优先，回退主树共享前先做 spec 戳 + mtime 双校验）；补回归测试模拟「implementer 残留 status=success 污染」场景；重启 daemon 使已写盘修复生效。

- **daemon 未托管 supervisor 重启**
  - 影响：16:08 UTC 写入 restart_request（为加载 verification.py:2647 修复），但 fenix-server daemon（PID 3684441，09-10 16:29 启动至今未重启）不在 supervisor 托管下——系统内唯一运行中的 supervisor（PID 3325244）cwd=/root/fenixd 属另一项目；restart_failed 升级（id=1140cf0d9613，16:22:28 UTC）至今未处理，验证基础设施修复未能加载生效。
  - 证据：/proc/3684441/cwd=/root/fenix-server、ppid=3684439(zsh) 直接拉起，无 supervisor 父链；/proc/3325244/cwd=/root/fenixd 属另一项目；.fenix/restart_request 文件仍存在且 mtime=2026-09-12 00:08:24（本地），未被消费；admin_alerts escalation id=1140cf0d9613 handled=false，recommended_action「人工检查 supervisor 是否在运行」。
  - 调查评估：已核实：daemon 进程链（zsh→fenixd.py）无 supervisor，restart_request 文件保留未消费，escalation 未处理。根因：fenix-server 的 daemon 由 fenixd.py 直接拉起（未用 .fenix/bin/fenixd_supervisor.py 托管），restart_request 无人消费；AdminMonitor 检测 10 分钟未重启后升级为人工但无后续动作。归属：部署配置失误 + 监控盲区。结论：一次性失误，但复发敞口是「任何进程内代码修复都无法热加载」。
  - 建议：用 .fenix/bin/fenixd_supervisor.py 托管 fenix-server daemon（或 kill+重启闭环本次 restart_request）；AdminMonitor 升级 restart_failed 时先核查 supervisor 进程是否存在并给出明确提示；或让 daemon 检测 restart_request 超时未消费时自动自杀由外层拉起。

- **worktree 冲突降级 legacy 误判**
  - 影响：08:46:41「Worktree already active for add-web-ui:planner-judge」→ Failed to create worktree → dual-dispatch 放弃重试 → 08:46:46 降级到旧版 verifier → 09:06 legacy 读错文件误判 blocked；本可走已修复的新验证流程却因 worktree 未释放被推到有缺陷的 legacy 路径。
  - 证据：fenixd.log 08:46:41.887Z ERROR「Failed to create worktree」+ 08:46:46.891Z「Planner judge 失败: Failed to create worktree (gave up: parallel run or manual freeze)，降级到旧版 verifier」；08:31:30 planner-judge 1789115490 创建 branch fenix/add-web-ui-1789115490 的 worktree 后未释放。
  - 调查评估：已核实：08:31 创建 worktree、08:46 新 run（1789116401）报「already active」，随后立即降级。根因：前一 planner-judge 的 worktree 未清理/锁未释放，新 run 创建失败后直接降级而非先清理重试。归属：系统性——worktree 生命周期管理缺口（推测前一轮 run 异常退出残留）。结论：与 mistakes 第 1 条同误判链的触发点，先修 worktree 释放可避免进入 legacy 缺陷路径。
  - 建议：worktree 创建失败时先查锁归属（可安全清理的残留则清理后重试一次），禁止无诊断直接降级；记录 worktree 活跃 run 的 pid/转录便于追溯残留；降级动作本身打 WARNING 级日志并附原因字段。

### 可改进
- **验证结果文件读取路径统一**
  - 影响：复发敞口：主树共享 .fenix/.fenix-run-result.json 被 implementer 成功残留 status 污染，任何路径误读都会把已验证 spec 打成 blocked，本次 add-web-ui 单次代价 ≈ +$24.6 + 3h 悬置 + 4 次 admin 处置（实测）。
  - 证据：admin 处置 1789122581「系统性观察：主树共享文件作为多 agent 共享通道存在 implementer 残留污染的结构性风险，建议用 spec 戳 + 时间戳双重校验或将 legacy 完全迁移到 verify-progress 目录」；本次 legacy verifier 直接因读该文件误判（mistakes 第 1 条）。
  - 调查评估：已核实：同一缺陷第二次复发（_read_planner_result 曾修复、legacy 漏修），共享文件承载 implementer/verifier 两种写入者的异义语义。根因：多 agent 共享通道 + 读取路径不统一，修复只覆盖单路径。归属：系统性架构缺口。与存量：含 mistakes 第 1 条即时修复，本条为彻底版（迁移+双校验+回归测试）。结论：足以支撑独立 SPEC。
  - 建议：起草 SPEC：verifier 结果一律读 verify-progress/<spec>/.fenix-run-result.json；主树共享文件仅作兼容回退且须 spec 戳 + mtime 双校；补「implementer 残留 success」污染回归测试；修复后重验 add-web-ui 基线成本。

- **基础设施故障不计入预算与升级闸门**
  - 影响：复发敞口：env 误判/worktree 冲突/读错文件等基础设施类失败被计入实现预算（本次 add-web-ui 4/4 预算耗尽冻结）与升级闸门（连续第 3 轮冻结），导致真实缺陷修复被打断、被推入人工裁决；单次代价 ≈ 一轮完整修复 run 被打断 + 约 1h 冻结（本次实测 05:46~06:45）。
  - 证据：fenixd.log 05:46:39「实现尝试预算耗尽 used=4/4 冻结为 blocked」；05:49:31「升级闸门连续失败第 3 轮冻结为 blocked」；06:45 admin 处置 1789104318 修正 report.json env→product-bug 分类后放行（impl_run_budget_override=5 解锁）。
  - 调查评估：已核实：两道冻结均源于同一次误判链（report.json 陈旧 env 分类 + 端口臆测 + worktree 冲突），非真实实现质量失败。根因：pm_engine 预算/闸门计数未区分「基础设施失败」与「产品缺陷失败」。归属：系统性。与存量：无现有 SPEC 覆盖费控语义分层。结论：小 SPEC 可落地，将费控语义与基础设施故障解耦。
  - 建议：在预算/闸门计数中识别基础设施类失败（env 不可达、worktree 冲突、结果文件读取异常、legacy 读错文件）单独计数、不消耗实现预算，并自动重排验证而非冻结升级；无谓的闸门轮次在归因修正后应回拨。

- **planner 端口臆测致验证反复启动**
  - 影响：复发敞口：planner 在场景 URL 中臆测端口，与实际服务端口不符，触发「验证目标应用不可达→自动启动服务→改写场景端口」链路，单 spec 窗口内至少 3 次明文端口改写（04:43、06:42）与多次自动启动（03:46/04:43/06:42/11:08/15:16/16:06），每次多耗一轮验证环境初始化。
  - 证据：fenixd.log 04:43:43「场景 URL 端口 ['46891'] 与应用实际端口 56173 不符（planner 臆测），已改写场景端口并确认可达」；06:42:32「场景 URL 端口 ['56173'] 与应用实际端口 32841 不符（planner 臆测）」；03:46:39/11:08:10/15:16:13 多次「验证目标应用不可达，自动启动服务」。
  - 调查评估：已核实：端口改写与自动启动日志多时点出现，均指向同一链路。根因：planner 规划阶段未读取/未对齐验证契约声明的实际端口（FENIX_PORT / serve 命令端口），凭臆测生成场景 URL。归属：系统性——planner 规划与验证环境契约脱节。与存量：无现有 SPEC 覆盖端口契约对齐。结论：可作为 planner 效率改进小项。
  - 建议：验证契约中让 planner 从 serve.cmd/实际启动端口读取端口而非臆测；pm_engine 在改写端口时向 planner 上下文回写「实际端口=xxx」，后续场景直接复用；对同一 spec 端口臆测 ≥2 次时打 WARNING 并提示契约缺陷。
