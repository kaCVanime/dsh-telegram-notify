// dsh-telegram-notify browser half: one card in 设置 > 插件 > 插件配置 editing the
// host-owned `telegram-notify` settings namespace. Hand-written, no bundler:
// the client module system wraps this factory and adopts { apply, inject }.
window.__ModuleLoader__.load({
  id: 'dsh-telegram-notify',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const { useState } = React
    const h = React.createElement

    const NS = 'telegram-notify'

    // ── locale dictionaries ───────────────────────────────────────────────
    const zh = {
      title: 'Telegram 通知',
      description: '任务完成、提问、审批或目标完成时发送 Telegram 消息。',
      token: 'Bot Token',
      tokenHint: '只写字段：留空表示保持当前 token，输入新值则覆盖。也可用环境变量 TELEGRAM_BOT_TOKEN。',
      chatId: 'Chat ID',
      chatIdHint: '接收消息的会话 id（@userinfobot 可查）。留空保存 = 恢复默认。',
      apiBase: 'API 地址',
      apiBaseHint: 'Bot API 基础地址，可填自建反代。默认 https://api.telegram.org。',
      proxy: 'HTTP 代理',
      proxyHint: 'api.telegram.org 不可直连时必填，如 http://127.0.0.1:7890。',
      mode: '通知模式',
      modeHint: '简洁模式只报任务结果；复杂模式附带耗时、token 消耗与缓存命中率。',
      modeSimple: '简洁',
      modeComplex: '复杂',
      sendTaskContent: '附带产出内容',
      sendTaskContentHint: '仅复杂模式：把本轮最终产出内容一并发送。',
      minRunSeconds: '最短运行秒数',
      minRunSecondsHint: 'agent 连续运行不足该秒数时不发「任务完成」通知。留空恢复默认 30。',
      switches: '通知开关',
      notifyOnIdle: '任务完成时通知',
      notifyOnQuestion: '向我提问时通知',
      notifyOnApproval: '请求审批时通知',
      notifyOnGoal: '长期目标完成 / 阻塞时通知',
      notifyOnError: '运行出错时通知',
      sendStartupMessage: '启动时发送上线消息',
      overridden: '已覆盖',
      reset: '恢复默认',
      readOnly: '当前部署的设置是只读的。',
      expand: '展开设置',
      collapse: '收起设置',
      save: '保存',
      saving: '保存中…',
      discard: '放弃修改',
      unsaved: '未保存',
      saveFailed: '部分设置未被接受，请检查后重试。',
      invalidNumber: '请输入数字，或留空恢复默认。',
    }
    const en = {
      title: 'Telegram Notify',
      description: 'Send a Telegram message when a task finishes, the agent asks, or approval is requested.',
      token: 'Bot token',
      tokenHint: 'Write-only: leave blank to keep the current token; type a new one to replace it. Env TELEGRAM_BOT_TOKEN also works.',
      chatId: 'Chat ID',
      chatIdHint: 'Destination chat id (ask @userinfobot). Saving blank resets to default.',
      apiBase: 'API base',
      apiBaseHint: 'Bot API base URL; point to your own reverse proxy if needed.',
      proxy: 'HTTP proxy',
      proxyHint: 'Required where api.telegram.org is unreachable, e.g. http://127.0.0.1:7890.',
      mode: 'Notify mode',
      modeHint: 'Simple reports the result only; complex adds duration, token usage and cache hit rate.',
      modeSimple: 'Simple',
      modeComplex: 'Complex',
      sendTaskContent: 'Include task output',
      sendTaskContentHint: 'Complex mode only: also send the final output of the turn.',
      minRunSeconds: 'Minimum run seconds',
      minRunSecondsHint: 'No completion notification for runs shorter than this. Blank resets to 30.',
      switches: 'Switches',
      notifyOnIdle: 'Notify on task completion',
      notifyOnQuestion: 'Notify on questions',
      notifyOnApproval: 'Notify on approval requests',
      notifyOnGoal: 'Notify on goal completed/blocked',
      notifyOnError: 'Notify on errors',
      sendStartupMessage: 'Startup message',
      overridden: 'Overridden',
      reset: 'Reset to default',
      readOnly: 'This deployment stores settings read-only.',
      expand: 'Show settings',
      collapse: 'Hide settings',
      save: 'Save',
      saving: 'Saving…',
      discard: 'Discard',
      unsaved: 'Unsaved',
      saveFailed: 'Some values were not accepted; please review and retry.',
      invalidNumber: 'Enter a number, or leave blank to use the default.',
    }

    // ── styles（沿用 DSH 设计变量，观感与官方卡片一致）─────────────────────
    const CSS = `
.dtn-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}
.dtn-card:hover{border-color:var(--dsw-alias-label-dimmed)}
.dtn-open{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}
.dtn-header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}
.dtn-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dtn-headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}
.dtn-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}
.dtn-desc{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}
.dtn-chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s;font-size:12px}
.dtn-chevronOpen{transform:rotate(180deg)}
.dtn-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}
.dtn-readOnly{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:12px;line-height:1.5}
.dtn-pending{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}
.dtn-footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}
.dtn-failed{min-width:0;color:var(--dsw-alias-label-error);flex:1;margin:0;font-size:12px;line-height:1.5}
.dtn-discard,.dtn-save{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}
.dtn-discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}
.dtn-discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}
.dtn-save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
.dtn-discard:disabled,.dtn-save:disabled{opacity:.4;cursor:default}
.dtn-field{display:flex;flex-direction:column;gap:6px;margin:12px 0}
.dtn-fieldHead{display:flex;align-items:center;justify-content:space-between;gap:8px}
.dtn-label{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:1.4}
.dtn-badges{display:flex;align-items:center;gap:8px}
.dtn-badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}
.dtn-reset{appearance:none;background:0 0;border:0;padding:0;font:inherit;font-size:12px;color:var(--dsw-alias-brand-primary);cursor:pointer}
.dtn-input,.dtn-select{appearance:none;font:inherit;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 10px;width:100%;box-sizing:border-box}
.dtn-input:focus,.dtn-select:focus{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}
.dtn-inputInvalid{border-color:var(--dsw-alias-label-error)}
.dtn-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}
.dtn-invalid{color:var(--dsw-alias-label-error);margin:0;font-size:12px;line-height:1.5}
.dtn-switchRow{display:flex;align-items:center;gap:8px;margin:8px 0}
.dtn-switchRow input{accent-color:var(--dsw-alias-brand-primary)}
.dtn-switchLabel{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.5}
.dtn-groupTitle{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:600;margin:16px 0 0;text-transform:none}
`
    if (
      typeof document !== 'undefined' &&
      document.querySelector('style[data-plugin-css="dsh-telegram-notify/card"]') === null
    ) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-telegram-notify'
      tag.dataset.pluginCss = 'dsh-telegram-notify/card'
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    // ── tiny snapshot store（避免跨包依赖）─────────────────────────────────
    function createStore(initial) {
      let snapshot = initial
      const listeners = new Set()
      return {
        getSnapshot: () => snapshot,
        set(next) {
          snapshot = next
          for (const listener of [...listeners]) listener()
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      }
    }

    // ── staged form ───────────────────────────────────────────────────────
    const TEXT_FIELDS = ['chatId', 'apiBase', 'proxy']
    const BOOL_FIELDS = [
      'sendTaskContent',
      'notifyOnIdle',
      'notifyOnQuestion',
      'notifyOnApproval',
      'notifyOnGoal',
      'notifyOnError',
      'sendStartupMessage',
    ]

    class NotifyCardController {
      constructor(scope) {
        this.scope = scope
        this.staged = new Map() // field -> { text, clear } | { value }
        this.saving = false
        this.failed = false
        this.store = createStore(this.projection())
        scope.subscribe(() => this.publish())
      }
      snapshot() {
        return this.scope.getSnapshot()
      }
      sectionValue(field) {
        return this.snapshot().value?.[field]
      }
      stored(field) {
        const user = this.snapshot().user
        return user !== undefined && Object.hasOwn(user, field)
      }
      shell() {
        const snapshot = this.snapshot()
        return {
          available: snapshot.status === 'ready',
          writable: snapshot.writable,
          dirty: this.staged.size > 0,
          invalid: this.field('minRunSeconds').invalid,
          saving: this.saving,
          failed: this.failed,
        }
      }
      field(field) {
        const staged = this.staged.get(field)
        if (field === 'token') return { text: staged?.text ?? '', overridden: false, invalid: false }
        if (TEXT_FIELDS.includes(field) || field === 'minRunSeconds') {
          const current = this.sectionValue(field)
          const format = (v) => (v === undefined || v === null ? '' : String(v))
          if (staged === undefined) {
            return { text: format(current), overridden: this.stored(field), invalid: false }
          }
          if (staged.clear) return { text: staged.text, overridden: false, invalid: false }
          if (field === 'minRunSeconds') {
            const t = staged.text.trim()
            const invalid = t !== '' && !Number.isFinite(Number(t))
            return { text: staged.text, overridden: t !== '', invalid }
          }
          return { text: staged.text, overridden: staged.text.trim() !== '', invalid: false }
        }
        // select / bool：展示 staged 优先，否则展示服务端生效值
        const value = staged?.value ?? this.sectionValue(field)
        return { value, overridden: staged !== undefined || this.stored(field), invalid: false }
      }
      projection() {
        const p = { ...this.shell() }
        for (const field of ['token', ...TEXT_FIELDS, 'mode', 'minRunSeconds', ...BOOL_FIELDS]) {
          p[field] = this.field(field)
        }
        return p
      }
      publish() {
        this.store.set(this.projection())
      }
      inject() {
        return {
          hooks: { telegramNotifyCard: this.store },
          edit: (field, text) => {
            this.staged.set(field, { text, clear: false })
            this.failed = false
            this.publish()
          },
          resetField: (field) => {
            const current = this.sectionValue(field)
            this.staged.set(field, {
              text: current === undefined || current === null ? '' : String(current),
              clear: true,
            })
            this.failed = false
            this.publish()
          },
          choose: (field, value) => {
            this.staged.set(field, { value })
            this.failed = false
            this.publish()
          },
          save: () => this.save(),
          discard: () => {
            this.staged.clear()
            this.failed = false
            this.publish()
          },
        }
      }
      async save() {
        if (this.saving || this.staged.size === 0 || this.shell().invalid) return
        this.saving = true
        this.failed = false
        this.publish()
        let landed = true
        for (const [field, staged] of this.staged) {
          try {
            if (field === 'token') {
              const v = staged.text.trim()
              if (v !== '') await this.scope.set(field, v)
            } else if (staged.clear) {
              await this.scope.unset(field)
            } else if (field === 'minRunSeconds') {
              const t = staged.text.trim()
              if (t === '') await this.scope.unset(field)
              else await this.scope.set(field, Number(t))
            } else if (TEXT_FIELDS.includes(field)) {
              const t = staged.text.trim()
              if (t === '') await this.scope.unset(field)
              else await this.scope.set(field, t)
            } else {
              await this.scope.set(field, staged.value)
            }
          } catch {
            landed = false
          }
        }
        this.staged.clear()
        this.saving = false
        this.failed = !landed
        this.publish()
      }
    }

    // ── controls ──────────────────────────────────────────────────────────
    function FieldShell(props) {
      return h('div', { className: 'dtn-field' }, [
        h('div', { className: 'dtn-fieldHead', key: 'head' }, [
          h('label', { className: 'dtn-label', htmlFor: props.id, key: 'label' }, props.label),
          props.overridden
            ? h('span', { className: 'dtn-badges', key: 'badges' }, [
                h('span', { className: 'dtn-badge', key: 'b' }, props.overriddenLabel),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dtn-reset',
                    disabled: props.disabled,
                    onClick: props.onReset,
                    key: 'r',
                  },
                  props.resetLabel,
                ),
              ])
            : null,
        ]),
        props.control,
        h(
          'p',
          { className: props.invalid ? 'dtn-invalid' : 'dtn-hint', key: 'hint' },
          props.invalid ? props.invalidLabel : props.hint,
        ),
      ])
    }

    function textControl(props, type) {
      return h('input', {
        id: props.id,
        className: props.invalid ? 'dtn-input dtn-inputInvalid' : 'dtn-input',
        type,
        autoComplete: 'off',
        value: props.text,
        disabled: props.disabled,
        onChange: (event) => props.onEdit(event.target.value),
      })
    }

    // ── the card ──────────────────────────────────────────────────────────
    function TelegramNotifyCard(props) {
      const { t } = props
      const state = props.useTelegramNotifyCard((s) => s)
      const [open, setOpen] = useState(false)
      if (!state.available) return null
      const disabled = !state.writable
      const blocked = !state.dirty || state.invalid || state.saving

      const valueField = (field, labelKey, hintKey, numeric) =>
        h(FieldShell, {
          key: field,
          id: `dtn-${field}`,
          label: t(labelKey),
          hint: t(hintKey),
          overriddenLabel: t('overridden'),
          resetLabel: t('reset'),
          invalidLabel: t('invalidNumber'),
          invalid: state[field].invalid,
          overridden: state[field].overridden,
          disabled,
          onReset: () => props.resetField(field),
          control: textControl(
            {
              id: `dtn-${field}`,
              text: state[field].text,
              invalid: state[field].invalid,
              disabled,
              onEdit: (text) => props.edit(field, text),
            },
            'text',
          ),
        })

      const switchRow = (field, labelKey) =>
        h('div', { className: 'dtn-switchRow', key: field }, [
          h('input', {
            id: `dtn-${field}`,
            type: 'checkbox',
            checked: state[field].value === true,
            disabled,
            onChange: (event) => props.choose(field, event.target.checked),
            key: 'input',
          }),
          h('label', { className: 'dtn-switchLabel', htmlFor: `dtn-${field}`, key: 'label' }, t(labelKey)),
        ])

      return h('li', { className: open ? 'dtn-card dtn-open' : 'dtn-card' }, [
        h(
          'button',
          {
            type: 'button',
            className: 'dtn-header',
            'aria-expanded': open,
            'aria-label': `${t(open ? 'collapse' : 'expand')}: ${t('title')}`,
            onClick: () => setOpen(!open),
            key: 'header',
          },
          [
            h('span', { className: 'dtn-headText', key: 'text' }, [
              h('span', { className: 'dtn-name', key: 'name' }, t('title')),
              h('span', { className: 'dtn-desc', key: 'desc' }, t('description')),
            ]),
            state.dirty ? h('span', { className: 'dtn-pending', key: 'pending' }, t('unsaved')) : null,
            h('span', { className: open ? 'dtn-chevron dtn-chevronOpen' : 'dtn-chevron', key: 'chev' }, '▾'),
          ],
        ),
        open
          ? h('div', { className: 'dtn-body', key: 'body' }, [
              !state.writable ? h('p', { className: 'dtn-readOnly', role: 'status', key: 'ro' }, t('readOnly')) : null,
              // token（只写）
              h(FieldShell, {
                key: 'token',
                id: 'dtn-token',
                label: t('token'),
                hint: t('tokenHint'),
                overriddenLabel: t('overridden'),
                resetLabel: t('reset'),
                invalidLabel: '',
                invalid: false,
                overridden: false,
                disabled,
                onReset: () => {},
                control: textControl(
                  {
                    id: 'dtn-token',
                    text: state.token.text,
                    invalid: false,
                    disabled,
                    onEdit: (text) => props.edit('token', text),
                  },
                  'password',
                ),
              }),
              valueField('chatId', 'chatId', 'chatIdHint'),
              valueField('apiBase', 'apiBase', 'apiBaseHint'),
              valueField('proxy', 'proxy', 'proxyHint'),
              // mode 下拉
              h(FieldShell, {
                key: 'mode',
                id: 'dtn-mode',
                label: t('mode'),
                hint: t('modeHint'),
                overriddenLabel: t('overridden'),
                resetLabel: t('reset'),
                invalidLabel: '',
                invalid: false,
                overridden: state.mode.overridden,
                disabled,
                onReset: () => props.choose('mode', 'simple'),
                control: h(
                  'select',
                  {
                    id: 'dtn-mode',
                    className: 'dtn-select',
                    value: state.mode.value === 'complex' ? 'complex' : 'simple',
                    disabled,
                    onChange: (event) => props.choose('mode', event.target.value),
                  },
                  [
                    h('option', { value: 'simple', key: 'simple' }, t('modeSimple')),
                    h('option', { value: 'complex', key: 'complex' }, t('modeComplex')),
                  ],
                ),
              }),
              valueField('minRunSeconds', 'minRunSeconds', 'minRunSecondsHint', true),
              h('p', { className: 'dtn-groupTitle', key: 'switches' }, t('switches')),
              switchRow('sendTaskContent', 'sendTaskContent'),
              switchRow('notifyOnIdle', 'notifyOnIdle'),
              switchRow('notifyOnQuestion', 'notifyOnQuestion'),
              switchRow('notifyOnApproval', 'notifyOnApproval'),
              switchRow('notifyOnGoal', 'notifyOnGoal'),
              switchRow('notifyOnError', 'notifyOnError'),
              switchRow('sendStartupMessage', 'sendStartupMessage'),
              h('div', { className: 'dtn-footer', key: 'footer' }, [
                state.failed ? h('p', { className: 'dtn-failed', role: 'status', key: 'fail' }, t('saveFailed')) : null,
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dtn-discard',
                    disabled: !state.dirty || state.saving,
                    onClick: props.discard,
                    key: 'discard',
                  },
                  t('discard'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dtn-save',
                    disabled: blocked,
                    onClick: props.save,
                    key: 'save',
                  },
                  t(state.saving ? 'saving' : 'save'),
                ),
              ]),
            ])
          : null,
      ])
    }

    // ── mount ─────────────────────────────────────────────────────────────
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'telegram-notify: dictionaries')
      const scope = ctx.settingsScope.bind({ namespace: NS })
      const controller = new NotifyCardController(scope)
      // slot 由 ui-settings-plugins 声明；inject 等到声明完成后再注册卡片
      ctx.slots.inject('settings.plugin.item', function* () {
        yield ctx.slots.register(
          {
            name: 'settings.plugin.item',
            key: NS,
            locale: NS,
            inject: () => controller.inject(),
          },
          TelegramNotifyCard,
        )
      })
    }

    exports.apply = apply
    exports.inject = ['settingsScope', 'slots', 'locale', 'connection', 'remote']
    return module.exports
  },
})
