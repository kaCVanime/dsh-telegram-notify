# dsh-telegram-notify

Telegram notifications for DeepSeek Harness (DSH). Get a message when an agent
**finishes a task**, **needs an answer**, **asks for approval**, or when a
**long-running goal completes or gets blocked**.

## Changes

- **Fixed: nothing was sent when a proxy was configured.** Node's built-in
  `fetch` rejects a dispatcher from the npm `undici` package
  (`UND_ERR_INVALID_ARG`), so the plugin now uses `undici`'s own `fetch`
  together with its `ProxyAgent`.
- **Fixed: the settings card did nothing.** The namespace is registered through
  the real API (`ctx.inject(['settings'])` + `settings.installSection`) now, so
  settings-page edits actually apply.
- **Fewer false alarms.** Approvals and questions are read from DSH's
  `approval/request` and `user-questions/request` waterfalls, so approvals DSH
  rejects by itself and questions that get discarded no longer notify.
- **Fixed: blocked goals showed `[object Object]`** instead of the reason.
- **Fixed: a configured proxy could silently be ignored.** `undici` is a
  declared dependency now, loaded only when a proxy is set.
- **Install with `file:` or `link:`.** A bare path (`add .`) makes pnpm symlink
  the checkout without installing its dependencies, which stops DSH from
  starting.
- The startup message is no longer re-sent after a hot reload.

## When it notifies

| Event | Message | Switch (default) |
| --- | --- | --- |
| Agent goes from running to idle | ✅ Task finished (content depends on the mode) | `notifyOnIdle` (on) |
| Agent calls `ask_user_question` | 🔔 Your answer is needed (with the question) | `notifyOnQuestion` (on) |
| Agent requests tool approval | 🛡️ Approval requested (with tool and reason) | `notifyOnApproval` (on) |
| Long-running goal completes / gets blocked | 🏁 / ⛔ (with the goal and reason) | `notifyOnGoal` (on) |
| Agent run fails | ⚠️ Error summary | `notifyOnError` (off) |

"Task finished" is deliberately quiet: runs shorter than `minRunSeconds`
(default 30 seconds) are skipped, and an 8-second debounce after going idle
stops goal auto-continuation from sending a second message. Only root sessions
notify, so a subagent finishing won't ping you.

## Notification modes

- **Simple** (`mode: "simple"`, default): just the result — ✅ task finished,
  session, waiting for you.
- **Complex** (`mode: "complex"`): adds **duration**, **token usage**
  (input/output) and **cache hit rate**, summed over the last turn's steps.
- **Task output** (`sendTaskContent`, off by default): complex mode only. Sends
  the turn's final output as a second message, truncated to Telegram's limit.

## Install

The package follows DSH's plugin contract: `package.json` declares
`dsh.bundle.patch` pointing at its own `cordis.patch.yml`, so installing it
mounts it automatically — you never edit a profile patch file by hand.

Give pnpm an explicit `file:` (or `link:`) prefix. A bare directory path such as
`add .` is recorded as a symlink **without installing the plugin's
dependencies**, and DSH then fails to start with
`Cannot find package '@deepseek-ai/schemastery'`.

```powershell
# from the plugin checkout: file: copies the package and its dependencies in
dsh plugin --profile web add file:.

# or from anywhere (path / npm name / github:)
dsh plugin --profile web add file:/absolute/path/dsh-telegram-notify
```

Running DSH through npx? Prefix the same command with npx:
`npx --yes @deepseek-ai/dsh plugin --profile web add file:.`

`dsh plugin` hands the package to pnpm inside the profile, then appends anything
that declares `dsh.bundle` to `dsh.profile.bundles` in the profile's
`package.json`. Every start after that mounts the plugin; your profile
`cordis.patch.yml` only holds personal config.

Developing the plugin itself? Link it so edits apply on the next restart — but
install the checkout's dependencies first, or you hit the error above:

```powershell
cd <plugin checkout>
pnpm install
dsh plugin --profile web add link:<absolute path>
```

Uninstall: `dsh plugin --profile web remove dsh-telegram-notify`.

## Configure

The plugin adds a card under **Settings > Plugins > Plugin configuration** where
you can edit everything: bot token (write-only password field), chat ID, API
base, proxy, notification mode, task output, minimum run seconds and each
switch. **Changes take effect immediately — no restart needed.** The token is
declared `role('secret')` and is never sent back to the browser.

Precedence, highest first: settings page (the `telegram-notify` namespace in
`~/.dsh/settings.yaml`) > profile `cordis.patch.yml` config >
`TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` environment variables > schema
defaults.

First-time setup:

1. Create a bot with **@BotFather** and copy its token.
2. Send your bot any message, then read your chat ID from **@userinfobot** (or
   `https://api.telegram.org/bot<token>/getUpdates`).
3. Enter token and chat ID in **Settings > Plugins > Plugin configuration >
   telegram-notify** — add `proxy` too if your network can't reach Telegram. Or
   set them in the profile's `cordis.patch.yml`:

   ```yaml
   - id: telegram-notify
     config:
       token: "123456:ABC..."
       chatId: "123456789"
       proxy: "http://127.0.0.1:7890"
   ```

   DSH patch config **replaces the whole config object** instead of
   deep-merging, so include every field you care about; the rest fall back to
   schema defaults.

4. **Restart DSH** (`dsh web`, or `npx --yes @deepseek-ai/dsh web` if that's how
   you run it). The plugin loads at startup.
5. Success looks like a "🚀 DSH Telegram notify is online" message. If it
   doesn't arrive, check the DSH log for `telegram-notify` warnings, or inspect
   the composed tree with `dsh --profile web --dump-config`.

### All options

```yaml
- id: telegram-notify
  config:
    token: "123456:ABC..."      # or TELEGRAM_BOT_TOKEN (secret, write-only in the UI)
    chatId: "123456789"         # or TELEGRAM_CHAT_ID
    apiBase: "https://api.telegram.org"  # point at your own reverse proxy if you prefer
    proxy: "http://127.0.0.1:7890"       # HTTP proxy; needed where Telegram is blocked
    mode: "simple"              # simple = result only; complex = + duration/tokens/cache
    sendTaskContent: false      # complex mode: also send the turn's final output
    minRunSeconds: 30           # don't notify for runs shorter than this
    notifyOnIdle: true
    notifyOnQuestion: true
    notifyOnApproval: true
    notifyOnGoal: true
    notifyOnError: false
    sendStartupMessage: true
```

### If Telegram is blocked

`api.telegram.org` is unreachable from some networks. Either set `proxy` (or
`HTTPS_PROXY`) to your local HTTP proxy — the plugin loads `undici`'s
`ProxyAgent` on demand, because Node's built-in `fetch` can't take a proxy — or
point `apiBase` at your own reverse proxy.

## How it works

DSH is built on the cordis plugin system. The plugin listens on the root
context:

- `agent/status` — running → idle means a task finished (subagents are filtered
  out with `ctx.agents.roots()`)
- `goal/changed` — phase `completed` or `blocked`
- `agent/error`
- `user-questions/request` and `approval/request` — DSH's waterfalls, dispatched
  when a human is really being asked. The listener sends the message and calls
  `next()` to hand the request to the real answerer (the DSH UI), which is why
  discarded questions and auto-rejected approvals never notify. `ctx.on` is an
  effect, so unloading cancels it automatically.

Settings use `ctx.inject(['settings'])` + `settings.installSection`: the
composition config is the base layer, the settings document's `telegram-notify`
namespace overrides it, and changes are picked up live. Token usage and task
output are read from the last turn's `assistant/message` events in
`agent.session.events` (`usage.inputTokens / outputTokens / cacheReadTokens`;
the text is the last text block).

Notifications are fire-and-forget: a failure is logged and never blocks the
agent.
