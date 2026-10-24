# BKMS 插件中心

独立插件 `@bkms/plugin-center`（0.2.0），源码目录 `sources/plugins/dsh-plugins/bkms-plugin-center`。以 DSH 官方 ui-plugin-manager 页面为基础，增加 BKMS 中心目录、后台安装与按分发规则的自动安装 / 升级。配套中心服务为 `sources/cloud/dsh-plugin-center`（0.5.0）。

## 入口和共存

- 左侧独立入口 **BKMS 插件中心**，顶部分段切换 **已安装插件 / BKMS 插件**；有可更新插件时 “BKMS 插件” 旁显示数量。
- 官方“插件”入口继续存在。独立 panel ID `bkms-plugin-center`、locale `bkmsPluginCenter`、CSS 标签与存储键；不提供或覆盖官方 pluginNavigation 服务。
- 已安装插件页复用官方页面；配置视图使用独立的 `bkmsPlugins.*` 插槽，订阅并镜像官方配置贡献，不写入官方 `plugins.*` 插槽。
- 所有页面查看同一 Profile 的真实插件；安装、启用、卸载只由官方 `pluginManager` 执行，不另起 pnpm。

## BKMS 插件页

- 卡片网格，支持搜索与 “全部 / 可更新 / 已安装 / 未安装” 筛选；卡片显示启用状态、可更新版本、缺少发布包。
- 点击 “安装 / 更新” 不弹出原生安装窗口：DSH 后台下载中心发布的 `.tgz`，校验大小、SHA256、包名、版本与完整清单，再调用 `pluginManager.installBundle('file:…/SHA256.tgz')` 安装。新安装即启用，升级保持原启用状态。
- 卡片显示进度：排队中 → 正在下载（百分比与字节数）→ 正在安装依赖（官方安装器最新一行输出）→ 正在启用 → 已安装 / 已更新；失败时在卡片上显示原因并可重试。
- 手动安装与自动安装共用一个串行队列，不会同时修改 Profile。
- 只安装中心上传的固定版本包；没有包的条目不可安装。需要批准安装脚本的插件，仍需在官方“插件”页手工安装一次。

## 自动安装与升级

DSH 后端定时读取中心 `distribution-v2.json`（带 ETag），只处理已发布规则中的插件：

| 规则 | 客户端行为 |
| --- | --- |
| 自动维护（automatic） | 缺失时安装并启用；本插件装过、之后被用户卸载的不再补装 |
| 强制维护（required） | 缺失时补装并启用（本版本不阻止用户卸载或停用） |
| 手工管理（manual） | 未安装时不处理 |
| 自动升级（autoUpgrade） | 本机版本低于目标版本时升级，不论原来源；不降级；保持原启用状态 |

- 时机：`sync.startup` 启动约 10 秒后检查；`sync.periodic` 按规则中最短的 `intervalMinutes` 定时检查，读取失败时退避（最长 1 小时）；设置页可立即检查。
- 执行：一律在后台直接安装，不需要用户确认（旧规则的 `execution=confirm` 按直接安装处理）。
- 失败：单个插件失败后间隔 `retry.delaySeconds`（默认 300 秒）再试，连续 `retry.maxFailures`（默认 3）次暂停；发布新规则版本或点击重试后恢复，不影响其他插件。
- 保护：Profile 的 `node_modules/<包名>` 若是指向 Profile 外、且未声明为依赖的残留链接（常见于之前用本地目录开发安装），不调用 pnpm，直接提示删除链接，避免写入源码目录。bkms-market 的旧自动同步仍开启时暂停执行并提示。市场与 `@deepseek-ai/` 基础包不处理。
- 暂不执行：`forceRemove`（明确卸载）、变更通知推送。

## 安装后的提示

安装本身不提醒，只在需要时提示：

- 生效方式取自目标版本的 `restart.mode`：`none` 不提示；`reload` 提示刷新界面（用户点击刷新）；`restart` 提示完全退出 DSH 后重新打开；`auto` 在官方结果为 applied 时提示刷新。
- 官方返回 `restart-required`，或升级插件中心自身（每轮最后执行）时，总是提示重启。
- 官方 DSH 桌面端没有页面可调用的重启接口，不会自动重启。提示挂在全局 `shell.overlay`，任意页面可见。

## 设置

“DSH 设置 → BKMS 插件中心”分两组：

- 常规：在侧栏显示入口（隐藏不影响插件使用）、中心地址。
- 自动更新：自动安装和升级开关、检查时间与立即检查、规则中每个插件的版本与状态（失败可重试）、最近执行记录。

中心地址优先级：设置页保存（`DSH_HOME/bkms-plugin-center/config.json`）> Profile 插件配置 `center` > 默认 `https://118.145.114.8/plugin-center/plugins.json`。旧版保存在浏览器中的地址在首次连接时迁移到后端。Profile 预置示例：

```yaml
- insert:
    - id: bkms-plugin-center
      name: '@bkms/plugin-center'
      config:
        center: https://plugins.company.example/plugins.json
        autoSync: true
```

## 数据与接口

- 包缓存：`DSH_HOME/bkms-plugin-center/packages/SHA256.tgz`（未设置 `DSH_HOME` 时为用户目录 `.dsh`）。缓存不是安装目录，实际安装写入当前 Profile。
- 同步状态：Profile 目录 `.bkms-plugin-center/sync-state.json`（失败次数、已托管标记、最近 30 条执行记录）。
- 后端接口（同源；POST 需 JSON 请求体，避免跨站触发）：

| 接口 | 用途 |
| --- | --- |
| GET /api/bkms-plugin-center/catalog | 读取中心目录 |
| GET / POST /api/bkms-plugin-center/config | 读取 / 保存中心地址与自动更新开关 |
| GET /api/bkms-plugin-center/sync?since=毫秒 | 同步状态、规则中的插件、安装进度 `progress`、刷新 / 重启提示 |
| POST /api/bkms-plugin-center/sync/check | 立即检查并执行 |
| POST /api/bkms-plugin-center/sync/install `{plugin}` | 按目录条目 url 后台安装或更新，立即返回 |
| POST /api/bkms-plugin-center/sync/retry `{name}` | 清除失败计数并重试 |

需要中心服务 0.5.0（生效方式 none / reload / restart）；0.4.0 的 auto / required 仍兼容。

## 构建、测试与预览

需要当前工作区已准备依赖的 deepseek-harness checkout（构建工具与 CSS 编译）。

```powershell
npm run build
npm test
npm pack
```

在 DSH 原生“插件”页添加生成的 `bkms-plugin-center-0.2.0.tgz`，完全退出并重启。开发时也可用 `link:` 指向本目录，修改后重新构建并重启 DSH。

本地 UI 预览（示例数据，不连接真实中心或 DSH）：`node scripts/build-ui-preview.mjs [输出目录]`，默认输出到系统临时目录 `bkms-plugin-center-preview`，用任意静态服务打开 `index.html`；`?dark=1` 深色、`?view=settings` 设置页、`?empty=1` 空目录。

## 上游

UI 基于 deepseek-harness commit `46a7f68b0922371ce7144b668b90e377d8e799f4`（dsh-v0.1.7-rc.1）的 `packages/client/ui-plugin-manager/src/client`，保留 MIT LICENSE，未修改官方源码。需要提供 `remote.pluginManager`、`remote.pluginInventory`、`configForms` 与插件页面 slots 的 DSH 宿主；后端需要宿主的 `pluginManager`、`profileContext` 与 `webServer` 服务。

## 版本历史

- 0.2.0：后台自动安装 / 升级（第二版分发规则）；BKMS 插件页后台直接安装并在卡片显示进度；安装后按需提示刷新或重启；残留链接保护；中心地址保存到 DSH 后端；界面与设置页重做；“中心插件”改名为 “BKMS 插件”。
- 0.1.4：中心插件页去掉重复的地址输入，统一使用设置页地址。
- 0.1.3：增加设置菜单（侧栏入口开关、中心地址、读取第二版策略）。
- 0.1.2：中心插件只安装服务端上传的固定版本包，不再回退 npm / GitHub。
- 0.1.1：安装完成提示启用、卡片显示本机版本与启用状态、不再按测速自动切换镜像。
- 0.1.0：基于官方插件管理页的独立 BKMS 插件中心。
