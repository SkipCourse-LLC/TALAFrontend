# Backend Team 需要提供什么

## 2026-10-20：真实集成核查与当前边界

已实现共用 Firebase SDK Auth、UID profile、服务端预约事务、Evidence 内容校验与服务端文件归档、已发布学习记录／成果确认、最小化可信亲子关联读取和进度计数。运行方法见根 README。目前实际只连接 `demo-tala-local` Emulator；新增独立测试云配置和严格项目预校验，但没有云端凭据配置、部署或实际云端测试。`backend/` 是待团队 review 的契约，不是 SkipClass 已部署 API。以下旧交接内容涉及“全部 Demo／无 Evidence 页面”的陈述仅适用于旧 presentation preview。

只读源码核查：SCV1 `81f7d382d747ca218460557d7a73c489dd97c319`；backend `cf4b3e22aadf6bbe28b3740a01bf815a5bdbcec8`。未改 SkipCourse 仓库、生产数据、Rules 或部署设置。

控制台检查只确认到项目概览；进一步原生 Chrome 检查被自动审批拒绝，因为无法可靠确认 Work 窗口、可能读取个人标签页。CLI 没有已授权账户，未发起新登录或绕过限制。表中未确认项需要通过已正确连接的 Work 控制台或团队提供的非敏感配置补齐。

| 检查项 | 已确认 | 仍缺什么 |
| --- | --- | --- |
| 项目／账号 | 控制台可见 SkipClass，ID `skip-class-slsru4`，Blaze、5 apps；Work 账号 `yichen@skipcourse.com` | 实际 IAM 角色、测试项目授权仍未核实；不能从 Blaze 推断写权限 |
| Web SDK／认证 | SCV1 源码使用 Firebase email/password、Google SDK；用户文档 `users/{UID}` | 实际已启用 provider、已注册 Web app 配置、Identity Platform／TOTP、恢复策略需控制台或团队确认 |
| 数据／亲子关系 | 源码包含 `users.studentIds/parentIds`、relationships、portfolio_artifacts、student_portfolios、studentGraphs | 实际部署 collections/schema、TALA 允许字段、同意与访问策略需确认；不自动修改关联 |
| Firestore／Storage | 控制台存在 Firestore、Storage 使用量；源码 Rules 可读 | 已部署 Rules 版本未取得，不能声称已验证安全 |
| 服务 | 现有 Cloud Run assessment/progress／relationships 源码已检查 | 没有找到会议预约／Zoom、支付资格／provider API；不把第三方日历抓取当预约 |
| 环境 | SCV1 dev hosting 和 production 源码都指向 `skip-class-slsru4` | dev 域名不代表隔离数据库；需要独立获批测试环境与合成测试账户 |

源码中值得团队复核的安全问题（未对生产进行利用测试）：SCV1 owner profile 更新未限制 role；Storage owner 通配路径缺少大小／类型限制；普通 assessment 创建和进度读取未见函数级身份／所有权校验，实际网关/IAM 是否补充保护尚未证明。TALA 不直接调用这些接口处理未成年人资料，也不信任 `users.role` 为授权来源。

角色由后端发放签名 claim，并核对当前服务端用户角色及会话撤销状态；只编辑显示名，不收集生日、医疗、残障或录音。进度记录提交数与已确认成果数；assessed count 保持 0。学生只能确认已发布成果，不能自行发布成果或确认出席。亲子关系从服务端 canonical relationship 与已记录的同意范围读取，不信任客户端 `studentIds/parentIds`。这不代表获批采集未成年人录音或敏感资料。

Evidence 提交校验 SHA-256、文件字节、类型和大小，完成后移动到无 Firebase bearer 下载 token 的 server-only 路径，并删除原 staging upload；没有客户端文件下载接口。未完成 staging upload 的 token 生命周期、过期清理、病毒扫描、限流、保留和删除机制仍需在真实数据开放前确认。正式 portfolio schema 与 AI job 接口尚未映射。

Karl／Dylan 需确认：独立测试项目与 Web config；服务端 roles/claims 发放；家长／学生开通与 sponsor 同意范围；已部署 Rules；会议 availability／事务／Zoom 授权；Evidence 安全写入／读取和 AI job 权限；支付 provider／金额与资格；目标整合分支。TALA 的 Vite HashRouter 与团队 Next.js 分支不同，不能直接整分支 merge。

生产变更目前为 **零**。未来接入前应单独 review：仅新增/替换哪些服务及路径、对旧用户／亲子关系和 Rules 的影响、测试证据及数据保留策略。回滚应可禁用新客户端入口／服务，恢复此前已 review 的规则版本，保留旧 UID/关系；不以删除共享数据或重写 Git 历史回滚。本轮没有提出或执行未经批准的生产配置更新。

更新：2026-10-07，Dylan 交接。状态：**AWAITING BACKEND**。历史需求来源仍保留在链接文档中。

这是前端的交接问题清单，不是已确认的 API 文档。当前所有账户、身份、课程与资助流程都是 DEMO，没有请求真实后端。下面不提供猜测的 URL、HTTP method 或 JSON。

代码入口和替换方式见 [INTEGRATION.md](INTEGRATION.md)。业务来源和 Tina/Sponsor 待确认项见 [SPONSOR_REQUIREMENTS.md](SPONSOR_REQUIREMENTS.md)。

## Sprint 2 additions

Signup includes a local authenticator/email demo and opens `TwoFactorComplete.tsx` after verification; `RegistrationComplete.tsx` is retained legacy code, not the active completion page. Payment requires an approved demo state. Private shows fixed sample card brands, number, expiry, CVV, billing and contact text inline, with **Use demo card** and an optional **Add demo payment method** dialog. These are static fixtures, not financial inputs or a connected payment provider. Real second-factor enrollment/verification, approval lookup and payment confirmation are still needed. See [SPRINT_2.md](SPRINT_2.md) for current behavior and verification evidence; [INTEGRATION.md](INTEGRATION.md) is the current technical handoff.

## 每一项都需要的契约

以下状态适用于下面 **全部 12 项接入**，并非已默认采用某种认证或请求格式。

| 契约内容              | 当前状态         | 请 Backend Team 提供                                                     |
| --------------------- | ---------------- | ------------------------------------------------------------------------ |
| Endpoint / base URL   | AWAITING BACKEND | 获准使用的测试环境地址、版本和各接口路径                                 |
| HTTP method           | AWAITING BACKEND | 每个操作实际使用的方法                                                   |
| Request JSON          | AWAITING BACKEND | 字段名、类型、必填项、合法值和无敏感资料的样例                           |
| Response JSON         | AWAITING BACKEND | 成功、空结果、处理中等实际响应样例与字段含义                             |
| Authentication method | AWAITING BACKEND | 登录方式、会话过期、退出、跨域与 CSRF 要求；哪些工作由服务端完成         |
| Error response        | AWAITING BACKEND | HTTP 状态、机器可读错误代码、字段错误、可展示消息和重试条件              |
| Permissions           | AWAITING BACKEND | Student / Parent / Alumni / Staff 可读写范围，以及服务端如何验证亲子关联 |
| Loading behavior      | AWAITING BACKEND | 同步或异步、预期耗时、取消、分页、轮询/推送及限流规则                    |

不要把密钥写入本文件、Git 或 `VITE_*`。前端只接收浏览器可以持有的公开配置，秘密由后端管理。

## 12 项接入清单

下表是前端想展示或处理的信息，**不是请求/响应 schema，也不是已经批准的业务规则**。所有行的 endpoint、method、JSON、认证、错误格式和权限均为上表的 **AWAITING BACKEND**。

| 接入                                  | 前端需要 Backend Team 说明什么                                                                             | UI 等待、失败和重试需求                                                                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Registration API                   | 注册数据存在哪里；由一个流程还是多个操作完成；验证、入学、资料、付款与学生 access 的先后状态；是否保存草稿 | 当前有提交中、错误、重试和成功页；真实提交需明确幂等与部分失败恢复，避免重试重复建号                                                     |
| 2. Parent account creation            | 如何创建家长；邮箱验证、重复账号与恢复流程；同意条款由谁确认                                               | 提交时禁用重复操作；字段错误指向具体输入；创建失败不展示成功                                                                             |
| 3. Student account creation           | 谁创建学生；学生标识；什么时候允许登录；TALA 与 SkipCourse 建号由谁协调                                    | 区分待开通、失败、可访问；不能把前端完成页当成已开通                                                                                     |
| 4. Parent → Student relationship      | 关联由谁批准和验证；可访问的学生列表；撤销关联和多学生选择规则                                             | 等关联结果后才展示获授权学生；无权限时不能回落到其他学生数据                                                                             |
| 5. Login / Authentication             | 使用哪个身份系统；登录、退出、会话恢复、过期处理；四种角色如何确认                                         | 有登录中、失败和重试；过期需重新登录；不由前端角色下拉框授予权限                                                                         |
| 6. Student profile                    | 稳定学生 ID、允许展示的字段、可编辑字段和保存规则                                                          | 有加载、缺少资料与失败反馈；哪些字段允许家长修改需确认                                                                                   |
| 7. Student evidence results           | Evidence 来源与可读字段、学生归属、处理状态、结果时间、来源引用；是否允许上传/删除待确认                   | 尚无专门页面；将来按真实 contract 展示未提交、处理中、空结果和失败，不显示虚构分析                                                       |
| 8. Evidence matching results          | 匹配对象、后端生成的解释、证据引用、排序与分数含义/单位、版本和限制                                        | 尚无专门页面；分清待计算、无匹配与失败；重试是否重新计算需确认                                                                           |
| 9. SkipCourse student data            | 学生 profile 来源、TALA/SkipCourse 标识映射、账户状态、允许的登录或跳转方式                                | 明确未关联与无法加载；不猜测 SkipCourse 地址或自动创建账户                                                                               |
| 10. SkipCourse course / progress data | 课程、时区、班次、真实余位、已选课程、进度、出勤；选课冲突与等待名单；消息是否另有接口                     | 加载/空/错误/重试已可演示；真实选课需后端校验余位、并发与重复请求，再更新日历                                                            |
| 11. AZ Transfer data                  | API 实际返回什么；机构/课程标识、有效期、来源链接、等价关系含义、分页与使用限制                            | 尚无专门页面；区分无数据和请求失败；不将匹配结果表述成已批准学分                                                                         |
| 12. Billing / Funding integration     | ESA / STO / Private 的真实流程、资格/审核状态、费用来源、托管付款方式；付款如何影响 access                 | 当前有偏好选择、获批后固定示例付款方式与 Demo 结果，不收费；真实流程需区分待审核、待付款、取消、失败和完成，并由服务端确认 provider 结果 |

材料清单和家长同意要求为 **AWAITING TINA**；费用、资助资格和正式付款说明为 **AWAITING SPONSOR**。后端规则不能由前端样例倒推。

## 现有前端可以复用什么

- `frontend/src/registration/enrollmentContract.ts`：草稿/receipt 类型、合法选项、校验、安全错误、提交合同与 Mock factory。`enrollmentService.ts` 只组合默认 Demo 实例并重新导出合同。receipt 包含样例家长/学生姓名与邮箱，以及安全的可选 `funding`、`learningMode`、`timeBlock`、`intent`；不包含密码、文件或支付信息。偏好由 App 内存传入 Parent workspace，刷新或重新登录会清除。真实注册状态、ID、验证和开通结果仍要按确认的合同扩展。
- `authService.ts` / `serviceTypes.ts`：认证选择入口与 UI 类型。当前 sessionStorage 是演示标记，真实身份接入时必须替换，不能当成权限凭据。
- `frontend/src/authentication/twoFactorAdapter.ts`：模块内 `TwoFactorService`、setup/challenge 类型和本地 Mock；`twoFactorService.ts` / `twoFactorRuntime.ts` 组合默认实现和公开开关。真实 MFA 的 enrollment、verification、重试限制、恢复和 session 必须由服务端执行；本地 TOTP 校验不验证真实身份。
- `frontend/src/payment/paymentAdapter.ts`：审批、状态订阅、提交、取消和 receipt 的模块内合同；`paymentService.ts` / `paymentRuntime.ts` 组合默认实现和公开开关。`PaymentDraft.demoMethod` / Demo receipt 中的 `card` / `bank` 只是固定样例选择，不能作为真实 provider payment method。服务端身份、金额/币种、托管支付工具、幂等键与权威付款结果仍待确认；`mode: "live"` 的类型预留不表示已实现 live adapter。
- `frontend/src/dashboard/skipCourseApi.ts` / `demoStudentAdapter.ts`：学生概览与模拟数据实现分开。真实 adapter 需要从服务端身份解析学生；当前 `getOverview` 没有真实身份契约。
- `frontend/src/classes/scheduleAdapter.ts`：课表类型、载入/加入合同、安全错误与 Mock factory；`scheduleService.ts` 组合默认实例并重新导出合同。当前以样例 email 存标签页选课，支持取消和防重复加入；接入时改用经过验证的学生标识，并由后端完成容量校验与选课事务。`ClassSlot` 当前从集中样例推导，真实契约到位后再确定独立类型。
- `dashboard/demoLearningData.ts` 和 `classes/demoClassSlots.ts`：各功能的样例数据放在对应目录。未来真实响应在服务层校验并转换成页面需要的类型，不把请求散落进页面。

这些边界允许逐步接入，**不意味着拿到任意 API 后无需调整类型、错误处理或页面状态**。

## Evidence / AZ Transfer 的准备范围

当前架构没有阻碍：将来确认 contract 后，页面与专用服务放在 `frontend/src/` 下对应功能目录；真正共用的 UI 放 `frontend/src/shared/`，浏览器流程放 `frontend/tests/`。

本轮没有新增空目录、占位页面、猜测的数据模型或假结果。前端不实现 tokenization、embeddings、cosine similarity、Neo4j、graph algorithms、evidence scoring 或 AZ Transfer 后端。分数与解释由后端提供，UI 只展示获准展示的结果和状态。

## Questions for Backend Team

1. Where should registration data be stored?
2. Which API creates parent and student accounts?
3. How is a parent linked to a student account?
4. What authentication system should the frontend use?
5. What is the response JSON for evidence matching?
6. What data will the AZ Transfer API return?
7. Which endpoints provide SkipCourse student profile/course data?
8. What error format should the frontend expect?
9. How should registration recover if account creation, billing, or SkipCourse provisioning fails?
10. Which registration and billing states allow student access?
11. How should the frontend handle an expired session or revoked parent access?
12. Which preview origins are allowed, and what safe test accounts can we use?

## 拿到契约后的验收

先使用获准的测试环境和样例账号，验证成功/空/错误、会话过期、跨学生访问限制、重复提交和部分失败恢复。再替换 demo 实现，并复测注册到选课的完整路线。真实付款、敏感资料、production 和域名操作不属于当前授权范围。
