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
const svc = { ask: async () => 'answer', request: async () => 'allowed-once' }

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
  register(ns, schema, opts) {
    pluginConfigSchema = schema
    settingsValue = schema(opts?.base ?? {})
    return {
      get: () => settingsValue,
      watch: (cb) => { watchers.add(cb); return () => watchers.delete(cb) },
    }
  },
}
// 模拟「设置 > 插件 > 插件配置」里的编辑：改值并通知 watcher
const settingsEdit = async (patch) => {
  settingsValue = pluginConfigSchema({ ...settingsValue, ...patch })
  for (const cb of watchers) cb()
}

const runEffect = (fn) => {
  const gen = fn.call(ctx)
  gen.next()
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
  get: (k) =>
    k === 'userQuestions' ? svc
    : k === 'approval' ? svc
    : k === 'agents' ? { roots: () => [agent] }
    : undefined,
}

const m = await import('dsh-telegram-notify')
m.apply(ctx, m.Config({ token: 'T', chatId: 'C', minRunSeconds: 0, mode: 'complex', sendTaskContent: true }))
await new Promise((r) => setTimeout(r, 500)) // 等动态 import(dsh-settings) 接管

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

console.log('=== captured messages ===')
sent.forEach((t, i) => console.log(`--- [${i + 1}] ---\n${t}`))
