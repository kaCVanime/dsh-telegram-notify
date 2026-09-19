// Smoke test with a fake cordis ctx, fake settings service and stubbed fetch.
// Run with cwd = the web profile dir so bare specifiers resolve:
//   cd %USERPROFILE%\.dsh\profiles\web
//   node <plugin-dir>\smoke.test.mjs
const sent = []
globalThis.fetch = async (url, opts) => {
  sent.push(JSON.parse(opts.body).text)
  return { ok: true, text: async () => '' }
}

const listeners = {}

// ---- fake session events：最后一轮 2 个 step，带 usage 与产出文本 --------
const agent = {
  id: 'session-test-123',
  session: {
    events: [
      { type: 'turn/start', data: { turn: 1 } },
      {
        type: 'assistant/message',
        data: {
          turn: 1, step: 1,
          message: { content: [{ type: 'text', text: '第一步中间输出' }] },
          usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 3000, cacheWriteTokens: 0 },
        },
      },
      {
        type: 'assistant/message',
        data: {
          turn: 1, step: 2,
          message: { content: [{ type: 'text', text: '最终产出：插件已完成并通过测试。' }] },
          usage: { inputTokens: 500, outputTokens: 300, cacheReadTokens: 500 },
        },
      },
      { type: 'turn/end', data: { turn: 1 } },
    ],
  },
}

// ---- fake settings 服务：模拟设置页的注册/读取/热更新 --------------------
const watchers = new Set()
let settingsValue
let pluginConfigSchema
const fakeSettings = {
  installSection(owner, ns, schema, entry, hooks) {
    pluginConfigSchema = schema
    settingsValue = schema(entry)
    const scope = {
      get: () => settingsValue,
      watch: (cb) => { watchers.add(cb); return () => watchers.delete(cb) },
    }
    hooks.setSource(() => scope.get())
    scope.watch(() => hooks.onChange())
  },
}
// 模拟「设置 > 插件 > 插件配置」里的编辑：改值并通知 watcher
const settingsEdit = async (patch) => {
  settingsValue = pluginConfigSchema({ ...settingsValue, ...patch })
  for (const cb of watchers) cb()
}

const runEffect = (fn) => {
  // 既支持生成器 effect，也支持返回 disposer 的普通 effect（上线自检定时器）
  const result = fn.call(ctx)
  if (result && typeof result.next === 'function') result.next()
}
const ctx = {
  logger: () => ({
    info: (...a) => console.log('[info]', ...a),
    warn: (...a) => console.log('[warn]', ...a),
  }),
  on: (ev, fn) => { (listeners[ev] ??= []).push(fn) },
  effect: runEffect,
  inject: (deps, cb) => {
    if (deps.includes('settings')) cb({ settings: fakeSettings, effect: runEffect })
  },
  get: (k) => (k === 'agents' ? { roots: () => [agent] } : undefined),
}

const m = await import('dsh-telegram-notify')
m.apply(ctx, m.Config({ token: 'T', chatId: 'C', minRunSeconds: 0, mode: 'complex', sendTaskContent: true }))
await new Promise((r) => setTimeout(r, 500)) // 等 ctx.inject 的 settings 回调接管

const fireStatus = (status) => { for (const fn of listeners['agent/status'] ?? []) fn({ agent, status }) }
const runTurn = async () => {
  fireStatus('running')
  await new Promise((r) => setTimeout(r, 300))
  fireStatus('idle')
  await new Promise((r) => setTimeout(r, 9500))
}

// 1) 复杂模式 + 发送产出内容：应有结果消息（含耗时/token/缓存）+ 产出内容消息
await runTurn()

// 2) 通过「设置页」热更新为简洁模式：应只有结果消息，且无耗时/token/内容
await settingsEdit({ mode: 'simple', sendTaskContent: true })
await runTurn()

// 3) 复杂模式但不发产出内容：应有结果消息，无内容消息
await settingsEdit({ mode: 'complex', sendTaskContent: false })
await runTurn()

// 4) 提问 / 审批走官方 waterfall：监听器必须 next() 委派给后续 answerer。
//    这里在插件之后追加一个 answerer，用来验证委派确实发生。
const fireWaterfall = async (event, payload) => {
  const handlers = listeners[event] ?? []
  let i = 0
  const next = async () => {
    const handler = handlers[i++]
    return handler ? handler(payload, next) : 'no-answerer'
  }
  return next()
}
;(listeners['user-questions/request'] ??= []).push(() => 'stub-answer')
const questionAnswer = await fireWaterfall('user-questions/request', {
  agent,
  questions: [{ id: 'q1', header: '确认', question: '是否继续？' }],
})
const approvalAnswer = await fireWaterfall('approval/request', {
  agent, toolName: 'bash', reason: '需要 sudo',
})
await new Promise((r) => setTimeout(r, 300))
console.log('[check] 提问 waterfall 委派结果:', questionAnswer)
console.log('[check] 审批 waterfall 委派结果:', approvalAnswer)

// 5) goal 阻塞原因（{ code, message } 结构）
listeners['goal/changed'][0]({
  agent,
  change: { goal: { phase: 'blocked', objective: '修复构建', blockedReason: { code: 'no-network', message: '无法访问 registry' } } },
})
await new Promise((r) => setTimeout(r, 300))

console.log('=== captured messages ===')
sent.forEach((t, i) => console.log(`--- [${i + 1}] ---\n${t}`))
