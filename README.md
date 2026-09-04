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
  "network": "eip155:8453",
  "amountUsd": 0.01,
  "amountAtomic": "10000",
  "txHash": null,
  "x402": { "requirement": { "accepts": [ ... ] }, "payment": null, "paymentResponse": null }
}
```

Prices in an x402 challenge are quoted in the asset's smallest unit, so the
`price: '10000'` above is 10000 six-decimal USDC units, which is the `0.01`
shown in the event. `amountAtomic` keeps the unscaled value exactly as it came
off the wire. For an asset whose decimals are not known, `amountUsd` is the raw
price unchanged, and you can declare the decimals yourself:

```ts
app.use(createX402LoggingMiddleware({
  assetDecimals: { 'sui:mainnet': 6 },
}))
```

## Logging Casper x402 payments

Casper uses the CAIP-2 network ids `casper:casper` (mainnet) and
`casper:casper-test` (testnet), and settles in wCSPR, a CEP-18 token. CSPR has 9
decimals and its smallest unit is the mote (1 CSPR = 1,000,000,000 motes), so a
Casper challenge quotes motes the same way an EVM challenge quotes six-decimal
USDC units. Both are handled out of the box.

```ts
import express from 'express'
import { createX402LoggingMiddleware } from '@harpd/x402-logging-middleware'

const app = express()
app.use(createX402LoggingMiddleware({ direction: 'inbound' }))

app.get('/paid-resource', (req, res) => {
  res.setHeader('www-authenticate', JSON.stringify({
    accepts: [{
      scheme: 'exact',
      asset: 'casper:casper/cep18:0e5a5f4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c',
      price: '10000000',
      payTo: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef01',
      maxTimeoutSeconds: 60,
    }],
  }))
  res.status(402).end()
})
```

That emits `"network": "casper:casper"`, `"amountAtomic": "10000000"` and
`"amountUsd": 0.01`, ten million motes being one hundredth of a CSPR.

Settled payments are logged the same way as any other chain. Casper deploy and
transaction hashes are 64 hex characters with no `0x` prefix, and are passed
through as they are:

```ts
import { logX402Payment } from '@harpd/x402-logging-middleware'

logX402Payment({
  direction: 'outbound',
  resource: 'https://paid-api.example.com/v1/weather',
  asset: 'casper:casper/cep18:0e5a5f4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c',
  payment: { scheme: 'exact', network: 'casper:casper', payload: { amount: '10000000' } },
  txHash: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
  status: 'settled',
})
```

To verify and settle the payments you log here, Casper runs a hosted x402
facilitator at <https://x402-facilitator.cspr.cloud> (docs:
<https://docs.cspr.cloud>). Client and server SDKs live in
[make-software/casper-x402](https://github.com/make-software/casper-x402)
(npm `@make-software/casper-x402`).

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

## Tests

```bash
npm test
```

Runs the `node:test` suite in `test/`. No dependencies to install.

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

