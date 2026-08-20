// dsh-telegram-notify — DeepSeek Harness 的 Telegram 通知插件。
//
// 触发时机：
//   1. agent 从 running 回到 idle（任务完成 / 等待你输入）——带 8 秒去抖，
//      goal 自动续轮不会重复打扰；短于 minRunSeconds 的普通问答不通知。
//      简洁模式只报结果；复杂模式附带耗时、token 消耗、缓存命中率，
//      可选把本轮最终产出内容一并发来。
//   2. agent 调用 ask_user_question（需要你回答问题）。
//   3. agent 请求工具审批（approval/request）。
//   4. 长期目标（goal）完成或被阻塞。
//   5. agent/error（可选，默认关闭）。
//
// 配置优先级（高 -> 低）：设置 > 插件 > 插件配置（写入 settings.yaml）
//   > profile cordis.patch.yml 的 config > 环境变量 > schema 默认值。
//   设置页改动即时生效，无需重启。
//
// 通知失败只会写日志，绝不影响 agent 主流程。

import z from '@deepseek-ai/schemastery'

export const name = 'telegram-notify'

export const Config = z.object({
  token: z.string().role('secret').default('').description('Telegram bot token（@BotFather 发放），也可用环境变量 TELEGRAM_BOT_TOKEN'),
  chatId: z.string().default('').description('接收消息的 chat id（@userinfobot 可查），也可用环境变量 TELEGRAM_CHAT_ID'),
  apiBase: z.string().default('https://api.telegram.org').description('Bot API 地址，可换成自建反代'),
  proxy: z.string().default('').description('HTTP 代理，如 http://127.0.0.1:7890（api.telegram.org 不可直连时必填）'),
  mode: z.union(['simple', 'complex']).default('simple').description('通知模式：simple 只报任务结果；complex 附带耗时、token 消耗与缓存命中率'),
  sendTaskContent: z.boolean().default(false).description('复杂模式下，是否把本轮任务的最终产出内容一并发送'),
  minRunSeconds: z.number().min(0).default(30).description('agent 连续运行不足该秒数时不发「任务完成」通知'),
  notifyOnIdle: z.boolean().default(true).description('任务完成（agent 回到空闲）时通知'),
  notifyOnQuestion: z.boolean().default(true).description('agent 向你提问时通知'),
  notifyOnApproval: z.boolean().default(true).description('agent 请求审批时通知'),
  notifyOnGoal: z.boolean().default(true).description('长期目标完成或被阻塞时通知'),
  notifyOnError: z.boolean().default(false).description('agent 运行出错时通知'),
  sendStartupMessage: z.boolean().default(true).description('DSH 启动时发送一条上线自检消息'),
})

const SETTINGS_NAMESPACE = 'telegram-notify'
const TG_MESSAGE_LIMIT = 4096
const CONTENT_BUDGET = 3800

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const trunc = (s, n) => {
  s = String(s ?? '')
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

const fmtInt = (n) => Math.max(0, Math.round(n)).toLocaleString('en-US')

function fmtDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} 秒`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} 分 ${s % 60} 秒`
  return `${Math.floor(m / 60)} 小时 ${m % 60} 分`
}

/**
 * 从会话事件流汇总最后一轮的 token 用量与最终产出文本。
 * assistant/message 事件按 turn/step 携带 usage：
 * { inputTokens, outputTokens, cacheReadTokens?, cacheWriteTokens? }，
 * 其中 inputTokens 为未命中缓存的输入，cacheReadTokens 为命中部分。
 */
function turnStats(agent) {
  try {
    const events = agent?.session?.events
    if (!Array.isArray(events) || events.length === 0) return null
    const lastTurn = events.findLast?.((e) => e?.type === 'turn/start')?.data?.turn
    if (lastTurn === undefined) return null
    let input = 0
    let output = 0
    let cacheRead = 0
    let cacheWrite = 0
    let hasUsage = false
    let lastText = ''
    for (const e of events) {
      if (e?.type !== 'assistant/message' || e?.data?.turn !== lastTurn) continue
      const u = e.data.usage
      if (u) {
        hasUsage = true
        input += u.inputTokens ?? 0
        output += u.outputTokens ?? 0
        cacheRead += u.cacheReadTokens ?? 0
        cacheWrite += u.cacheWriteTokens ?? 0
      }
      const blocks = e.data.message?.content
      if (Array.isArray(blocks)) {
        const text = blocks
          .filter((b) => b?.type === 'text')
          .map((b) => b?.text ?? '')
          .join('\n')
          .trim()
        if (text) lastText = text
      }
    }
    const promptTotal = input + cacheRead
    const hitRate = promptTotal > 0 ? cacheRead / promptTotal : null
    return { hasUsage, input, output, cacheRead, cacheWrite, hitRate, lastText }
  } catch {
    return null
  }
}

export function apply(ctx, config = {}) {
  const logger = ctx.logger('telegram-notify')

  // ---- 设置服务（设置 > 插件 > 插件配置） --------------------------------
  // 官方规范接法：组合配置作为 base 层，设置文档的同名 namespace 覆盖其上，
  // 改动即时生效；服务缺席（旧 Host / headless）时回落到组合配置。
  let current = () => config
  import('@deepseek-ai/dsh-settings')
    .then(({ installSettingsSection }) => {
      installSettingsSection(ctx, SETTINGS_NAMESPACE, Config, config, {
        setSource: (source) => {
          current = source
        },
        onChange: () => {
          logger.info('telegram-notify: 设置已更新并即时生效')
        },
      })
    })
    .catch((error) => {
      logger.warn(
        'telegram-notify: 设置服务不可用，使用组合配置: %s',
        error?.message ?? error,
      )
    })

  const cfg = () => current()
  const resolveToken = () => cfg().token || process.env.TELEGRAM_BOT_TOKEN || ''
  const resolveChatId = () => cfg().chatId || process.env.TELEGRAM_CHAT_ID || ''

  // ---- Telegram 发送通道 -------------------------------------------------
  // dispatcher 按代理地址缓存：设置页改代理后自动重建。
  const dispatchers = new Map()
  function dispatcherFor(proxyUrl) {
    if (!proxyUrl) return Promise.resolve(undefined)
    if (!dispatchers.has(proxyUrl)) {
      dispatchers.set(
        proxyUrl,
        import('undici')
          .then(({ ProxyAgent }) => {
            logger.info('telegram-notify: 通过代理发送 %s', proxyUrl)
            return new ProxyAgent(proxyUrl)
          })
          .catch((error) => {
            logger.warn(
              'telegram-notify: 代理初始化失败，改为直连: %s',
              error?.message ?? error,
            )
            return undefined
          }),
      )
    }
    return dispatchers.get(proxyUrl)
  }

  async function send(text) {
    const token = resolveToken()
    const chatId = resolveChatId()
    if (!token || !chatId) {
      logger.warn(
        'telegram-notify: 未配置 token/chatId（设置页、组合配置或环境变量 ' +
          'TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID），跳过发送',
      )
      return
    }
    const c = cfg()
    const proxyUrl =
      c.proxy || process.env.HTTPS_PROXY || process.env.https_proxy || ''
    const dispatcher = await dispatcherFor(proxyUrl)
    const url = `${c.apiBase.replace(/\/+$/, '')}/bot${token}/sendMessage`
    const body = JSON.stringify({
      chat_id: chatId,
      text: trunc(text, TG_MESSAGE_LIMIT),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    })
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          signal: AbortSignal.timeout(15000),
          ...(dispatcher ? { dispatcher } : {}),
        })
        if (!res.ok) {
          const detail = trunc(await res.text().catch(() => ''), 200)
          throw new Error(`HTTP ${res.status}: ${detail}`)
        }
        return
      } catch (error) {
        if (attempt === 2) {
          logger.warn('telegram-notify: 发送失败: %s', error?.message ?? error)
        } else {
          await new Promise((r) => setTimeout(r, 3000))
        }
      }
    }
  }

  // fire-and-forget；send 内部已捕获所有异常
  const fire = (text) => {
    Promise.resolve()
      .then(() => send(text))
      .catch(() => {})
  }

  // ---- 通用辅助 ----------------------------------------------------------
  function isRootAgent(agent) {
    try {
      const reg = ctx.get('agents')
      if (reg && typeof reg.roots === 'function') return reg.roots().includes(agent)
    } catch {
      /* 服务不可用时按根 agent 处理 */
    }
    return true
  }

  const sessionLabel = (agent) => {
    try {
      return agent?.id ?? 'unknown'
    } catch {
      return 'unknown'
    }
  }

  // ---- 1) 任务完成：running -> idle（8 秒去抖 + 最短运行时长）------------
  {
    const runningSince = new Map() // agent -> 开始运行的时刻（跨去抖间隙累计）
    const pending = new Map() // agent -> 待发送的 idle 通知定时器
    ctx.on('agent/status', ({ agent, status }) => {
      try {
        if (!cfg().notifyOnIdle) return
        if (status === 'running') {
          const t = pending.get(agent)
          if (t) {
            clearTimeout(t)
            pending.delete(agent)
          }
          if (!runningSince.has(agent)) runningSince.set(agent, Date.now())
          return
        }
        if (status !== 'idle') return
        const started = runningSince.get(agent)
        if (started === undefined) return
        if (!isRootAgent(agent)) {
          runningSince.delete(agent)
          return
        }
        const t = setTimeout(() => {
          pending.delete(agent)
          runningSince.delete(agent)
          const c = cfg()
          const dur = Date.now() - started
          if (dur < c.minRunSeconds * 1000) return
          const sid = esc(sessionLabel(agent))
          if (c.mode !== 'complex') {
            // 简洁模式：只通知任务结果
            fire(
              `✅ <b>DeepSeek Harness 任务完成</b>\n` +
                `会话：<code>${sid}</code>\n` +
                `等待你的输入。`,
            )
            return
          }
          // 复杂模式：结果 + 耗时 + token 消耗 + 缓存命中率（+ 可选产出内容）
          const stats = turnStats(agent)
          const lines = [
            `✅ <b>DeepSeek Harness 任务完成</b>`,
            `会话：<code>${sid}</code>`,
            `本轮耗时：${fmtDuration(dur)}`,
          ]
          if (stats?.hasUsage) {
            const hit =
              stats.hitRate === null ? '—' : `${Math.round(stats.hitRate * 100)}%`
            lines.push(
              `Token：输入 ${fmtInt(stats.input + stats.cacheRead)}` +
                `（缓存命中 ${hit}）/ 输出 ${fmtInt(stats.output)}`,
            )
          } else {
            lines.push('Token：本轮无用量数据')
          }
          lines.push('等待你的输入。')
          fire(lines.join('\n'))
          if (c.sendTaskContent && stats?.lastText) {
            fire(
              `📄 <b>本轮产出内容</b>（会话 <code>${sid}</code>）\n` +
                `${esc(trunc(stats.lastText, CONTENT_BUDGET))}`,
            )
          }
        }, 8000)
        pending.set(agent, t)
      } catch (error) {
        logger.warn('telegram-notify: agent/status 处理异常: %s', error?.message ?? error)
      }
    })
  }

  // ---- 2/3) 包装 userQuestions.ask 与 approval.request -------------------
  // 服务由 dsh-base bundle 注册，理论上先于本插件就绪；仍做 60 秒重试兜底。
  const restores = []
  const wrapped = new Set()

  function tryWrap() {
    if (!wrapped.has('userQuestions')) {
      const svc = ctx.get('userQuestions')
      const orig = svc?.ask
      if (svc && typeof orig === 'function') {
        svc.ask = async function (req) {
          try {
            if (cfg().notifyOnQuestion) {
              const qs = Array.isArray(req?.questions) ? req.questions : []
              const lines = qs.map((q, i) => {
                const head = q?.header ? `<b>${esc(trunc(q.header, 80))}</b> ` : ''
                return `${i + 1}. ${head}${esc(trunc(q?.question ?? q?.id ?? '', 300))}`
              })
              fire(
                `🔔 <b>DeepSeek Harness 需要你的回答</b>\n` +
                  `会话：<code>${esc(sessionLabel(req?.agent))}</code>\n` +
                  (lines.length ? lines.join('\n') : '有一个问题等待你确认。'),
              )
            }
          } catch {
            /* 通知失败不阻塞提问 */
          }
          return orig.call(this, req)
        }
        restores.push(() => {
          svc.ask = orig
        })
        wrapped.add('userQuestions')
      }
    }
    if (!wrapped.has('approval')) {
      const svc = ctx.get('approval')
      const orig = svc?.request
      if (svc && typeof orig === 'function') {
        svc.request = async function (req) {
          try {
            if (cfg().notifyOnApproval) {
              fire(
                `🛡️ <b>DeepSeek Harness 请求审批</b>\n` +
                  `会话：<code>${esc(sessionLabel(req?.agent))}</code>\n` +
                  `工具：<code>${esc(trunc(req?.toolName, 100))}</code>` +
                  (req?.reason ? `\n原因：${esc(trunc(req.reason, 300))}` : ''),
              )
            }
          } catch {
            /* 通知失败不阻塞审批 */
          }
          return orig.call(this, req)
        }
        restores.push(() => {
          svc.request = orig
        })
        wrapped.add('approval')
      }
    }
    return wrapped.has('userQuestions') && wrapped.has('approval')
  }

  ctx.effect(function* () {
    let timer
    let timeout
    if (!tryWrap()) {
      timer = setInterval(() => {
        if (tryWrap()) {
          clearInterval(timer)
          clearTimeout(timeout)
        }
      }, 2000)
      timeout = setTimeout(() => clearInterval(timer), 60000)
    }
    yield () => {
      if (timer) clearInterval(timer)
      if (timeout) clearTimeout(timeout)
      for (const restore of restores.splice(0)) {
        try {
          restore()
        } catch {
          /* ignore */
        }
      }
    }
  })

  // ---- 4) 长期目标完成 / 阻塞 -------------------------------------------
  ctx.on('goal/changed', ({ agent, change }) => {
    try {
      if (!cfg().notifyOnGoal) return
      const goal = change?.goal
      const phase = goal?.phase
      if (phase !== 'completed' && phase !== 'blocked') return
      if (!isRootAgent(agent)) return
      const done = phase === 'completed'
      const reason = goal?.blockedReason ?? goal?.blocked_reason
      fire(
        `${done ? '🏁' : '⛔'} <b>DeepSeek Harness 长期目标${done ? '已完成' : '被阻塞'}</b>\n` +
          `会话：<code>${esc(sessionLabel(agent))}</code>\n` +
          `目标：${esc(trunc(goal?.objective, 300))}` +
          (reason ? `\n原因：${esc(trunc(reason, 300))}` : ''),
      )
    } catch (error) {
      logger.warn('telegram-notify: goal/changed 处理异常: %s', error?.message ?? error)
    }
  })

  // ---- 5) agent 错误（默认关闭） ----------------------------------------
  ctx.on('agent/error', ({ agent, error }) => {
    try {
      if (!cfg().notifyOnError) return
      if (!isRootAgent(agent)) return
      fire(
        `⚠️ <b>DeepSeek Harness 运行出错</b>\n` +
          `会话：<code>${esc(sessionLabel(agent))}</code>\n` +
          esc(trunc(error?.message ?? error, 300)),
      )
    } catch {
      /* ignore */
    }
  })

  // ---- 上线自检 ----------------------------------------------------------
  // 延迟几秒发出，让设置服务先接管配置来源。
  setTimeout(() => {
    if (cfg().sendStartupMessage) {
      fire(
        `🚀 <b>DSH Telegram 通知已上线</b>\n` +
          `任务完成、需要你回答或审批时，会在这里提醒你。\n` +
          `当前模式：${cfg().mode === 'complex' ? '复杂' : '简洁'}`,
      )
    }
  }, 3000)

  logger.info('telegram-notify: 已启用')
}
