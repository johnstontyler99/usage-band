import { expect, test } from 'claude-code/testing'

const context = { tokens: 140_000, window: 200_000, percent: 70 }
const rateLimits = [
  { kind: 'five_hour', percentUsed: 93, resetsAt: new Date(Date.now() + 3600e3).toISOString() },
  { kind: 'seven_day', percentUsed: 40, resetsAt: new Date(Date.now() + 4 * 86400e3).toISOString() },
]

const BAND = (surface: 'terminal' | 'desktop') => ({
  plugin: 'usage-band',
  component: 'AbovePrompt',
  surface,
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 9 } },
} as const)

test('high usage shows a warning band with compact and dismiss', async ($, on) => {
  on('clock.now', () => ({ value: Date.now() }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', ($, e) => { const { Text } = $.ui.resolve(e); return <Text>engine</Text> })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context, rateLimits, cost: { usd: 2 } } }))
  on('session.measure', (_, e) => ({ changed: e.changed }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.session.measure({ context, rateLimits, cost: { usd: 2 }, changed: ['rateLimits'] })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(BAND(surface))
    const t = await ui.find({ type: 'Text', text: /5-hour limit at 93%/ })
    expect(t).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'dismiss' })).toBeTruthy()
    await ui.unmount()
  }
})
