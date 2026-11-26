# Sponsor 需求对齐 — 2026-09-22

本轮延续已有前端。DONE 指可操作的前端演示，不代表真实学校服务已上线。最新用户请求决定本轮范围；附件中的技术方案、API 示例、未来路线图不等于已提供接口或部署授权。

## Sprint 2 补充（2026-09-30）

本轮新增注册后 2FA 设置/验证码，以及审批状态到 Payment 的独立演示流程。需求、接口边界、状态和待确认事项见 [SPRINT_2.md](SPRINT_2.md)。下面 2026-09-22 的表格为原阶段记录；真实认证、审批和支付仍未接入。

## 阅读的来源

- Tina 的 `TALA website layout.pptx`：13 页；第 6 页材料清单为空，第 7 页课程时段/余位，第 10 页社区身份，第 11 页学生 dashboard，第 12 页导航，第 13 页资助来源。
- `Technical Buildout Specification_ TALA Unified SIS_LMS Integration.docx`：学校模型、两小时课段、SIS/LMS 集成方向及后续系统方案。
- `Parent_web TUCSON ADAPTIVE LEARNING ACADEMY (TALA) ad needs edits.docx`：家长宣传草稿，名称和正文均包含未完成内容。
- 用户提供的 Karl / Sponsor 对话截图：家长和学生资料先行、材料和 billing 后才能有学生访问；未来自动关联 SkipCourse。
- 本轮十份粘贴附件内容一致，按同一份需求处理。

## 需求与实现

| 需求 | 当前状态 | 去哪里看 / 边界 |
| --- | --- | --- |
| Parent → Student → Enrollment → Documents → Billing → Review → Login | DONE（demo） | `RegisterPage.tsx`；六步、前后切换、复查编辑、字段校验、提交等待、失败重试、成功页 |
| Parent 必须先于 Student access | DONE（注册演示顺序） | 注册必须走完六步才出现继续登录；独立样例登录仍可体验网站，不是生产门禁 |
| 家长/学生真实账户、自动 SkipCourse provisioning | AWAITING BACKEND | `enrollmentService.ts`、`authService.ts`；没有真实请求，没有保存密码 |
| Enrollment / Waiting List 与时间、学习方式偏好 | DONE（demo） | 家长选择偏好，不构成名额预约 |
| 正式必填字段、监护同意及材料 | AWAITING TINA | 材料步骤明确没有上传入口；未猜测敏感资料清单 |
| ESA / STO / Private | DONE（前端选项） | 仅表达偏好，不计算收费或声称已获资助 |
| Billing、付款、资格核验 | AWAITING BACKEND / AWAITING SPONSOR | 无银行卡字段、无金额、无真实支付 |
| Student / Parent / Alumni / Staff 登录 | DONE（demo） | `LoginPage.tsx`；切换身份仅改变演示页面，不验证权限 |
| Parent 自己 / 代表 Student | DONE（demo） | 清楚显示当前身份；学生视图有代表身份提示；正式家庭关联 AWAITING BACKEND |
| Personal Calendar / My Classes / Available Slots | DONE（demo） | `StudentSchedule.tsx`、`scheduleService.ts`；每周课表、课程格式筛选、选课后显示在日历；刷新同一标签页可恢复 |
| Available / Full / Waiting List / remaining places | DONE（demo） | 集中虚构样例在 `demoData.ts`；Full / Waiting List 不可直接加入 |
| 实时余位、真实排课、等待名单提交 | AWAITING BACKEND | 当前选课不占用真实名额；无真实冲突规则或排课 API |
| Attendance Hours | PARTIAL / AWAITING BACKEND | 已有入口与无记录状态，不把预约当作出勤，不虚构已验证小时 |
| SkipCourse Account | PARTIAL / AWAITING BACKEND | 显示未连接及将来关联方向；没有猜测 SSO 链接 |
| Messages | PARTIAL / AWAITING BACKEND / AWAITING TINA | 空态及权限待确认说明，没有假装发送消息 |
| Profile、学习路径、项目 | DONE（原有 demo 保留） | `StudentDashboard.tsx`；不会写回真实记录 |
| Alumni / Staff 工作区 | PARTIAL / AWAITING TINA | 独立社区空态、事件和消息入口；未编造管理权限 |
| Home / Learn More / Enrollment / Events / Contact / Community Login | DONE（前端路由） | 旧 About / Programs 地址仍可用；新增页面不需要托管重写 |
| Founders / mission / lecture series / visiting professors | PARTIAL / AWAITING SPONSOR | Learn More 对应章节保留明确占位 |
| 虚拟校园参观、正式照片、开学时间、真实活动和联系渠道 | AWAITING SPONSOR | 未伪造地址、人员、图片或活动日期 |
| AI 代理、临床监控、Neo4j、HubSpot、EZAMU、财务审计、职业智能 | PHASE 2 / FUTURE | 技术规格中的系统方向，不属于本轮前端实现；示例 endpoint/payload 未接入 |

## 需要 Tina / Sponsor 解决的内容差异

1. 技术规格主要模型写线上 20:1，家长草稿及部分账单示例写 10:1。页面不公布人数承诺，等待确认。
2. PPT 使用不同阶段的 landing page（筹备/场地就绪）；校园、开学日、虚拟参观尚未确认。现在显示筹备预览。
3. 宣传草稿中的认证、护理、资助 100% 覆盖及具体学费不能作为已批准声明发布。本轮没有公布这些承诺或计算账单。
4. Required documents 页为空；不能自行规定真实健康档案/身份证明上传。学生邮箱和 8 位演示密码是体验字段，不是已批准的身份政策。
5. Contact 草稿存在括号号码、空邮箱及占位地址；统一等待正式发布版本。

这些差异已隔离为明确占位，不影响注册、身份选择和选课的安全演示。没有因此中断其它前端工作。

## 演示与数据边界

- 注册内容仅保留在当前页面状态；离开或刷新会清除草稿。完成后只有样例家长/学生姓名与邮箱通过路由状态传递。
- 演示会话和角色使用 sessionStorage；课程选择也只保留在当前标签页。它们不是认证、权限或机密存储。
- 不收集文件、医疗信息或支付信息；不保存密码；没有网络 API 请求。
- `VITE_DEMO_MODE=false` 时相关服务拒绝操作，不会退回任何虚构 endpoint。
- 测试开关仅在 `VITE_DEMO_TOOLS=true` 时显示，普通预览隐藏。

## 验证与第二轮检查

第一轮端到端验证发现布局及交互问题后，进行了第二轮修复。已实际查看 320px 注册、390px 课程列表、768px 日历和 1440px Home 截图；测试还为每种尺寸保存 Funding、Review、Parent Login 等完整页面截图。截图仅在被 Git 忽略的 `test-results/` 中。

| 第二轮重点问题 | 处理 |
| --- | --- |
| 新增十个学生菜单挤满手机首屏、平板横向溢出 | 小屏用可展开的导航链接，默认收起、选择后自动收起；桌面保留侧栏 |
| 注册步骤说明把第一输入框推得太低 | 小屏只显示当前 Step n of 6；收紧标题与间距 |
| 原生下拉菜单在模拟平板上的键盘行为不一致 | 改为原生 details/summary 加链接，用 Tab/Enter 操作并按路由规则移动焦点 |
| 注册后的家长回到身份选择时丢失学生关联 | 演示身份保留关联学生；回到登录时带上正确样例家庭 |
| 家长代表学生时 Profile 显示家长邮箱 | Profile 使用关联学生姓名和邮箱 |
| 家长与学生选课记录键不一致 | 统一按样例学生邮箱关联课程 |
| Available Slots 的格式筛选隐藏了个人日历课程 | 筛选只影响课程目录，个人课表显示全部已选课 |
| 加课后的示例余位没有变化 | 显示扣除本次选择的样例余位；不声称真实容量 |
| 注册提交失败后键盘用户难以定位错误 | 错误说明可聚焦，并保持输入以便重试 |
| 新旧注册分支与 About 样式同时存在 | 删除明确被替代的代码分支和 CSS，保留仍在使用的文件 |
| 旧项目概念可能被误认成已确认课程 | 明确标为 AWAITING SPONSOR 的概念预览 |

第三轮分别按家长（完整资料/Funding/Review/代表学生）、学生（选课/日历/刷新/空态/错误重试）、新开发者（README/目录/服务边界）检查。新增测试覆盖 STO、Private、等待名单，以及注册后的家庭关联；原有 ESA 主流程保留。

### 最终验证结果（2026-09-22）

- `npm run build`：PASS；测试后重新构建普通演示版本，QA 控件默认隐藏。
- `npm run lint`：PASS，零警告。
- `npm run typecheck`：PASS。
- 完整 `npm test`：**56/56 PASS，零失败、零重试，约 1.6 分钟**。
- 14 个用例分别在 320px Chromium、390px Chromium、768px WebKit/iPad 模拟、1440px Chromium 下运行。
- 覆盖完整 Parent → Student → Enrollment → Documents → Funding → Review → Login → Dashboard；ESA/STO/Private、等待名单、四种社区身份、家长/学生关联、选课/日历、加载/空/错误/重试、刷新、键盘、长文本和 axe 自动检查。
- 最后对普通演示构建另做四尺寸 QA：Home、Registration、Login、课程列表、移动菜单展开/自动收起；无横向溢出、无浏览器运行错误、测试控件隐藏。截图与检查结果在本机 `/tmp/tala-final-qa/`，不加入仓库。

失败分类与修复：导航拥挤、原生菜单键盘体验属于产品问题，最终改为默认收起的 `details/summary` 导航链接；页面切换后立刻操作旧内容属于测试竞态，已等待目标标题就绪；中断期间曾出现约 16 分钟的执行暂停，恢复后的完整重跑一次全部通过。没有跳过测试或通过自动重试掩盖失败。历史 MVP 与 Frontend Excellence 记录继续保留，不把旧数量当成本轮结果。

### 清洁检查与演示边界

- `src/` 仍为 assets、components、pages、services、styles 五个目录，没有新依赖、空目录或重复架构。
- 清除了被本轮流程明确替换的旧注册分支与 About/注册样式；所有仍使用的组件、资产、配置和工程文档保留。
- 未发现应用目录内的临时/备份/日志文件、调试输出或未使用 import；Lint 与 Typecheck 均通过。
- 19 个 Skills 保留，未格式化或修改上游内容。上游 Markdown 中原有的换行空格不作为垃圾删除。
- `node_modules/`、`dist/`、`playwright-report/`、`test-results/` 均未被 Git 跟踪，继续被 `.gitignore` 排除和 VS Code Explorer 隐藏；本地保留依赖、演示构建与测试证据。
- 工作仍在 staging；未 commit、push、merge、deploy，未修改 main、CNAME 或 DNS。

**可用于 Sponsor 的前端 Demo 演示。** 当前仍不提供真实注册、支付、身份权限或 SkipCourse 数据连接；正式文案、材料及业务差异仍按上方表格等待确认。

## 后续自主复查与 Preview 准备（2026-09-22，最新）

本轮接着已完成的导航修复工作复查，没有重做页面、改视觉系统或新增产品功能。

- 加强原有 keyboard journey：切换 Dashboard 后主内容获焦，移动导航自动收起，隐藏链接不进入下一步 Tab 顺序。WebKit 使用测试环境的全控件键盘遍历方式；这是模拟浏览器检查，不代替真实 iPad / VoiceOver 用户验收。
- 新增 public hash deep-link regression：Learn More、Registration、Events、Contact、Login 的直接访问和刷新只请求服务器根路径，并保留正确页面。
- 新测试首次构建遇到 TypeScript 元组推导错误，属于新增测试代码问题；修正只读元组类型后 8/8 定向检查通过。未修改产品行为、放宽 timeout 或跳过断言。
- 最终完整 `npm test`：**60/60 PASS，0 failed、0 skipped、0 retries，约 1.6 分钟**（15 个用例 × 4 个浏览器/尺寸项目）。
- `npm run lint`：PASS，零警告；`npm run typecheck`：PASS；测试后以 `VITE_DEMO_MODE=true VITE_DEMO_TOOLS=false npm run build` 重新生成普通演示版本：PASS。
- 第二轮 QA：320、390、768、1440 全部完成注册→登录→选课→日历→家长自己→代表学生→切回学生→首页；4/4 演练通过，无 console error、失败请求、外部 API 请求或横向溢出，未显示 QA 控件。
- 另外用不带 SPA fallback 的 Python 静态服务器托管 `dist/`，四尺寸直接链接刷新、静态资源、菜单与页面检查全部通过。已查看 320 注册、390 课程、768 展开导航、1440 首页截图，保留现有视觉系统。
- 第二轮没有发现阻碍安全演示的新产品问题。尚未确认的正式文案、材料和账户权限继续显示 AWAITING，不为看起来完整而编造内容。

截图和 JSON 结果只在本机 `/tmp/tala-preview-qa/`、`/tmp/tala-meeting-rehearsal/`；本地演示服务器继续使用 `http://127.0.0.1:4180/`，临时静态检查服务器已退出。

后端交接新增 [BACKEND_INTEGRATION_NEEDED.md](BACKEND_INTEGRATION_NEEDED.md)，覆盖 12 项接入、未知契约、团队问题、Evidence/AZ Transfer 范围。原 [INTEGRATION.md](INTEGRATION.md) 继续解释代码边界，职责不重复。

Vercel Preview：**代码与静态构建已就绪，远端设置和部署未验证**。README 记录 Vite preset、构建/输出、环境变量和 hash 地址用法。本机 Node 25.6.1 已实测，Vercel Node 24 仅核对支持范围，尚未远端构建；没有新建不必要的部署配置、访问生产设置或部署。

清洁复查：仍为 5 个 src 目录、30 个源码文件和 19 个 Skills。没有发现明确可删除的新垃圾或无引用源码候选；没有删除用途不明的文件。依赖、dist 与测试证据保留在本地，Git ignored / Explorer hidden；未被跟踪。无新依赖、空目录、调试输出，文档本地链接完整。

Git 身份检查：当前 `user.name` 与 `user.email` 均未配置；未猜测或改写邮箱。下次提交前必须由用户确认 `Yichen Zeng` 和 GitHub 已验证邮箱。本轮没有 commit/push/merge/deploy，main、CNAME、DNS、talaedu.com 均未改动。
