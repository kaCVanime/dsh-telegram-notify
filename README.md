# dsh-telegram-notify

DeepSeek Harness（DSH）的 Telegram 通知插件。当 agent **任务完成**、**向你提问**、
**请求审批**或**长期目标完成/被阻塞**时，自动给你的 Telegram 发消息。

## 触发时机

| 事件 | 消息 | 开关（默认） |
| --- | --- | --- |
| agent 从运行回到空闲 | ✅ 任务完成（内容取决于通知模式，见下） | `notifyOnIdle`（开） |
| agent 调用 `ask_user_question` | 🔔 需要你的回答（附问题内容） | `notifyOnQuestion`（开） |
| agent 请求工具审批 | 🛡️ 请求审批（附工具名和原因） | `notifyOnApproval`（开） |
| 长期目标完成 / 被阻塞 | 🏁 / ⛔（附目标与原因） | `notifyOnGoal`（开） |
| agent 运行出错 | ⚠️ 错误摘要 | `notifyOnError`（关） |

「任务完成」做了两项降噪：连续运行不足 `minRunSeconds`（默认 30 秒）不通知；
回到空闲后去抖 8 秒（goal 自动续轮、追问等不会重复发）。只有根会话会通知，
子 agent（subagent）结束不会打扰你。

## 通知模式

- **简洁模式**（`mode: "simple"`，默认）：只通知任务结果——✅ 任务完成 + 会话 + 等待输入。
- **复杂模式**（`mode: "complex"`）：在结果之上附带**任务用时**、**token 消耗**
  （输入/输出）与**缓存命中率**（按最后一轮各 step 的 provider 用量汇总）。
- **产出内容**（`sendTaskContent`，默认关）：仅复杂模式下有效。开启后把本轮的
  **最终产出内容**作为单独一条消息一并发送（超长自动截断到 Telegram 上限内）。

## 安装

本插件遵循 DSH 的插件包契约：`package.json` 声明 `dsh.bundle.patch` 指向自带的
bundle 层 `cordis.patch.yml`，通过 `dsh plugin` 安装后自动挂载，无需手工编辑
profile 的补丁文件。

```powershell
# 在本插件源码目录执行（相对路径会以当前目录为锚点）
dsh plugin --profile web add .

# 或从任意目录给出包位置（npm 包名 / github: / file: 路径均可）
dsh plugin --profile web add file:/绝对路径/dsh-telegram-notify
```

`dsh plugin` 会把包交给 pnpm 装进 profile，并自动把声明了 `dsh.bundle` 的包追加到
profile `package.json` 的 `dsh.profile.bundles` 层列表——之后每次启动，bundle 层的
insert 行负责挂载插件，你的 profile `cordis.patch.yml` 只需放个人配置覆盖。

> 开发提示：`file:` 依赖是安装时打包复制的，改了源码要重新 `dsh plugin add` 才会生效；
> 想在源码目录里边改边用，可以用 `dsh plugin --profile web add link:<路径>`（符号链接）。
> 卸载：`dsh plugin --profile web remove dsh-telegram-notify`（reconcile 会自动把它移出
> bundles 列表）。

## 配置

插件自带浏览器端卡片：打开 **设置 > 插件 > 插件配置**，「Telegram 通知」卡片里
可直接编辑全部配置项——bot token（只写密码框）、chatId、API 地址、代理、
**通知模式（简洁/复杂）**、**附带产出内容**、最短运行秒数和各个通知开关，
**保存后即时生效，无需重启**。卡片走的是与官方插件相同的机制：
`settings.plugin.item` slot + `settingsScope` 客户端服务 + `settings.mutate` 写入。
token 字段在 schema 声明为 `role('secret')`，界面只写不读，不会回传明文。

配置优先级（高 → 低）：设置页（写入 `%USERPROFILE%\.dsh\settings.yaml` 的
`telegram-notify` 命名空间）> profile `cordis.patch.yml` 的 config > 环境变量
`TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` > schema 默认值。

首次配置步骤：

1. 在 Telegram 找 **@BotFather** 创建 bot，拿到 token。
2. 给你的 bot 随便发一条消息，再找 **@userinfobot**（或访问
   `https://api.telegram.org/bot<token>/getUpdates`）拿到你的 chat id。
3. 在 **设置 > 插件 > 插件配置 > telegram-notify** 填入 token / chatId（国内网络
   一并填 `proxy`）；也可以改在 profile 的 `cordis.patch.yml`：

   ```yaml
   - id: telegram-notify
     config:
       token: "123456:ABC..."
       chatId: "123456789"
       proxy: "http://127.0.0.1:7890"
   ```

   注意：DSH 的 patch config 是**整段替换**而非深度合并，覆盖时请带上你要设置的全部
   字段；未列出的字段走插件 Config schema 的默认值。
4. **重启 DSH**（关闭后重新 `dsh web`）。插件只在启动时加载。
5. 启动成功会收到「🚀 DSH Telegram 通知已上线」，收不到就看 DSH 日志里
   `telegram-notify` 的警告。也可以用 `dsh --profile web --dump-config` 检查组合后的
   插件树中本插件的配置是否符合预期。

### 完整配置项

```yaml
- id: telegram-notify
  config:
    token: "123456:ABC..."        # 或环境变量 TELEGRAM_BOT_TOKEN（secret，设置页只写）
    chatId: "123456789"           # 或环境变量 TELEGRAM_CHAT_ID
    apiBase: "https://api.telegram.org"  # 可换成自己的反代
    proxy: "http://127.0.0.1:7890"       # 国内网络按需设置（http 代理）
    mode: "simple"                # simple=只报结果；complex=附耗时/token/缓存命中率
    sendTaskContent: false        # 复杂模式下，是否附带本轮最终产出内容
    minRunSeconds: 30             # 运行不足此时长不通知
    notifyOnIdle: true
    notifyOnQuestion: true
    notifyOnApproval: true
    notifyOnGoal: true
    notifyOnError: false
    sendStartupMessage: true
```

### 国内网络

`api.telegram.org` 在国内不可直连。两种方式任选：

- 设置 `proxy`（或环境变量 `HTTPS_PROXY`）为你的本地 http 代理；
- 或把 `apiBase` 改成自建/第三方反代地址。

## 原理

DSH 基于 cordis 插件系统。本插件在根上下文监听：

- `agent/status`（running→idle 判定任务完成，用 `ctx.agents.roots()` 过滤子 agent）
- `goal/changed`（phase 为 completed / blocked）
- `agent/error`

并包装 `ctx.userQuestions.ask` 与 `ctx.approval.request` 两个服务方法，
在转发给原实现前先发一条 Telegram 消息。

配置通过官方 `installSettingsSection`（`@deepseek-ai/dsh-settings`）接入设置服务：
组合配置作为 base 层，设置文档的 `telegram-notify` namespace 覆盖其上，
`scope.watch` 让设置页编辑即时生效。token 用量与产出内容从
`agent.session.events` 的最后一轮 `assistant/message` 事件汇总
（`usage.inputTokens / outputTokens / cacheReadTokens`，文本取最后一条 text block）。

通知全部 fire-and-forget，失败只写日志，绝不影响 agent 主流程。
