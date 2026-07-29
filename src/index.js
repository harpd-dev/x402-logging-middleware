// @harpd/x402-logging-middleware
// Drop-in logging middleware for x402 payment flows in Node HTTP / Express apps.
// Zero runtime dependencies. Emits structured, audit-friendly events for every
// x402 interaction so you can see *who paid what, when, for which resource*.
//
// Works alongside @harpd/agent-transaction-audit-schema (the event shape is
// intentionally compatible) and @harpd/observe (swap the sink to forward events
// to the Harpd collector).

export const MIDDLEWARE_VERSION = '0.1.0'

// Sink contract: sink(event) is called for every x402 event. Default sink logs
// pretty JSON to stdout. Replace it with your own (e.g. forward to Harpd).
function defaultSink(event) {
  // eslint-disable-next-line no-console
  console.log('[x402]', JSON.stringify(event))
}

// x402 uses these header names. We read both canonical and common variants.
function readX402Headers(req, res) {
  const reqHeaders = (req && req.headers) || {}
  const resHeaders = (res && typeof res.getHeaders === 'function')
    ? res.getHeaders()
    : (res && res.headers) || {}
  const payment = reqHeaders['x-payment'] || reqHeaders['x-payment-response'] || null
  const requirement =
    resHeaders['www-authenticate'] ||
    resHeaders['x-payment-requirements'] ||
    resHeaders['x402-requirements'] ||
    null
  const paymentResponse = resHeaders['x-payment-response'] || resHeaders['x402-payment-response'] || null
  return { payment, requirement, paymentResponse }
}

// Best-effort JSON parse that never throws.
function safeJson(v) {
  if (!v) return null
  if (typeof v === 'object') return v
  try { return JSON.parse(v) } catch { return null }
}

function extractAmountUsd(requirement, payment) {
  const req = safeJson(requirement)
  const pay = safeJson(payment)
  const price = pay?.amount || pay?.price || req?.accepts?.[0]?.price || req?.price || null
  return price != null ? Number(price) : null
}

function buildEvent({ direction, req, res, extra = {} }) {
  const headers = readX402Headers(req, res)
  const record = {
    middleware: 'x402-logging-middleware',
    version: MIDDLEWARE_VERSION,
    direction, // 'inbound' | 'outbound'
    timestamp: new Date().toISOString(),
    method: (req && req.method) || null,
    path: (req && (req.url || req.path)) || null,
    statusCode: (res && res.statusCode) ?? extra.statusCode ?? null,
    asset:
      extra.asset ||
      safeJson(headers.payment)?.asset ||
      safeJson(headers.requirement)?.asset ||
      null,
    amountUsd: extra.amountUsd ?? extractAmountUsd(headers.requirement, headers.payment),
    txHash:
      extra.txHash ||
      safeJson(headers.payment)?.transaction ||
      safeJson(headers.paymentResponse)?.transaction ||
      null,
    x402: {
      payment: headers.payment ? safeJson(headers.payment) : null,
      requirement: headers.requirement ? safeJson(headers.requirement) : null,
      paymentResponse: headers.paymentResponse ? safeJson(headers.paymentResponse) : null,
    },
    ...extra,
  }
  return record
}

/**
 * Create an Express-compatible x402 logging middleware.
 * @param {{ sink?: (e:any)=>void, sampleRate?: number, direction?: 'inbound'|'outbound' }} [options]
 * @returns {(req:any, res:any, next:Function)=>void}
 */
export function createX402LoggingMiddleware(options = {}) {
  const sink = options.sink || defaultSink
  const direction = options.direction || 'inbound'
  const sampleRate = options.sampleRate ?? 1
  return function x402LoggingMiddleware(req, res, next) {
    if (typeof next === 'function') next()
    const origEnd = res && typeof res.end === 'function' ? res.end.bind(res) : null
    const origWriteHead = res && typeof res.writeHead === 'function' ? res.writeHead.bind(res) : null
    function emit() {
      if (sampleRate < 1 && Math.random() > sampleRate) return
      try { sink(buildEvent({ direction, req, res })) } catch (_) { /* never break the request */ }
    }
    if (origWriteHead) {
      res.writeHead = function (...args) {
        try { emit() } catch (_) { /* noop */ }
        return origWriteHead(...args)
      }
    } else if (origEnd) {
      res.end = function (...args) {
        try { emit() } catch (_) { /* noop */ }
        return origEnd(...args)
      }
    } else {
      Promise.resolve().then(emit)
    }
  }
}

/**
 * Log a single x402 payment event manually (client side, or anywhere you don't
 * have a middleware). Returns the event so you can forward it yourself.
 */
export function logX402Payment(detail = {}) {
  const event = buildEvent({
    direction: detail.direction || 'outbound',
    req: {
      method: detail.method,
      url: detail.resource,
      headers: detail.payment ? { 'x-payment': JSON.stringify(detail.payment) } : {},
    },
    res: { statusCode: detail.statusCode ?? 200, getHeaders: () => ({}) },
    extra: {
      asset: detail.asset,
      amountUsd: detail.amountUsd,
      txHash: detail.txHash,
      resource: detail.resource,
      status: detail.status || 'settled',
    },
  })
  defaultSink(event)
  return event
}

export const __internal = { readX402Headers, extractAmountUsd, safeJson, buildEvent }
