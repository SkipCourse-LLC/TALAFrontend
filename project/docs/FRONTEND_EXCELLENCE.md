# Frontend Excellence Review

2026-09-21，`staging` working tree。范围是现有前端的视觉、交互和质量；真实认证、SkipCourse、报名与部署不在本轮范围内。

## 从哪里继续

本轮延续已经运行的 React / TypeScript / Vite MVP，没有重建项目。首轮浏览器审查与第一批优化之后，继续完成未结束的四尺寸 QA、用户流程和 cleanup。保留项目已有 staged 内容，不提交、不推送、不改 main / CNAME。

## 研究如何影响设计

先阅读项目的 frontend-design、react、ui-design、web-design-guidelines、playwright、typescript 技能，再读取公开资料并实际检查原版页面。

- [Duolingo 的核心页面重设计复盘](https://blog.duolingo.com/core-tabs-redesign/)：标题、字体、间距应有共同规则，但每页的空间分配要服从任务。TALA 因此移除 Dashboard 欢迎装饰块，把课程和进度提前；没有照搬 Duolingo 的品牌或页面。
- [Notion 公共首页](https://www.notion.com/)：观察其按用途组织入口、区分主要与次要动作的方式。TALA 首页明确两个去向：了解项目、体验学生 hub。这是对公开页面的设计观察，不是对其内部系统的推断。
- [Apple Education](https://www.apple.com/education/)：观察其按受众和实际需求组织信息的方式。TALA 把四类学习机会直接写进首屏，避免只用抽象成长口号。
- [Vercel Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md)：对照语义、键盘焦点、字段标签、具体错误、反馈及减少动画要求检查。没有复制商业网站的文案、布局、标志或资产。

这些原则适合教育产品，因为学生首先需要知道能学什么、该点哪里、操作有没有成功。原有墨绿、纸白、浅色提示与本地学习笔记插图继续构成 TALA 的暂定视觉方向。

## 原版最明显的十个问题

| 问题 | 实际处理 |
| --- | --- |
| 首页首屏只有泛化成长口号，服务内容不明确 | 直接说明 tutoring、group courses、hands-on learning、interview preparation |
| 桌面标题约 72–73px，辅助文字最低约 10px，层级失衡 | 公共 H1 上限 52px；可见辅助文字至少 14px |
| 首页价值条、笔记装饰区重复表达，页面过长 | 移除重复区块，保留项目概览和明确的 hub 入口 |
| 手机登录/注册先看到很长的宣传侧栏 | 表单在 DOM 中先出现；窄屏隐藏非必要侧栏 |
| 768px 仍使用紧凑的桌面导航/表单/侧栏 | 导航折叠、表单单列、dashboard 顶部导航；内容区保留适合平板的列数 |
| CTA 暗示正式报名，登录后仍出现注册 CTA | 使用明确 demo 文案，已有会话不再显示注册 CTA |
| Dashboard 多层提示、欢迎区抢占学习内容位置 | 保留简短连接说明、进度与课程；普通预览隐藏 QA 控件 |
| 课程/项目图示占比过大，“Continue exploring”像真实课程启动 | 缩小图示，使用准确的“View sample lessons”，保留只读边界 |
| 320px 项目筛选占用过多纵向空间 | 原生 select、有可访问标签、结果数量反馈、URL 同步 |
| 菜单焦点离开不关闭；重试成功与 URL 仍为 error 不一致 | 监听外部 focusin / pointer、保留 Escape；重试切回 success 并保留清楚焦点 |

## 原版逐页审查

四个宽度均真实运行、截图并查看；不只检查源码。下表记录该尺寸下最明显的问题。所有原版页面均无横向溢出和运行时异常，但这并不代表体验已经成熟。

| 页面 | 1440px | 768px | 390px | 320px |
| --- | --- | --- | --- | --- |
| Home | 大 H1、抽象内容、重复区块 | 文字/图像比例不平衡 | 重复区块拉长阅读 | 标题多行、按钮之后仍有大量装饰 |
| About | 标题过大、空白较多 | 文字两列偏挤 | 泛化标题占用首屏 | 标题断成很多行 |
| Programs | 大色块重复类别名称 | 装饰比例大 | 卡片顶部色块约 190px | 多行筛选加装饰推迟内容 |
| Register | 页面主题与表单标题重复 | 双列表单偏窄 | 首个输入约 y=800px | 首个输入约 y=854px |
| Login | 侧栏视觉比任务更强 | 双列压缩表单 | 首个输入约 y=731px | 首个输入约 y=880px |
| Dashboard | 欢迎区、测试控件抢占首屏 | 固定侧栏使主区变窄 | 课程被提示和装饰推到下方 | 导航文字小、退出仅图标 |
| 404 | 过大的标题和留白 | 桌面导航仍拥挤 | 恢复操作只有回首页 | 标题断行、footer 比恢复内容更重 |

## 评分

以下是同一审查者基于浏览器观察的 1–10 分主观评分，用来说明取舍，不是用户研究结果、Lighthouse 分数或生产认证。8 分表示当前 demo 达到一致、可用的水平；正式内容和真实用户反馈仍缺少。

| 维度 | 原版 | 本轮后 | 依据 |
| --- | ---: | ---: | --- |
| Visual hierarchy | 5 | 8 | 任务内容提前，装饰减量 |
| Typography | 5 | 8 | H1 克制、辅助字号统一 |
| Spacing | 6 | 8 | 共用间距变量、清除冗余覆盖 |
| Layout | 6 | 8 | 桌面、平板、手机采用合适列数 |
| Navigation | 6 | 8 | 当前页、Escape、外部焦点关闭、清楚退出 |
| Consistency | 6 | 8 | 控件、边框、圆角、焦点统一 |
| Accessibility | 7 | 8 | 自动化和全键盘流程通过；未宣称全面认证 |
| Responsive design | 5 | 8 | 表单顺序、手机筛选、平板布局改善 |
| Forms | 6 | 8 | 单一主标题、字段可达、错误纠正与密码切换 |
| Dashboard UX | 5 | 8 | 内容优先、进度可读、准确的只读动作 |
| Content clarity | 5 | 8 | 说明产品与下一步，区分演示和真实服务 |
| Interaction feedback | 6 | 8 | 按压/焦点、筛选计数、重试、状态反馈 |
| Perceived quality | 6 | 8 | 视觉噪声减少，正式内容未批准仍是限制 |

逐页综合参考：Home 5→8、About 6→7、Programs 5→8、Register 5→8、Login 5→8、Dashboard 5→8、404 6→8。About 保留简洁草稿，不编造团队履历或业务成果来“填满”页面。

## 轻量设计系统与代码

`src/styles/global.css` 仍是唯一应用样式入口。顶部统一颜色、8/16/24/32/48px 间距、响应式 section 间距、文字层级、控件/面板圆角、1160px 容器和轻微焦点阴影。按钮、输入框、文字链接、卡片和焦点沿用这些共同规则；没有 UI/CSS 框架。

保留正常 hover、按压 1px、短菜单出现反馈。reduced-motion 关闭动画与过渡。输入保持 16px，常用控件至少 44px，避免手机输入自动放大和难点按的目标。原生 details、select、progress 承担语义，不额外造复杂交互组件。

Dashboard 仍由页面内逻辑调用 `skipCourseApi`，再到 demo adapter；没有把 fixture 移到 JSX。重试状态现在与 URL 一致。页面按需加载 Dashboard，首页不必下载该页面代码。没有新增运行时依赖、字体请求或图片下载。

## Sponsor 演示与 QA 分开

普通 `npm run dev` / `npm run build` 默认隐藏模拟错误与数据状态切换。`VITE_DEMO_TOOLS=true` 仅用于显式本地 QA；`npm test` 自动在独立测试构建中开启。它不是授权、安全或真实后台配置。普通预览即使收到 `scenario=error` 也使用正常 demo 数据。

演示标识、连接尚未完成的说明、无真实账户/报名的边界仍清楚可见。错误文案告诉用户可重试，并保留已填写信息。真实课程、项目上传、profile 编辑没有假按钮。

## 用户流程和最终验证

- A：Home → Programs → 筛选/阅读 → Register → 错误 → 纠正 → 成功 → Login → Dashboard。
- B：Login 校验/失败恢复，以及 Dashboard 的 learning、projects、profile、刷新、退出；课程/项目 disclosure 可使用。
- C：全键盘 Home → 主导航 → Programs 筛选 → Login 填表 → Dashboard → Projects → Logout，四尺寸执行。macOS WebKit 按平台实际使用 Option+Tab 遍历链接。
- 检查 loading、success、empty、error、retry、损坏/禁用存储、长姓名邮箱、减少动画、菜单 Escape/点外部/焦点外移。

最终命令、截图指标和清洁结论见下方完成记录；MVP 历史记录保留在 [QUALITY_REVIEW.md](QUALITY_REVIEW.md)。

## 仍需确认

Tina：Dashboard 顺序、字段、进度定义、学生动作和移动优先级。
Karl / Sponsor：真实 staging API、认证与授权、账户关联/开通、错误契约及 CORS。
Sponsor：品牌、报名/隐私/年龄要求、联系方式及将来的部署决策。
Ayushi：正式 Home/About/Programs 文案、项目细节和批准的图像。

这些是产品/后端决策，不以本轮前端样例冒充已确定的业务需求。真实辅助技术与真实学生测试、生产性能采样仍需后续进行。

## 完成记录

Build、Lint、Typecheck 通过；Playwright 10 个场景 × 4 个浏览器配置，40/40 通过。配置为 1440px Chromium、768px WebKit、390px Chromium、320px Chromium。axe 扫描七个页面，以及 Profile、空/失败状态和无效表单，均未报告所选 WCAG 2 A/AA、2.1 AA 规则违规。测试过程监听 browser console error 和 pageerror。

主页面完成 7×4 的前后截图、首屏比较和全页重点复查；另捕获 4×4 的 loading / empty / error / profile。全部检查未发现横向溢出或运行时异常。默认演示构建额外验证：四尺寸均没有 QA 控件，登录/退出正常，scenario 测试参数不影响普通演示，无外部网络请求、浏览器错误或警告。

| 指标 | 原版 | 本轮后 |
| --- | ---: | ---: |
| 390px login 首个输入距文档顶部 | 731px | 426px |
| 390px register 首个输入距文档顶部 | 800px | 426px |
| 320px login 首个输入距文档顶部 | 880px | 493px |
| 320px register 首个输入距文档顶部 | 854px | 501px |
| 1440px Home 全页高度 | 2619px | 1921px |
| 768px Home 全页高度 | 2811px | 2255px |
| 390px Home 全页高度 | 4056px | 3080px |
| 320px Home 全页高度 | 4279px | 3219px |
| 可见 HTML 辅助文字最低字号 | 约 10px | 14px |
| 公共页面 H1 最大字号 | 约 73px | 52px |

以上位置/高度在同一 Chromium、900px 高度下测量；浏览器字体会影响具体值。页面变短来自移除重复内容，而不是压小字体。截图与检查脚本在仓库外 `/tmp/tala-excellence/`，不是需要维护的应用文件，也不是永久存档。

正常构建的入口 JS 约 291.2kB / gzip 93.0kB；Dashboard 另约 7.8kB / gzip 2.4kB，CSS 24.85kB / gzip 5.80kB。相较原版约 301kB 的单一 JS 入口，优化主要是延迟下载 Dashboard；并非显著减少 React/Router 本身的成本。浏览器请求检查确认公共页面不下载 Dashboard chunk，打开 hub 后才下载。本地 SVG 约 4kB，无外部字体；没有新增依赖。未进行真实生产环境 Core Web Vitals 采样。

清理已移除被删除装饰区的 CSS，以及 17 处无用或冗余的规则/声明。检查未发现应用 console.log、debugger、TODO/FIXME、疑似密钥字面量、空目录或误跟踪产物。README、项目结构说明（现位于 `project/docs/PROJECT_STRUCTURE.md`）与当时的代码对应；src 仍是 assets、components、pages、services、styles 五个目录、26 个源码文件。没有新增空架构层，也未删除用途不明的文件。

`git diff --check` 对本轮 working tree 通过。额外检查 staged 内容时，上游 Skills 的 Markdown 原文存在行尾空格（包括硬换行及示例中的空白）；为保持固定版本原文而保留，不属于本轮应用错误。测试 CLI 的 NO_COLOR / FORCE_COLOR 提示来自终端颜色设置，浏览器端没有对应警告。

最终审查结论：当前范围可用于清楚标注的 Sponsor 前端演示。尚未接通的服务和未经批准的正式内容仍明确标记，不能当作生产认证或上线验收。没有 commit、push、merge、deploy、DNS / GoDaddy / CNAME 修改。
