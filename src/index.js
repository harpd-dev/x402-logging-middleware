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

// x402 quotes prices in the asset's smallest unit: 6-decimal units for USDC on
// EVM chains, motes on Casper (1 CSPR = 1_000_000_000 motes). Without the
// decimals we would report atomic units as dollars, so we keep a small table of
// the ones we know and let callers declare the rest via `assetDecimals`.
const KNOWN_ASSET_DECIMALS = {
  // Casper native CSPR and the wCSPR CEP-18 settlement token.
  'casper:casper': 9,
  'casper:casper-test': 9,
}

// USDC / USDT style ERC-20 stablecoins, the assets x402 settles in on EVM.
const EVM_TOKEN_DECIMALS = 6

// CAIP-19 asset ids look like `<namespace>:<reference>/<assetNamespace>:<assetReference>`.
// The leading `<namespace>:<reference>` on its own is the CAIP-2 network id.
function parseAssetId(asset) {
  if (typeof asset !== 'string') return null
  const [chain, token] = asset.split('/')
  const chainParts = chain.split(':')
  if (chainParts.length < 2 || !chainParts[0] || !chainParts[1]) return null
  const tokenParts = token ? token.split(':') : []
  return {
    network: `${chainParts[0]}:${chainParts[1]}`,
    namespace: chainParts[0],
    assetNamespace: tokenParts[0] || null,
  }
}

// Returns the number of decimals for an asset, or null when we do not know it.
// `overrides` is keyed by full asset id or by CAIP-2 network id.
function decimalsForAsset(asset, overrides) {
  const parsed = parseAssetId(asset)
  if (!parsed) return null
  const declared = (overrides && (overrides[asset] ?? overrides[parsed.network])) ?? null
  if (declared != null && Number.isFinite(Number(declared))) return Number(declared)
  if (KNOWN_ASSET_DECIMALS[parsed.network] != null) return KNOWN_ASSET_DECIMALS[parsed.network]
  // Only token assets (`eip155:8453/erc20:0x...`), never a bare EVM network,
  // because the native coin has 18 decimals and is not what x402 settles in.
  if (parsed.namespace === 'eip155' && parsed.assetNamespace) return EVM_TOKEN_DECIMALS
  return null
}

// Integer string math so we never hand a big atomic value to floating point
// before it has been scaled down. Returns null for anything that is not a
// whole number in string or number form.
function fromAtomicUnits(value, decimals) {
  const raw = String(value).trim()
  if (!/^-?\d+$/.test(raw)) return null
  if (!Number.isInteger(decimals) || decimals < 0) return null
  const negative = raw.startsWith('-')
  const digits = (negative ? raw.slice(1) : raw).replace(/^0+(?=\d)/, '')
  if (decimals === 0) return Number(negative ? `-${digits}` : digits)
  const padded = digits.padStart(decimals + 1, '0')
  const whole = padded.slice(0, padded.length - decimals)
  const fraction = padded.slice(padded.length - decimals)
  const text = `${whole}.${fraction}`
  return Number(negative ? `-${text}` : text)
}

// The asset the price is quoted in. An explicit asset always wins, then the
// payment payload, then the requirement (top level or the first `accepts`
// entry, which is where x402 v2 puts it).
function resolveAsset(requirement, payment, explicit) {
  const req = safeJson(requirement)
  const pay = safeJson(payment)
  return (
    explicit ||
    pay?.asset ||
    pay?.network ||
    req?.asset ||
    req?.accepts?.[0]?.asset ||
    req?.accepts?.[0]?.network ||
    null
  )
}

function extractAmountUsd(requirement, payment, options = {}) {
  const req = safeJson(requirement)
  const pay = safeJson(payment)
  const price =
    pay?.amount ||
    pay?.price ||
    pay?.payload?.amount ||
    req?.accepts?.[0]?.price ||
    req?.price ||
    req?.accepts?.[0]?.maxAmountRequired ||
    null
  if (price == null) return null
  // A fractional value is already denominated, so leave it alone.
  if (String(price).includes('.')) return Number(price)
  const asset = resolveAsset(requirement, payment, options.asset)
  const decimals = decimalsForAsset(asset, options.assetDecimals)
  if (decimals == null) return Number(price)
  const scaled = fromAtomicUnits(price, decimals)
  return scaled == null ? Number(price) : scaled
}

// The raw, unscaled price as a string, kept alongside amountUsd so the exact
// on-chain value survives the conversion.
function extractAmountAtomic(requirement, payment) {
  const req = safeJson(requirement)
  const pay = safeJson(payment)
  const price =
    pay?.amount ||
    pay?.price ||
    pay?.payload?.amount ||
    req?.accepts?.[0]?.price ||
    req?.price ||
    req?.accepts?.[0]?.maxAmountRequired ||
    null
  if (price == null) return null
  return /^-?\d+$/.test(String(price).trim()) ? String(price).trim() : null
}

// `undefined` extras must not blank out a field we just resolved.
function definedOnly(extra) {
  const out = {}
  for (const key of Object.keys(extra)) {
    if (extra[key] !== undefined) out[key] = extra[key]
  }
  return out
}

function buildEvent({ direction, req, res, extra = {}, assetDecimals }) {
  const headers = readX402Headers(req, res)
  const asset = resolveAsset(headers.requirement, headers.payment, extra.asset)
  const record = {
    middleware: 'x402-logging-middleware',
    version: MIDDLEWARE_VERSION,
    direction, // 'inbound' | 'outbound'
    timestamp: new Date().toISOString(),
    method: (req && req.method) || null,
    path: (req && (req.url || req.path)) || null,
    statusCode: (res && res.statusCode) ?? extra.statusCode ?? null,
    asset,
    network: parseAssetId(asset)?.network || null,
    amountUsd: extra.amountUsd ?? extractAmountUsd(headers.requirement, headers.payment, { asset, assetDecimals }),
    amountAtomic: extractAmountAtomic(headers.requirement, headers.payment),
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
    ...definedOnly(extra),
  }
  return record
}

/**
 * Create an Express-compatible x402 logging middleware.
 * @param {{ sink?: (e:any)=>void, sampleRate?: number, direction?: 'inbound'|'outbound', assetDecimals?: Record<string, number> }} [options]
 * @returns {(req:any, res:any, next:Function)=>void}
 */
export function createX402LoggingMiddleware(options = {}) {
  const sink = options.sink || defaultSink
  const direction = options.direction || 'inbound'
  const sampleRate = options.sampleRate ?? 1
  const assetDecimals = options.assetDecimals || null
  return function x402LoggingMiddleware(req, res, next) {
    if (typeof next === 'function') next()
    const origEnd = res && typeof res.end === 'function' ? res.end.bind(res) : null
    const origWriteHead = res && typeof res.writeHead === 'function' ? res.writeHead.bind(res) : null
    function emit() {
      if (sampleRate < 1 && Math.random() > sampleRate) return
      try { sink(buildEvent({ direction, req, res, assetDecimals })) } catch (_) { /* never break the request */ }
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
    assetDecimals: detail.assetDecimals,
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

export const __internal = {
  readX402Headers,
  extractAmountUsd,
  extractAmountAtomic,
  safeJson,
  buildEvent,
  parseAssetId,
  decimalsForAsset,
  fromAtomicUnits,
}
