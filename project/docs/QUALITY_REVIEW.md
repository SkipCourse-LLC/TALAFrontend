# MVP 检查记录

## 2026-10-20：可切换 Firebase 架构与 Dylan 交付验证

本轮在 `yichen` 完成开发与定向复核；没有运行完整历史测试矩阵，也没有访问真实学生记录或修改云端环境。下面较早的 Emulator 阶段记录保留为历史，其“未 commit”和旧测试数不描述本轮最终本地提交。

| 检查 | 本轮结果 |
| --- | --- |
| TypeScript、全前端 ESLint | PASS，零警告 |
| 默认 build／仅 Git 暂存文件的独立 Emulator build | PASS；独立快照未包含留在本地的旧 product／sprint 测试和文件清单，证明运行源码不依赖它们 |
| 配置、认证边界、错误及 Evidence 合同 | 17/17 PASS |
| 服务端 runtime guard | 2/2 PASS |
| 真实 Emulator 工作流、权限、事务、文件和重试 | 11/11 PASS |
| 云边界／学习记录浏览器检查 | 3/3 PASS；仅本地请求，包含成果确认持久化和拒绝伪造家庭关联 |
| Firebase 浏览器流程 | 3/3 PASS；注册／验证限制、会话、预约、Evidence、手机／键盘与定向 Axe |
| Private-only 既有桌面流程 | 4/4 PASS；未重跑其余历史矩阵 |
| 未配置测试云启动 | 按预期拒绝；没有发起真实云端认证请求 |
| 运行依赖 npm audit | 前端与 Functions 均零已知 advisory；Firebase CLI 开发工具仍有 7 项上游 advisory，未用不兼容覆盖来掩盖 |

修复：云端 SDK 初始化／会话恢复前核对官方公开 Auth 项目配置，防止混入其他项目的 API key；角色与会话关键操作在服务端核验；过去时段不会占满可预约列表；预约结束释放锁但不确认出席；文件强制绑定 SHA-256，归档到无 Firebase bearer token 的 server-only 路径后删除 staging；确认成果与 Evidence 计数并发时保持一致。SDK 按需加载并单独拆分 Firestore，约 470 kB 的最大 Firebase chunk 已无旧 655 kB 警告。

真实云端仍未连接或部署，IAM、provider、MFA 与已部署 Rules 未验证。独立测试项目、服务部署与测试用户验证需要 Sponsor 授权。未完成 staging 文件可能保留 bearer token，自动清理、恶意文件扫描、App Check／限流、保留与删除、直接数据库读取的即时撤销策略仍需正式发布前完成。未实现真实 Zoom、出席确认、AI 评估、支付或家长工作区。已记录亲子同意不代表获批采集录音或医疗资料。当前版本适合 Dylan review 与合成数据本地演示，不是上线批准。

## 2026-10-20：Firebase Emulator 集成验证

本次在 `yichen` 重新运行定向验证，没有重跑旧全套测试，未 commit、push、merge 或 deploy。生产 SkipClass 没有改动。

| 检查 | 本次结果 |
| --- | --- |
| TypeScript、全前端 Lint | PASS |
| 默认 build 及最终 Firebase Emulator 模式 build | PASS；Firebase SDK chunk 约 655 kB minified，仍有体积提示，正式发布前需性能预算复核 |
| 核心配置／角色／错误安全单测 | 7/7 PASS |
| 后端运行边界、Rules、预约事务、文件与幂等检查 | 7/7 PASS，含 runtime guard 与工作流分组 |
| Emulator 浏览器流程 | 3/3 PASS；注册、验证限制、预约／改期／取消、Evidence、资料与刷新／重登、付款锁定、跨 UID 拒绝 |
| 手机、键盘及自动无障碍 | 320/390 px 无横向溢出；错误／状态焦点检查通过；定向 Axe 零违规，不等同完整无障碍认证 |
| 冷启动持久化 | 显式导出与自动退出导出两轮恢复后，Auth／profile／预约／Evidence bytes+metadata／提交计数一致；仅清理自建合成 fixture |
| 凭据扫描 | Gitleaks 当前 151 个非忽略文本文件、14 个本地 Git commits：未发现泄露；生成数据、node_modules、日志和报告不入 Git |
| 依赖审计 | 前端运行依赖与 Functions 全依赖零已知漏洞；CLI 工具仍有 7 个上游 advisory，见 backend README |

实际发现并修复：邮箱 reload 先改变 SDK 用户字段、签名 token 稍后刷新的竞态；现在只以新签名验证状态开放页面。活跃预约独立查询，不受 100 条历史分页限制影响；Storage 禁止覆盖已上传文件；gRPC 间接依赖锁定官方修补版 1.14.6（[官方安全公告](https://github.com/grpc/grpc-node/security/advisories/GHSA-f596-whhp-79r4)）。

限制：实际云端 IAM、启用 providers／MFA、Web App 配置与 deployed Rules 未完整取得；进一步原生 Chrome 读取被自动审批拒绝，原因是无法确认 Work 窗口，可能暴露无关个人标签页。未绕过。现有后端源码的权限问题不等于已验证的生产漏洞。真实 Zoom、出席、AI 评估、付款、未成年人同意／保留与正式测试项目仍未接入。此阶段可运行的结果是隔离本地 Firebase 集成，不能标记正式上线。

当前交接说明（2026-10-07）：下文保留各阶段的历史记录；其中 `staging`、旧文件路径、测试数量、依赖与未推送声明只适用于对应日期，不代表当前 `yichen` 交付状态。Dylan 的当前技术交接见 [INTEGRATION.md](INTEGRATION.md)，本轮 SCRUM-46–49 行为与实际验证证据见 [SPRINT_2.md](SPRINT_2.md)，现有路径以 [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) 为准。本次文档更新不新增或重跑测试结果。

此文保留第一阶段记录；最新四尺寸回归和视觉结果见 [Frontend Excellence Review](FRONTEND_EXCELLENCE.md)。

日期：2026-09-20。开发与检查均在 `staging`；没有提交、推送、合并或部署。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| `npm install` | PASS；锁文件已生成 |
| `npm run dev` | PASS；实际启动并通过浏览器查看 |
| `npm run build` | PASS；包含 TypeScript 检查 |
| `npm run lint` | PASS；零警告 |
| `npm run typecheck` | PASS |
| `npm test` | PASS；8 个场景 × 3 个浏览器配置，共 24 项 |
| `npm audit --omit=dev` | 当日查询未发现运行时依赖已知漏洞 |
| `.gitignore` 与已跟踪文件检查 | PASS；没有已跟踪的依赖、环境文件或构建产物 |
| 原有 `CNAME` 与 `main` 引用 | 未修改 |

浏览器配置：1440px 桌面 Chromium、Pixel 7 手机 Chromium、iPad 平板 WebKit。另在 320px 窄屏下检查长姓名/邮箱与主要页面溢出。使用 Chromium 实际截图检查公共页面、表单和 dashboard 的桌面/移动布局；临时截图放在仓库外，不纳入源码。

测试覆盖：公共页面导航、项目筛选、刷新/前进后退、404、注册必填/邮箱/密码匹配校验、演示注册成功、登录校验与服务失败恢复、dashboard 入口保护、四个 dashboard 视图、学习大纲/项目展开、加载/空/错误/重试、退出后回退、键盘菜单/退出/skip link、损坏或被禁用的 sessionStorage、减少动画。全部测试同时检查 browser console error 与运行时异常。

axe 使用 WCAG 2 A/AA 和 2.1 AA 规则扫描 Home、About、Programs、Login、Register、Dashboard，在三个配置中均未报告违规。这不等于完整 WCAG 认证；尚需真实屏幕阅读器、用户和业务内容审核。

补充手动脚本验证：

- 在独立本地 Vite 服务中关闭 demo，登录/注册/示例入口禁用，已有或伪造的 demo session 也不能进入 dashboard。
- 用不提供 SPA fallback 的简单静态服务器加载 `dist/`，放在 `/TALA-Hub/` 下。项目深链接刷新、站内导航及图片加载正常。
- 演示注册/登录没有外部网络请求；浏览器 storage 中没有密码。

## 第二轮自查与修复

- 修复表单 blur 时出现错误文字导致提交按钮移动、首次点击可能落空的问题。现在提交时校验，并在用户纠正时更新已有错误。
- 修正未知项目筛选参数的回退，让“All opportunities”与显示内容一致。
- dashboard 子视图切换后更新阅读焦点；手机菜单支持 Escape 关闭并返回触发按钮。
- 改善小屏项目状态标签的位置，避免把项目名称挤得过窄。
- 明确 demo 不是真实认证；数据模型、账户开通和学生关联均未冒充现有 SkipCourse 契约。

## 结构与清洁

仅保留页面、复用 UI、服务、样式、资源和测试这些有具体用途的目录，没有预建空目录。没有新增状态管理、UI 框架、表单框架或重复测试框架。单一表单组件服务注册/登录；共享项目内容和 demo 数据集中存放；样式由统一 CSS 变量管理。

严格 TypeScript + ESLint 检查未使用的变量/import、类型和常见 React 问题；人工检查了死代码、重复 UI/CSS、含混命名和无用依赖。应用中没有 console.log、debugger 或散落的 fetch。常见密钥模式扫描未发现敏感值。生成的依赖、构建结果和测试报告都被忽略；临时截图和检查脚本不在仓库内。

未删除任何原有项目内容。`CNAME` 是原有生产域名配置，保留；Skills 的上游示例/索引/许可证不属于应用死代码，保留。没有发现需要用户判断才能清理的未知原有文件。

## 视觉与内容边界

设计围绕学习笔记、自然观察和不同学习路径展开：墨绿 `#173f38`、纸白 `#fbfcf9`、浅绿 `#e6eee5`、浅蓝 `#e0edf2`、暖黄 `#f5e4aa` 与柔粉 `#f3e4dd`。主体使用本机无衬线字体，插图文字采用衬线；不依赖外部字体或图片请求。桌面采用文字/学习日记左右布局，手机改为连续阅读；没有营销数字、评价或合作方标志。

品牌标志和插图是设计草案，等待 Sponsor 确认。正式文案、dashboard 最终字段/布局、真实后端/账户开通与生产托管仍待确认，见 [INTEGRATION.md](INTEGRATION.md)。当前页面以英文呈现。课程进度只读，文件上传、真实课程内容和 profile 编辑未实现，也没有用空按钮暗示这些功能已经存在。

## Repository cleanup verification — 2026-09-24

Documentation and Git tracking only; application source, tests and root tool configurations are unchanged. The project structure guide now lives in `project/docs/PROJECT_STRUCTURE.md`, and the root README is a concise English entry point. Local personal notes are excluded from Git. Existing integration documents, Skills and historical QA records remain useful and were retained.

- Build, Lint and Typecheck: PASS.
- Playwright: **60/60 PASS**, no failures, skipped tests or retries; Chromium at 320/390/1440 px and WebKit/iPad at 768 px.
- Registration, login, community roles, dashboard, class selection and calendar regression tests pass.
- Shared documentation links resolve. No generated artifacts are tracked; existing Git ignore and Explorer exclusions remain in effect.
- The normal demo build was regenerated after testing with QA controls disabled. No application functionality or production configuration changed.


## Feature folder cleanup — 2026-09-27

Code now lives directly under `src/registration`, `authentication`, `dashboard`, `classes`, `public-site` and `shared`. Page-specific services, mock fixtures and styles live with their feature; class selection and calendar retain one shared implementation. The header is separately discoverable. The unused Icon style passthrough was removed; no long inline styles were found. Shared input/error markup and visual tokens reuse the previously verified refactor.

Team documentation and the unchanged test source moved into `project/docs` and `project/tests`. Only test discovery, typecheck inclusion and formatting paths changed in root tool configuration; no dependency or production configuration changed. Skills, agent notes, editor preferences and personal notes remain local and ignored, and are no longer Git-tracked.

- Format, Lint, Typecheck and Build: PASS.
- Complete original Playwright suite: **60/60 PASS**, no skipped tests or retries; Chromium at 320/390/1440 px and WebKit/iPad at 768 px. Test source is byte-identical to the previous staging version.
- Ordinary demo build: the full registration → funding → review → login → class selection → calendar → refresh journey passes at all four widths, without QA controls, external requests, console errors or horizontal overflow.
- 24/24 captured screenshots, visible text and page dimensions match the pre-refactor baseline. This comparison covers Home, registration entry, login, dashboard, available classes and empty calendar.
- Relative documentation links resolve; no empty source folders, debug output, source inline styles or new dependencies. Build and test artifacts are removed after verification; temporary QA scripts/screenshots stay outside the repository.

Only the requested structure cleanup and necessary documentation/configuration path updates are in this change. Main, CNAME, DNS and production settings are unchanged. The later user instruction authorizes a normal commit and push to staging, without rewriting history or merging.

## Standalone frontend directory — 2026-09-27

The application, standard tool configuration and automated tests now live together in `frontend/`. Run npm commands from that directory. Team documentation remains in `project/docs/`; README, Git ignore rules and the unchanged CNAME remain at repository root.

- All 60 source files, the original test source and dependency lock file are byte-identical to the previous staging version. Only directory references and documentation changed.
- Format, Lint, Typecheck and Build: PASS.
- Complete Playwright suite: **60/60 PASS**, without failures, skips or retries, across 320/390/1440 px Chromium and 768 px WebKit/iPad.
- Generated build and test output removed after validation; dependencies remain locally ignored.
- Future preview setup must use `frontend` as its application root. No external hosting or production settings changed.

## Sprint 2 verification — 2026-09-30

SCRUM-46/47 add signup 2FA setup and verification UI. SCRUM-48/49 add payment UI and approval-gated navigation. These are explicit frontend demos with no Firebase, OAuth, approval or payment backend. Implementation details and the changed-file list are in [SPRINT_2.md](SPRINT_2.md).

- Format, Lint, Typecheck and Build: PASS.
- Final full Playwright run: **92/92 PASS**, zero failures, skipped tests or retries, at 320/390/1440 px Chromium and 768 px WebKit/iPad.
- Existing registration, login, parent/student switching, dashboard and class/calendar tests remain enabled. Signup journeys now verify the new 2FA step.
- Added coverage for code validation, service errors, retry, cancellation, refresh, anonymous/unapproved access, funding choices, keyboard submission, storage boundaries, accessibility and payment select touch targets.
- Fixed late registration redirects by cancelling in-flight submission on navigation. WebKit payment selects now retain 48px height. The keyboard test uses the existing suite's Option+Tab convention on WebKit.
- No new dependencies, real endpoints, payment fields, credentials or production configuration changes. Skills and private notes remain local and ignored.

Final demo review: the normal build (QA controls off) passed the complete signup → 2FA → approval → payment → dashboard walkthrough at 320, 390, 768 and 1440 px, with no console errors, external requests or horizontal overflow. Generated reports and screenshots remain outside Git.
