# @harpd/x402-logging-middleware

Drop-in **x402 payment logging middleware** for Node HTTP / Express apps. Every
x402 interaction — a `402 Payment Required` response, a client-attached
`X-Payment` header, a settled transaction — is emitted as one structured,
audit-friendly event. **Zero runtime dependencies.**

> Part of Harpd's open-source agent-commerce toolkit. Pairs well with
> [`@harpd/agent-transaction-audit-schema`](https://github.com/harpd-dev/agent-transaction-audit-schema)
> (the event shape is compatible) and
> [`@harpd/observe`](https://github.com/harpd-dev/observe) (swap the sink to
> forward events to the Harpd collector).

## Install

```bash
npm install @harpd/x402-logging-middleware
```

## Express / Connect usage

```ts
import express from 'express'
import { createX402LoggingMiddleware } from '@harpd/x402-logging-middleware'

const app = express()
app.use(createX402LoggingMiddleware({ direction: 'inbound' }))

// A paid endpoint — the 402 + the eventual settlement both get logged.
app.get('/paid-resource', (req, res) => {
  res.setHeader('www-authenticate', JSON.stringify({
    accepts: [{ scheme: 'exact', asset: 'eip155:8453/erc20:0xUSDC', price: '10000', maxTimeoutSeconds: 60 }],
  }))
  res.status(402).end()
})
```

Every request through the middleware emits a JSON event:

```json
{
  "middleware": "x402-logging-middleware",
  "version": "0.1.0",
  "direction": "inbound",
  "timestamp": "2026-07-29T...Z",
  "method": "GET",
  "path": "/paid-resource",
  "statusCode": 402,
  "asset": "eip155:8453/erc20:0xUSDC",
  "amountUsd": 0.01,
  "txHash": null,
  "x402": { "requirement": { "accepts": [ ... ] }, "payment": null, "paymentResponse": null }
}
```

## Custom sink (forward to Harpd / your own store)

```ts
import { createX402LoggingMiddleware } from '@harpd/x402-logging-middleware'

const forwardToHarpd = (event) =>
  fetch('https://api.harpd.com/v1/events', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.HARPD_KEY}` },
    body: JSON.stringify(event),
  })

app.use(createX402LoggingMiddleware({ sink: forwardToHarpd }))
```

## Manual logging (clients, background jobs)

```ts
import { logX402Payment } from '@harpd/x402-logging-middleware'

logX402Payment({
  direction: 'outbound',
  resource: 'https://paid-api.example.com/v1/weather',
  asset: 'eip155:8453/erc20:0xUSDC',
  amountUsd: 0.01,
  txHash: '0xabc...',
  status: 'settled',
})
```

## Why a middleware (not just console.log)

A payment audit trail that lives only in your app logs is fragile. This
middleware gives you a single, normalized event for every x402 hop so the same
record can feed dashboards, alerts, and compliance — see the
[audit schema package](https://github.com/harpd-dev/agent-transaction-audit-schema).

## Further reading

- [x402 vs MPP vs AP2: agent payment protocols compared](https://harpd.com/blog/x402-vs-mpp-vs-ap2/) — which protocol to build on (x402, Stripe MPP, Mastercard Agent Pay, Google AP2), and how they compose.
- [Spending limits for x402 payments](https://harpd.com/protocols/x402/) — per-agent budget control without holding funds or keys.

## License

MIT © Harpd. Issues and PRs welcome at
[github.com/harpd-dev/x402-logging-middleware](https://github.com/harpd-dev/x402-logging-middleware).

---

## About Harpd

[Harpd](https://harpd.com) is the AI Cost Intelligence platform for the agent era — measure, optimize and control production AI spend, from **[cost per successful task](https://harpd.com/cost-per-successful-task/)** to agent-payment budgets ([x402](https://github.com/harpd-dev/observe) / USDC).

- Website: <https://harpd.com>
- GitHub org: <https://github.com/harpd-dev>
- Contact: <mailto:harpdsupport@gmail.com>

