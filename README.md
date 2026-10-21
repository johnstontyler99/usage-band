# usage-band

Keeps your Claude usage in view while you chat. A status line under the prompt shows your 5-hour and weekly limits as small bars with percentages and reset times, the context the session is carrying, and how much of your 5-hour limit the last turn used.

When a session gets expensive, a band above the prompt says why and offers to compact the session, and a toast fires once per warning. It warns when one turn uses 3% or more of the 5-hour limit, when context passes 100k tokens, when you're on pace to hit the 5-hour limit before it resets, when the 5-hour window passes 90% or the weekly passes 80%, and when session cost passes $5, $10, $20 and $50. Thresholds are constants at the top of hooks/register.tsx.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install usage-band --marketplace johnstontyler99/usage-band
```

Answer `y` to add the marketplace, then pick a scope.

From a shell:

```
claude plugin install usage-band --marketplace johnstontyler99/usage-band
```

The repository is private, so installing needs GitHub signed in on that computer (`gh auth login`).
