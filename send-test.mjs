// Channel test: send one message through the Bot API to verify token/chatId/proxy.
// Credentials come from env vars — never hardcode them here.
//
//   $env:TELEGRAM_BOT_TOKEN = '123456:ABC...'
//   $env:TELEGRAM_CHAT_ID   = '123456789'
//   $env:TELEGRAM_PROXY     = 'http://127.0.0.1:7890'   # optional
//   node send-test.mjs

const token = process.env.TELEGRAM_BOT_TOKEN ?? ''
const chatId = process.env.TELEGRAM_CHAT_ID ?? ''
const proxy = process.env.TELEGRAM_PROXY ?? ''

if (!token || !chatId) {
  console.error('Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID first.')
  process.exit(1)
}

let doFetch = fetch
let dispatcher
if (proxy) {
  const undici = await import('undici').catch(() => {
    console.error('undici not resolvable from here; run without TELEGRAM_PROXY or inside the DSH profile.')
    process.exit(1)
  })
  // Node 内置 fetch 不认外部 undici 的 dispatcher，必须成对使用 undici 的 fetch
  doFetch = undici.fetch
  dispatcher = new undici.ProxyAgent(proxy)
}

const res = await doFetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    chat_id: chatId,
    text: '🧪 <b>dsh-telegram-notify 通道测试</b>\n如果你看到这条消息，说明 bot 配置正确。',
    parse_mode: 'HTML',
  }),
  signal: AbortSignal.timeout(20000),
  ...(dispatcher ? { dispatcher } : {}),
})
const data = await res.json()
console.log(res.ok ? 'SEND OK' : 'SEND FAILED', JSON.stringify(data).slice(0, 300))
