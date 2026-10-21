export type Window = { pct: number; resetsAt?: string }

export type Usage = {
  five: Window | null
  week: Window | null
  contextTokens: number | null
  contextPercent: number | null
  costUsd: number | null
}

export type LastTurn = { fivePct: number | null; usd: number | null }

declare module 'claude-code' {
  interface PluginState {
    'usage-band': {
      usage: Usage | null
      lastTurn: LastTurn | null
      dismissed: string[]
    }
  }
}
