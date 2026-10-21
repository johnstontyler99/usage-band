import { atom, read, update } from 'claude-code'
import type { Hook, Register, SessionRateLimit, SessionContextUsage, SessionCost } from 'claude-code'

import type { LastTurn, Usage, Window } from '../types'

// ---- thresholds (edit to taste) ----
const TURN_PCT_WARN = 3          // one turn used this much of the 5-hour limit
const TURN_USD_WARN = 1          // or this much API-equivalent cost
const CONTEXT_WARN = 100_000     // tokens re-read on every message
const FIVE_WARN = 90             // 5-hour window
const WEEK_WARN = 80             // weekly window
const COST_STEPS = [5, 10, 20, 50] // session total, toast once each

const usageAtom = atom({ plugin: 'usage-band', key: 'usage' } as const, null)
const lastTurnAtom = atom({ plugin: 'usage-band', key: 'lastTurn' } as const, null)
const dismissedAtom = atom({ plugin: 'usage-band', key: 'dismissed' } as const, [])

type Warning = { key: string; text: string; compact?: boolean }

const win = (limits: SessionRateLimit[], kind: string): Window | null => {
  const w = limits.find(l => l.kind === kind)
  return w ? { pct: w.percentUsed, resetsAt: w.resetsAt } : null
}

const toUsage = (limits: SessionRateLimit[], context: SessionContextUsage, cost?: SessionCost): Usage => ({
  five: win(limits, 'five_hour'),
  week: win(limits, 'seven_day'),
  contextTokens: context.tokens ?? null,
  contextPercent: context.percent ?? null,
  costUsd: cost ? cost.usd : null,
})

const pct = (p: number) => `${p >= 10 || p === 0 ? Math.round(p) : p.toFixed(1)}%`

const bar = (p: number) => {
  const n = Math.max(0, Math.min(8, Math.round(p / 12.5)))
  return '▰'.repeat(n) + '▱'.repeat(8 - n)
}

const dur = (ms: number) => {
  if (ms <= 0) return 'now'
  const m = Math.round(ms / 60000)
  const h = Math.floor(m / 60)
  return h ? `${h}h ${m % 60}m` : `${m}m`
}

const resetText = (iso: string | undefined, now: number) => {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!isFinite(t)) return ''
  const ms = t - now
  if (ms < 24 * 3600e3) return `resets ${new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
  return `resets ${new Date(t).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`
}

const k = (n: number) => `${Math.round(n / 1000)}k`

function statusLine(u: Usage, last: LastTurn | null, now: number) {
  const parts: string[] = []
  if (u.five) parts.push(`5h ${bar(u.five.pct)} ${pct(u.five.pct)} ${resetText(u.five.resetsAt, now)}`.trim())
  if (u.week) parts.push(`Week ${bar(u.week.pct)} ${pct(u.week.pct)} ${resetText(u.week.resetsAt, now)}`.trim())
  if (u.contextTokens != null) parts.push(`Context ${k(u.contextTokens)}`)
  if (last && last.fivePct != null) parts.push(`last turn ${pct(last.fivePct)}`)
  if (!u.five && !u.week) parts.push(u.costUsd != null ? `Session $${u.costUsd.toFixed(2)}` : 'No usage reading yet')
  return parts.join('  ·  ')
}

function warningsFor(u: Usage, last: LastTurn | null, now: number): Warning[] {
  const out: Warning[] = []
  if (u.five && u.five.pct >= FIVE_WARN) {
    out.push({ key: 'five', text: `5-hour limit at ${pct(u.five.pct)}, ${resetText(u.five.resetsAt, now)}.` })
  }
  if (last && ((last.fivePct ?? 0) >= TURN_PCT_WARN || (last.usd ?? 0) >= TURN_USD_WARN)) {
    const what = last.fivePct != null ? `${pct(last.fivePct)} of your 5-hour limit` : `about $${(last.usd ?? 0).toFixed(2)}`
    out.push({ key: 'turn', compact: true, text: `That turn used ${what}. Every message re-reads the whole session, so it gets pricier each turn. Compacting or starting fresh will stretch your limit.` })
  }
  if (u.contextTokens != null && u.contextTokens >= CONTEXT_WARN) {
    out.push({ key: 'context', compact: true, text: `This session is carrying ${k(u.contextTokens)} tokens of context, re-read on every message.` })
  }
  if (u.five && u.five.resetsAt && u.five.pct > 10 && u.five.pct < 100) {
    const left = Date.parse(u.five.resetsAt) - now
    const elapsed = 5 * 3600e3 - left
    if (left > 0 && elapsed > 20 * 60000) {
      const eta = (100 - u.five.pct) / (u.five.pct / elapsed)
      if (eta < left) out.push({ key: 'pace', text: `At this pace you'll hit the 5-hour limit in about ${dur(eta)}, before it resets in ${dur(left)}.` })
    }
  }
  if (u.week && u.week.pct >= WEEK_WARN) {
    out.push({ key: 'week', text: `Weekly usage at ${pct(u.week.pct)}, ${resetText(u.week.resetsAt, now)}.` })
  }
  return out
}

const toasted = new Set<string>()
const costToasted = new Set<number>()

async function apply($: Parameters<Hook<'session.measure'>>[0], u: Usage) {
  await update($, usageAtom, () => u)
  const now = await $.clock.now()
  const last = await read($, lastTurnAtom)
  $.ui.status(statusLine(u, last, now))

  // toast each warning once per crossing
  const active = warningsFor(u, last, now)
  const keys = new Set(active.map(w => w.key))
  for (const key of [...toasted]) if (!keys.has(key)) toasted.delete(key)
  for (const w of active) {
    if (!toasted.has(w.key)) {
      toasted.add(w.key)
      $.ui.toast(w.text, { timeoutMs: 8000 })
    }
  }
  if (u.costUsd != null) {
    for (const step of COST_STEPS) {
      if (u.costUsd >= step && !costToasted.has(step)) {
        costToasted.add(step)
        $.ui.toast(`This session has passed $${step} in API-equivalent usage.`, { timeoutMs: 8000 })
      }
    }
  }
}

export const register: Register = on => {
  let fiveAtSubmit: number | null = null
  let usdAtSubmit: number | null = null
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    const s = await $.session.usage()
    const u = toUsage(s.rateLimits, s.context, s.cost)
    // don't re-toast cost steps already passed when the mod (re)loads
    if (u.costUsd != null) for (const step of COST_STEPS) if (u.costUsd >= step) costToasted.add(step)
    await apply($, u)
    return r
  })

  on('session.measure', async ($, e, next) => {
    await apply($, toUsage(e.rateLimits, e.context, e.cost))
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const u = await read($, usageAtom)
    fiveAtSubmit = u?.five?.pct ?? null
    usdAtSubmit = u?.costUsd ?? null
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) return r
    const s = await $.session.usage()
    const u = toUsage(s.rateLimits, s.context, s.cost)
    const fiveDelta = fiveAtSubmit != null && u.five ? u.five.pct - fiveAtSubmit : null
    const usdDelta = usdAtSubmit != null && u.costUsd != null ? u.costUsd - usdAtSubmit : null
    await update($, lastTurnAtom, () => ({
      fivePct: fiveDelta != null && fiveDelta >= 0 ? fiveDelta : null, // negative: window reset mid-turn
      usd: usdDelta != null && usdDelta >= 0 ? usdDelta : null,
    }))
    await apply($, u)
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const u = await read($, usageAtom)
    if (!u) return next(e)
    const last = await read($, lastTurnAtom)
    const dismissed = await read($, dismissedAtom)
    const now = await $.clock.now()
    const shown = warningsFor(u, last, now).filter(w => !dismissed.includes(w.key))
    const top = shown[0]
    if (!top) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Text color="warning" wrap="wrap">
          ⚠ {top.text}
          {shown.length > 1 ? ` (+${shown.length - 1} more)` : ''}
        </Text>
        <Box gap={1}>
          {top.compact && !e.props.isWorking ? (
            <Button
              key="compact"
              label="Compact now"
              variant="primary"
              onPress={() => { void $.session.compact() }}
            />
          ) : null}
          <Button
            key="dismiss"
            label="Dismiss"
            role="dismiss"
            onPress={() => update($, dismissedAtom, d => [...d, top.key])}
          />
        </Box>
      </Box>
    )
  })
}
