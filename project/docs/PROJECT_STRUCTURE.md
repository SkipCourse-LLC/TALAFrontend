# TALA Hub 项目结构

先打开 `frontend/src/`，按功能找代码。每个功能目录直接放自己的页面、组件、服务和 CSS，不再套多层 components/pages/services 文件夹。

当前 Dylan 交接入口见 [INTEGRATION.md](INTEGRATION.md)，SCRUM-46–49 的行为、Demo 边界与本轮验证证据见 [SPRINT_2.md](SPRINT_2.md)。以下路径对应当前 React/TypeScript/Vite 项目。

2026-10-20：新增 `frontend/src/backend/` 的统一 Firebase 配置、认证、MFA、数据／文件服务与学生工作区；`backend/` 存放 Emulator／获批测试云 Functions、严格 Rules、索引与定向测试。根 README 是最新启动入口。默认 presentation preview 与 Firebase 模式分开，不将 Demo session 当作真实认证。

## 目录一览

```text
TALA-Hub/
├── frontend/                  完整前端应用；在这里运行 npm
│   ├── src/
│   │   ├── public-site/       首页、介绍、项目、活动、联系
│   │   ├── registration/      注册、Funding 偏好、复查、合同和保留的旧完成组件
│   │   ├── authentication/    登录、身份选择、2FA 设置与验证码、演示会话
│   │   ├── payment/           审批状态、Payment 表单和模拟服务
│   │   ├── dashboard/         学生/家长工作区和学习记录
│   │   ├── classes/           可选课程、加入课程和个人日历
│   │   ├── shared/            共用组件、services/ 和 styles/
│   │   ├── assets/            网站图片
│   │   ├── App.tsx            路由和会话
│   │   └── main.tsx           启动入口
│   ├── tests/                 Playwright 浏览器、独立模块与纯 service 测试
│   ├── package.json           运行命令和依赖
│   ├── package-lock.json      精确依赖版本
│   ├── index.html             Vite HTML 入口
│   ├── .env.example           公开环境配置示例
│   ├── vite.config.ts         构建配置
│   ├── tsconfig.json          TypeScript 配置
│   ├── eslint.config.js       代码检查配置
│   └── playwright.config.ts   浏览器测试配置
├── project/docs/              团队说明和后端交接
├── README.md                  简短入口
├── .gitignore                 整个仓库的忽略规则
└── CNAME                      原有域名文件，内容和位置未改
```

`frontend/` 是标准 React/Vite 应用根目录，配置和源码一起移动，保持工具默认查找方式；没有创建重复的根目录 package.json 或特殊脚本。仓库根目录只保存仓库级文件。

## 各功能怎么找

| 要修改什么                                         | 打开哪里                                                                                                                                                 |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 首页 / Learn More / Programs / Events / Contact    | `frontend/src/public-site/` 中对应的 `*Page.tsx`；共用项目文案在 `programContent.ts`                                                                     |
| 注册总体布局、上一步/下一步按钮                    | `frontend/src/registration/RegisterPage.tsx`                                                                                                             |
| 注册草稿、校验、提交和焦点                         | `frontend/src/registration/useRegistration.ts`；类型、校验和 service contract 在 `enrollmentContract.ts`；`enrollmentService.ts` 组合默认 Demo 实现      |
| 家长、学生、入学、材料和 Funding 字段              | `frontend/src/registration/RegistrationFields.tsx`                                                                                                       |
| Review / 验证后的完成页                            | `registration/RegistrationReview.tsx` / `authentication/TwoFactorComplete.tsx`；`registration/RegistrationComplete.tsx` 是保留的旧组件，当前主流程不用它 |
| 2FA 设置、验证码与完成状态                         | `authentication/TwoFactorPage.tsx` / `TwoFactorSetup.tsx` / `TwoFactorComplete.tsx`；模块合同在 `twoFactorAdapter.ts`                                    |
| 审批、付款与固定示例付款方式                       | `payment/ApprovalPage.tsx` / `PaymentPage.tsx` / `PaymentForm.tsx` / `SamplePaymentMethod.tsx`                                                           |
| 登录与 Student / Parent / Alumni / Staff 选择      | `frontend/src/authentication/LoginPage.tsx`                                                                                                              |
| 登录输入、错误、等待状态                           | `frontend/src/authentication/AuthForm.tsx`；输入校验在 `formValidation.ts`                                                                               |
| 登录服务与会话存取                                 | `frontend/src/authentication/authService.ts`；模拟实现是 `demoAuthAdapter.ts`                                                                            |
| Dashboard 选择显示哪个视图                         | `frontend/src/dashboard/StudentDashboard.tsx`                                                                                                            |
| Dashboard 导航项目、手机和桌面导航                 | `dashboardViews.ts` / `DashboardNavigation.tsx`                                                                                                          |
| 学习与项目 / 课程卡 / 个人资料                     | `DashboardContent.tsx` / `CourseCard.tsx` / `StudentProfile.tsx`                                                                                         |
| 出勤、SkipCourse、消息待接入说明                   | `StudentAccountPanel.tsx`                                                                                                                                |
| 家长、Alumni、Staff 演示工作区                     | `CommunityWorkspace.tsx`                                                                                                                                 |
| 加载学习概览                                       | `useStudentOverview.ts` → `skipCourseApi.ts` → `demoStudentAdapter.ts`                                                                                   |
| Available Classes / My Classes / Personal Calendar | `frontend/src/classes/StudentSchedule.tsx`；共用一套课表与数据，不维护三份列表                                                                           |
| 选课、加载和本标签页保存                           | `frontend/src/classes/useStudentSchedule.ts` → `scheduleService.ts` → `scheduleAdapter.ts`；后者拥有合同、错误映射和 Mock factory                        |

**Calendar** 目前就是已选课程的日历视图，所以和 Classes 放在一起。**Funding** 在注册阶段是偏好选择；获批后的独立演示流程放在 `payment/`，也不是真实支付系统。确认有独立业务后再拆目录，不预建空的 calendar/funding 文件夹。

## Sprint 2 新功能

- 注册提交后进入 `authentication/TwoFactorPage.tsx`；`twoFactorAdapter.ts` 定义模块 service contract 和本地 TOTP Mock，`twoFactorService.ts` 组合默认实现，`twoFactorRuntime.ts` 提供该模块的公开 Demo 开关与可取消延迟。验证码通过后由 `TwoFactorComplete.tsx` 显示完成状态，`App.tsx` 打开家长演示会话。
- `payment/ApprovalPage.tsx` 显示审批；`PaymentPage.tsx` 检查访问条件；`PaymentForm.tsx` 管流程；`PaymentLayout.tsx` 和 `payment.css` 管布局与样式。`paymentAdapter.ts` 拥有状态、receipt 与 service contract；`paymentService.ts` 组合默认实现；`paymentRuntime.ts` 提供模块开关；`useApproval.ts` 管审批加载/重试，`usePaymentSnapshot.ts` 订阅当前状态。
- Private 直接显示固定的示例品牌、卡号、有效期、CVV、账单地址与联系信息，点击 **Use demo card** 选中该示例；可选的 **Add demo payment method** 对话框也只选择固定示例卡或银行账户。这些展示不是输入框，不接收真实信息，不连接 payment provider，也不付款。
- 注册 receipt 只包含样例家长/学生姓名、邮箱和安全的可选 `funding`、`learningMode`、`timeBlock`、`intent` 偏好。偏好留在 `App.tsx` 内存，刷新或重新登录会清除，不保存密码、文件或真实付款信息。
- 浏览器回归在 `frontend/tests/frontend.spec.ts`、`sprint2.spec.ts`、`sprint2Upgrade.spec.ts` 和 `product*.spec.ts`；模块独立浏览器检查在 `sprint2Production.browser.ts`、`paymentCheckout.browser.ts`，使用 `sprint2Harness.html` / `.tsx` 与 `sprint2Browser.config.ts`。纯 service 检查由 `sprint2Unit.config.ts` 运行 `sprint2Adapters.unit.ts` / `productAdapters.unit.ts`。Harness 是测试入口，标准 `index.html` 构建不将其发布为应用页面。
- 2FA、审批、付款都只是标明的 demo，不是真实认证或支付。

## Shared 放什么

- `SiteLayout.tsx`：公共页面框架、页脚、跳过导航链接。
- `SiteHeader.tsx`：站点顶部导航、手机菜单和键盘关闭逻辑。
- `Brand.tsx` / `Icon.tsx`：品牌显示和共用图标。
- `TextField.tsx`：注册、登录共用的输入标签、提示和错误关联。
- `RouteFocus.tsx`：路由切换后的页面标题和阅读焦点。
- `styles/base.css`：颜色、间距、圆角、文字和焦点规则；`shared.css`：按钮、公共面板和提示；`forms.css`：输入控件；`layout.css`：站点布局。`global.css` 统一导入顺序、reduced-motion 和 shared forced-colors 设置；2FA 的独立 `twoFactor.css` 由该模块直接导入。

专属于某个功能的组件和 CSS 放回该功能目录。不要为了每个按钮或十几行代码单独建文件夹；现有按钮共用 CSS 类，不需要再包一层组件。

## Mock 和后端接口在哪里

- `registration/enrollmentContract.ts`：草稿、receipt、合法选项、校验、安全错误与 Mock submission；`enrollmentService.ts`：默认实现的 runtime composition。
- `authentication/twoFactorAdapter.ts` / `twoFactorService.ts` / `twoFactorRuntime.ts`：2FA 模块合同、默认实例和本地运行配置；`twoFactorCode.ts` 处理验证码规范化。
- `payment/paymentAdapter.ts` / `paymentService.ts` / `paymentRuntime.ts`：付款模块合同、内存状态、安全错误、默认实例与本地运行配置。`demoMethod` 只是 `card` / `bank` 枚举，不是 provider token 或真实支付工具。
- `dashboard/demoLearningData.ts`：虚构学习与项目数据；`learningTypes.ts`：前端类型与 student adapter；`learningErrors.ts`：安全错误；`courseProgress.ts`：空课程和异常进度处理。
- `classes/demoClassSlots.ts`：虚构课程和余位；`scheduleAdapter.ts`：课表类型、读取/加入合同与 Mock factory；`scheduleService.ts`：默认实例的 runtime composition。
- `shared/services/demoData.ts`：登录及家长演示共用的样例学生身份。
- `shared/services/demoConfig.ts` / `demoDelay.ts`：登录、注册、学习使用的公共 Demo 配置和延迟；排课读取公共配置，使用 `scheduleAdapter.ts` 内的可取消延迟。2FA 和 payment 使用各自模块内的 runtime，读取同名公开开关。`serviceTypes.ts`：共用会话和认证接口类型。

页面 → 对应功能的服务接口 → 模拟实现。未来真实接口在服务层替换，不把 fetch 和凭据散落进组件。这里没有真实认证、付款、材料上传或 SkipCourse 连接。详细需求见 [INTEGRATION.md](INTEGRATION.md) 和 [BACKEND_INTEGRATION_NEEDED.md](BACKEND_INTEGRATION_NEEDED.md)。

## 以后在哪里加代码

1. 修改已有功能，先进入对应目录，复用已有页面、服务和 CSS。
2. 新的独立功能足够大时，在 `frontend/src/` 新建一个能直接说明用途的目录，并在 `App.tsx` 接入路由。
3. 只有跨功能复用的 UI 放 `shared/`；只有跨功能共用的服务代码放 `shared/services/`。
4. 自动测试放 `frontend/tests/`，团队说明放 `project/docs/`；不把说明或测试截图放进业务目录。
5. 不新增重复页面、不创建空目录、不因为一个类型或一个文件再套一层目录。

## 安装、检查和本地文件

从仓库根目录进入应用，用锁文件安装依赖：

```sh
cd frontend
npm ci
npm run dev
```

检查命令均在 `frontend/` 运行：

```sh
npm run lint
npm run typecheck
npm run build
npx playwright install chromium webkit
npm test
npx playwright test -c tests/sprint2Unit.config.ts
npx playwright test -c tests/sprint2Browser.config.ts
```

应用回归使用端口 4173，独立模块浏览器检查使用 4175；浏览器项目覆盖 320、390、768、1440，纯 service 检查不启动浏览器。只格式化本次实际更改的文件并检查 diff；不要为了交接运行会重写无关源码的全项目 `npm run format`。

测试会启用 QA 控件。演示前使用 `VITE_DEMO_MODE=true VITE_DEMO_TOOLS=false npm run build` 重新构建，然后 `npm run preview`。HashRouter 的页面地址形如 `/#/register`。

`node_modules/`、`dist/`、测试报告是生成文件，不进入 Git。Skills、代理指引、编辑器设置和个人笔记只留本机，不上传。不要使用 `git add -f` 绕过这些忽略规则。历史检查记录中的旧路径属于当时版本，当前路径以本文为准。

## Preview 构建路径

以后创建或调整 Preview 项目时，应用 Root Directory 应为 `frontend`，构建命令仍是 `npm run build`，相对于应用根目录的输出仍是 `dist`（仓库路径为 `frontend/dist`）。已有外部 Preview 如果仍指向仓库根目录，需要另行更新该设置。本轮没有修改任何托管、production、DNS 或 CNAME 设置。
