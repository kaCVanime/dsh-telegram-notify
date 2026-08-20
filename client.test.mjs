// Client-module smoke test: fakes the module loader, ctx, and renders the card
// server-side. Run from the web profile dir:
//   cd %USERPROFILE%\.dsh\profiles\web
//   node <plugin-dir>\client.test.mjs
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// ---- capture the module factory -----------------------------------------
let captured
globalThis.window = {
  __ModuleLoader__: {
    load: (meta) => {
      captured = meta
    },
  },
}
await import('dsh-telegram-notify/client')
if (!captured) throw new Error('client module did not register with __ModuleLoader__')
console.log('[ok] module registered, id =', captured.id)

const requireShim = (name) => {
  if (name === 'react') return React
  throw new Error(`unexpected require: ${name}`)
}
const client = captured.factory(requireShim)
console.log('[ok] factory exports:', Object.keys(client).join(', '), '| inject =', client.inject.join(', '))

// ---- fake ctx ------------------------------------------------------------
const setCalls = []
const scope = {
  getSnapshot: () => ({
    status: 'ready',
    writable: true,
    value: {
      chatId: '-1001',
      apiBase: 'https://api.telegram.org',
      proxy: 'http://127.0.0.1:7890',
      mode: 'simple',
      sendTaskContent: false,
      minRunSeconds: 30,
      notifyOnIdle: true,
      notifyOnQuestion: true,
      notifyOnApproval: true,
      notifyOnGoal: true,
      notifyOnError: false,
      sendStartupMessage: true,
    },
    base: { chatId: '-1001' },
    user: { chatId: '-1001' },
    revision: 1,
  }),
  subscribe: () => () => {},
  set: async (field, value) => setCalls.push(['set', field, value]),
  unset: async (field) => setCalls.push(['unset', field]),
}
const registrations = []
const ctx = {
  locale: {
    bind: (ns) => (key) => `<${ns}:${key}>`,
    register: () => () => {},
  },
  settingsScope: { bind: () => scope },
  slots: {
    inject: (name, genFn) => {
      const gen = genFn()
      let step = gen.next()
      while (!step.done) step = gen.next()
    },
    register: (opts, component) => {
      registrations.push({ opts, component })
      return () => {}
    },
  },
  effect: (fn) => {
    const r = fn()
    if (r && typeof r.next === 'function') r.next()
  },
}

client.apply(ctx)
if (registrations.length !== 1) throw new Error(`expected 1 slot registration, got ${registrations.length}`)
const { opts, component: Card } = registrations[0]
console.log('[ok] slot registration:', opts.name, '| key =', opts.key, '| locale =', opts.locale)
if (opts.name !== 'settings.plugin.item' || opts.key !== 'telegram-notify') {
  throw new Error('slot registration target mismatch')
}

// ---- render the card ------------------------------------------------------
const face = registrations[0].opts.inject()
const store = face.hooks.telegramNotifyCard
const snapshot = store.getSnapshot()
console.log('[ok] card shell:', JSON.stringify({ available: snapshot.available, writable: snapshot.writable, dirty: snapshot.dirty }))

const props = {
  t: (key) => key,
  useTelegramNotifyCard: (sel) => sel(store.getSnapshot()),
  edit: face.edit,
  resetField: face.resetField,
  choose: face.choose,
  save: face.save,
  discard: face.discard,
}
const html = renderToStaticMarkup(React.createElement(Card, props))
console.log('[ok] server render collapsed card, length =', html.length)
if (!html.includes('dtn-card')) throw new Error('card markup missing dtn-card class')

// ---- staged edits + save ---------------------------------------------------
face.edit('chatId', '-1002')
face.choose('mode', 'complex')
face.choose('sendTaskContent', true)
face.edit('minRunSeconds', '60')
face.edit('token', 'new-token')
if (!store.getSnapshot().dirty) throw new Error('form should be dirty after edits')
await face.save()
console.log('[ok] save writes:', JSON.stringify(setCalls))
const expect = [
  ['set', 'chatId', '-1002'],
  ['set', 'mode', 'complex'],
  ['set', 'sendTaskContent', true],
  ['set', 'minRunSeconds', 60],
  ['set', 'token', 'new-token'],
]
if (JSON.stringify(setCalls) !== JSON.stringify(expect)) throw new Error('save writes mismatch')
if (store.getSnapshot().dirty) throw new Error('form should be clean after save')

// ---- number validation blocks save -----------------------------------------
face.edit('minRunSeconds', 'abc')
const beforeCalls = setCalls.length
await face.save()
if (setCalls.length !== beforeCalls) throw new Error('invalid number must block save')
if (!store.getSnapshot().invalid) throw new Error('form should report invalid')
console.log('[ok] invalid number blocks save')

console.log('\nALL CLIENT TESTS PASSED')
