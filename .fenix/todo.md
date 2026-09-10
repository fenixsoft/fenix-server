## 2026-09-10

- 自上次自省以来无 SPEC 活动，跳过自省。


## 2026-09-11

### 浪费
- **归因查重拒绝致 judge 整轮废弃**
  - 影响：add-web-ui 的 planner-judge 在 16:39 单轮消耗 10.06M input tokens（$11.16），产出因 5 个场景归因逐字相同被整体拒绝废弃；此前 15:53 一轮 23 场景归因重复（1.78M/$3.41）同样被拒，两次重合成共烧约 $14.6 无交付。
  - 证据：fenixd.log 15:53:16 与 16:39:41 两条「批量归因查重拒绝落盘」ERROR；.fenix/verify-progress/add-web-ui/tokens.json 显示 planner-judge 三笔 in=1.41M/1.78M/10.06M（$2.90/$3.41/$11.16），16:39 笔最大且被拒。重复文本均为硬编码归因（cls=env / cls=test-defect + 同一段 ffs）。
  - 调查评估：已核实：三条 judge 记录与两条拒绝日志时间戳一一对应（15:53 拒绝后重跑、16:39 拒绝后保持 testing）。根因是 planner-judge 在多场景同因失败时套用同一归因模板，框架查重门拦截正确但整轮产出被整体废弃、须全量重跑。归属：一次性行为失误，但属于系统性「单轮大输出不可增量复用」的缺口。与存量工作无重复（批量归因查重已上线并正常工作，本次是它拦住的代价）。残余缺口：拒绝后重跑仍可能再产出模板化归因，单轮 $11 级成本无兜底。结论：值得立项优化 judge 输出粒度，避免整轮废弃。
  - 建议：要求 planner-judge 按场景增量写入归因（每场景独立落盘/checkpoint），查重拒绝时只废弃重复子集而非整轮；或在 judge 提示中显式禁止复用归因文本、强制引用各自断言片段。

- **proxy-tunnel 三分支三复跑重复**
  - 影响：单 SPEC 产生 3 个 implementer 分支（1789039015/1789044553/1789046793）与至少 3 轮验证复跑（19:55/20:53/21:29 各写入 run-result），实现预算 used=3，累计 $19.80、17.03M input tokens；期间 2 次 resolve merge conflicts（a972c02/a503c2e）与 4 次「orphan ready re-trigger」（09:29-10:59 每小时一次）。
  - 证据：git log 三枚 merge commit（286e696 19:58/c32d087 20:53/c288985 21:29）+ 两枚 resolve merge conflicts；.fenix/STATE.md add-proxy-tunnel _impl_run_budget_used=3、_tokens_in=17029138、_cost_usd=19.80；fenixd.log 09:29/09:59/10:29/10:59 四条 Recovery re-triggering implement for orphan ready。
  - 调查评估：已核实：三个分支均有对应 run 文件与 merge 记录，验证复跑 3 次（最终 7/10 pass、3 env 归因后放行）。根因：部分为验证环境因素（docker 容器名冲突级联导致 env 失败→复跑）、部分为 merge conflict 走 repair 通道后重派。归属：系统性偏重——一次 SPEC 验证 3 轮、实现 3 次属于轮次控制偏弱。与存量关系：与 add-task-engine/add-ssh-foundation（均 1 轮通过）形成对比，非共性问题但成本 $19.80 明显偏高。结论：值得给验证复跑/重派次数加阈值与告警。
  - 建议：为单 SPEC 增加验证复跑轮次上限（如 ≥3 轮自动挂起并升级人工归因），并在 verify 复跑前强制清理环境残留（docker/端口/进程），消除 env 类复跑。

- **implementer 轮次上限整轮空转零产出**
  - 影响：add-ssh-foundation 首次实现（09:53）与 add-builtin-tasks-e2e 首次实现（18:03）均因 claude CLI 达到 400 轮上限失败，整轮 token 计 0、无任何提交产出，仅空耗 run 时长与上下文；ssh 靠 a2 重跑补救、builtin 靠 attempt 2 resume 续跑。
  - 证据：fenixd.log 09:53:10 「implementer for 'add-ssh-foundation' ended in error — tokens counted as 0: claude CLI Max turns (400) reached」；18:03:46 同因 add-builtin-tasks-e2e attempt 1 失败。两 run 文件均在 .fenix/runs/。
  - 调查评估：已核实：两条 Max turns 400 日志与对应 run 文件一致。根因：任务规模与单 run 400 轮上限不匹配，实现器未在上限前收敛提交，导致整轮归零。归属：系统性缺口——implementer 缺少「临近轮次上限自动提交已完成部分」的收敛策略。与存量关系：无既有修复；这是本轮新出现但可复现的模式（两 SPEC 命中）。结论：值得立项为 implementer 收尾策略改进。
  - 建议：为 implementer 注入轮次预算感知：接近 400 轮上限（如 ≥350）时提示先提交已完成部分并明确 stop，避免整轮空转；或将大 SPEC 拆分为可增量合并的更小实现单元。

### 失误
- **验证契约入口指向不存在文件致全场景拒连**
  - 影响：add-web-ui 验证契约 serve.cmd 指向不存在的 dist/server.js（实际入口 dist/server/index.js）且 prepare 未构建 web UI，15:04 与 16:01 两轮验证 32 个 web 场景全部 ERR_CONNECTION_REFUSED、验证阻塞超 1 小时，连带触发 admin 处置与 token 烧至 47.6M/50M（95%）。
  - 证据：fenixd.log 15:04:16 「验证门禁: 'add-web-ui' 应用不可达」+ report 32 场景全 ERR_CONNECTION_REFUSED；admin 4497ffc（23:14）修正 serve.cmd/prepare 并新增 .fenix/verify.yaml；.fenix/verify-progress/add-web-ui/report.json 16:03 报告 8 pass/24 fail（其中 20 env 为跨 SPEC 后端未就绪）。
  - 调查评估：已核实：4497ffc 提交信息原文「serve.cmd: node dist/server.js -> FENIX_PORT={port} node dist/server/index.js（原命令指向不存在的入口文件，server 从未启动）」，且 prepare 增补 web build。根因是验证契约/config commands.start 的入口路径与真实构建产物不符，属配置失误。归属：一次性失误，但暴露「契约生效前无入口存在性校验」的系统缺口（与 ssh 的 node_modules 缺失同类）。与存量工作：与 improvement 条目「验证前置依赖与入口自检」互补。结论：本次已由 admin 修正，复发敞口靠 I 类改进关闭。
  - 建议：verify 契约加载/serving 前增加入口文件存在性与端口可达性自检（serve 启动后先探活再跑场景），契约错误在 1 次探活内暴露而非烧完整轮 32 场景。

- **主树无依赖致验证 prepare 失败**
  - 影响：add-ssh-foundation 验证 prepare 步骤 `npm run build` 因主树从未安装 node_modules 报 `tsc: not found`（exit 127），验证环境阻塞第 1 轮、需 admin 手动 `npm ci`（154 packages）后重验，浪费 1 轮验证与 1 次 admin 处置。
  - 证据：fenixd.log 11:16:54 「验证契约 prepare 失败: 第 1 步退出码 127: npm run build / sh: 1: tsc: not found」；admin_alerts.json 处置记录「主树无 node_modules（.gitignore 排除，从未安装）→ npm ci --no-audit --no-fund（154 packages）→ 自证 prepare/serve/ready 通过」。
  - 调查评估：已核实：错误日志与 admin 处置动作吻合，主树 .gitignore 排除 node_modules 且从未安装。根因：验证在主树（verify.static_scope=main）执行 prepare，但依赖安装未纳入契约或自动流程。归属：系统性环境缺口，非单点失误——add-web-ui 的 web 构建同样依赖 web/node_modules（admin 4497ffc 补充 prepare 前也隐含此问题）。结论：应把依赖安装做成验证契约的标准化前置步骤。
  - 建议：verify contract prepare 支持并默认前置依赖安装（如 npm ci --prefer-offline 或按 lockfile 安装），或在验证前自动检测主树缺依赖并预装，杜绝 tsc not found 类环境阻塞。

- **实现器零变更误报成功致重派**
  - 影响：impl-add-web-ui-1789053420-a1 零变更报成功，触发零变更成功哨（15:22，第 1 次）回退 ready 并重派实现（attempt 3/4），浪费一次完整 implementer run 与一次重派轮次，并让预算逼近上限（此后 15:31 used=3→4 对账校正）。
  - 证据：fenixd.log 15:22:07 ERROR「零变更成功哨触发 'add-web-ui'（第 1 次）— run=impl-add-web-ui-1789053420-a1」；同刻 STATE 更新 error=「实现器零变更报成功（疑似输出截断/空转）— 不合并不推进，重派实现」。
  - 调查评估：已核实：哨兵触发日志与 STATE 更新一致。根因是 implementer 在无任何 diff 时仍输出成功结果（疑似上下文截断或空转后乐观收尾），框架哨兵正确拦截。归属：一次性行为失误，哨兵防住了主线污染，但浪费了实现预算。与存量关系：无既有修复；与 waste 条目「Max turns 空转」同属 implementer 收尾质量问题，可合并治理。结论：哨兵有效，根因在实现器成功判定的严谨性。
  - 建议：在 implementer 成功收尾前强制 diff 自检（无变更须显式声明原因），并给零变更哨添加软提示（如第 1 次即向 agent 回传「产出为空」证据），减少静默重派。

- **admin 处置超时被孤儿检测升级人工**
  - 影响：admin-add-web-ui-1789052656 自 15:04 处置至 16:04 无终态（>60min），被 AdminMonitor 孤儿检测升级为人工 critical 告警，处置悬空约 1 小时；16:12 才完成并 closed 1 条 stale escalation，期间 add-web-ui 验证阻塞无人推动。
  - 证据：admin_alerts.json id=3ec0febb0716（16:04:48 critical「Administrator 处置中断…疑似 daemon 重启/崩溃连带杀死 admin，需人工介入」）；fenixd.log 16:12:09「Administrator 处置完成（SPEC add-web-ui）」+「Closed 1 stale escalation(s)…final result=resolved」。config.yaml admin.escalation_cooldown_minutes=60、shutdown_drain_seconds=0。
  - 调查评估：已核实：escalation 与 16:12 完成记录同 run。根因是 admin 单次处置真实耗时超过 60min 孤儿阈值，且 daemon 重启（15:26 曾现 Exit 143 信号）会因 shutdown_drain_seconds=0 直接连杀运行中的 admin。归属：系统性——admin 长任务无心跳续期机制，孤儿判定无法区分「慢处理」与「真孤儿」。结论：需把 admin 处置改为可续期/可恢复的异步任务。
  - 建议：给 admin 处置增加运行中心跳续期（如每 15min 更新 heartbeat 并持久化进度 checkpoint），孤儿判定依据「超时且无心跳」而非单纯超时；同时将 daemon shutdown 改为先排空在跑 admin（drain_seconds>0）或支持重启后续跑。

### 可改进
- **验证前依赖安装与 serve 入口自检前置**
  - 影响：复发敞口：每次新 SPEC 验证若契约/依赖配置有误，先烧完整轮场景（本次 add-web-ui 32 场景全 ERR_CONNECTION_REFUSED + add-ssh-foundation prepare exit 127）才发现，单次代价约 1 轮验证（32 场景）+ 1 次 admin 处置 + 复跑轮，实测 add-web-ui 由此多烧约 $20+。
  - 证据：本次窗口两个 SPEC 连续踩中同类环境阻塞：add-ssh-foundation 11:16 tsc not found、add-web-ui 15:04 应用不可达（admin 4497ffc 修正入口 + web build）；admin 处置中「自证 prepare→serve→ready」三步探活即为手工版前置自检，且事后全部通过。
  - 调查评估：已核实：两起阻塞的 admin 处置都做了「入口存在/依赖就绪/端口可达」手工会话式自检，说明该检查可被自动化前置。根因是验证管线把「契约错误」推迟到跑完整轮场景才暴露。归属：系统性缺口，本次已由 admin 逐个修复但未制度化。与存量工作：无重复（verify_contract 已有契约能力，缺的是前置校验门）。结论：足以支撑独立 SPEC。
  - 建议：在验证执行前增加 3 项快速门：prepare 依赖就绪（自动 npm ci 兜底）、serve 入口文件存在、serve 启动后 ready 探活；三项任一失败即快速失败并自动呼叫 admin，不再执行 32 场景全量验证。

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
