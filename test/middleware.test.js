import test from 'node:test'
import assert from 'node:assert/strict'
import { createX402LoggingMiddleware, logX402Payment, MIDDLEWARE_VERSION } from '../src/index.js'

// A Casper deploy hash is 64 hex characters with no 0x prefix.
const DEPLOY_HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'

// Minimal req / res stand ins, enough for the middleware's writeHead hook.
function fakeReq(headers = {}, { method = 'GET', url = '/paid-resource' } = {}) {
  return { method, url, headers }
}

function fakeRes(headers = {}) {
  const store = { ...headers }
  return {
    statusCode: 200,
    getHeaders: () => store,
    setHeader(name, value) { store[String(name).toLowerCase()] = value },
    writeHead(code) { this.statusCode = code; return this },
    end() { return this },
  }
}

function runMiddleware(req, res, options = {}) {
  const events = []
  const middleware = createX402LoggingMiddleware({ sink: (e) => events.push(e), ...options })
  middleware(req, res, () => {})
  res.statusCode = options.statusCode ?? res.statusCode
  res.writeHead(options.statusCode ?? res.statusCode)
  res.end()
  return events
}

test('inbound 402 Casper challenge emits a full event', () => {
  const challenge = {
    accepts: [{
      scheme: 'exact',
      asset: 'casper:casper/cep18:0e5a5f4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c',
      price: '10000000',
      payTo: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef01',
      maxTimeoutSeconds: 60,
    }],
  }
  const res = fakeRes({ 'www-authenticate': JSON.stringify(challenge) })
  const events = runMiddleware(fakeReq(), res, { statusCode: 402 })

  assert.equal(events.length, 1)
  const event = events[0]
  assert.equal(event.middleware, 'x402-logging-middleware')
  assert.equal(event.version, MIDDLEWARE_VERSION)
  assert.equal(event.direction, 'inbound')
  assert.equal(typeof event.timestamp, 'string')
  assert.equal(event.method, 'GET')
  assert.equal(event.path, '/paid-resource')
  assert.equal(event.statusCode, 402)
  assert.equal(event.asset, challenge.accepts[0].asset)
  assert.equal(event.network, 'casper:casper')
  assert.equal(event.amountUsd, 0.01)
  assert.equal(event.amountAtomic, '10000000')
  assert.equal(event.txHash, null)
  assert.deepEqual(event.x402, {
    payment: null,
    requirement: challenge,
    paymentResponse: null,
  })
})

test('inbound Casper settlement reads the X-Payment header and deploy hash', () => {
  const payment = {
    scheme: 'exact',
    network: 'casper:casper',
    payload: { amount: '2500000000' },
    transaction: DEPLOY_HASH,
  }
  const req = fakeReq({ 'x-payment': JSON.stringify(payment) }, { method: 'POST' })
  const events = runMiddleware(req, fakeRes(), { statusCode: 200 })

  assert.equal(events.length, 1)
  const event = events[0]
  assert.equal(event.statusCode, 200)
  assert.equal(event.asset, 'casper:casper')
  assert.equal(event.network, 'casper:casper')
  assert.equal(event.amountUsd, 2.5)
  assert.equal(event.txHash, DEPLOY_HASH)
  assert.match(event.txHash, /^[0-9a-f]{64}$/)
  assert.equal(event.x402.payment.scheme, 'exact')
})

test('the README EVM challenge now logs the documented 0.01', () => {
  const challenge = {
    accepts: [{ scheme: 'exact', asset: 'eip155:8453/erc20:0xUSDC', price: '10000', maxTimeoutSeconds: 60 }],
  }
  const res = fakeRes({ 'www-authenticate': JSON.stringify(challenge) })
  const events = runMiddleware(fakeReq(), res, { statusCode: 402 })
  assert.equal(events[0].amountUsd, 0.01)
  assert.equal(events[0].network, 'eip155:8453')
})

test('assetDecimals on the middleware covers assets we do not know', () => {
  const challenge = { accepts: [{ scheme: 'exact', asset: 'sui:mainnet/coin:0xUSDC', price: '10000' }] }
  const res = fakeRes({ 'www-authenticate': JSON.stringify(challenge) })
  const events = runMiddleware(fakeReq(), res, {
    statusCode: 402,
    assetDecimals: { 'sui:mainnet': 6 },
  })
  assert.equal(events[0].amountUsd, 0.01)
})

test('an unknown asset keeps the legacy value through the middleware', () => {
  const challenge = { accepts: [{ scheme: 'exact', asset: 'sui:mainnet/coin:0xUSDC', price: '10000' }] }
  const res = fakeRes({ 'www-authenticate': JSON.stringify(challenge) })
  const events = runMiddleware(fakeReq(), res, { statusCode: 402 })
  assert.equal(events[0].amountUsd, 10000)
})

test('malformed headers never throw and never break the response', () => {
  const cases = [
    { 'x-payment': '{not json' },
    { 'x-payment': '' },
    { 'x-payment': JSON.stringify({ amount: {} }) },
    { 'x-payment': JSON.stringify({ network: 12345, amount: 'NaN' }) },
  ]
  for (const headers of cases) {
    const res = fakeRes({ 'www-authenticate': '<<<garbage>>>' })
    let events
    assert.doesNotThrow(() => { events = runMiddleware(fakeReq(headers), res, { statusCode: 402 }) })
    assert.equal(events.length, 1)
    assert.equal(events[0].statusCode, 402)
  }
})

test('a throwing sink never breaks the request', () => {
  const middleware = createX402LoggingMiddleware({ sink: () => { throw new Error('sink down') } })
  const res = fakeRes()
  assert.doesNotThrow(() => {
    middleware(fakeReq(), res, () => {})
    res.writeHead(402)
    res.end()
  })
})

test('outbound Casper settlement via logX402Payment', () => {
  const event = logX402Payment({
    direction: 'outbound',
    resource: 'https://paid-api.example.com/v1/weather',
    asset: 'casper:casper/cep18:0e5a5f4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c',
    payment: { scheme: 'exact', network: 'casper:casper', payload: { amount: '10000000' } },
    txHash: DEPLOY_HASH,
    status: 'settled',
  })

  assert.equal(event.direction, 'outbound')
  assert.equal(event.network, 'casper:casper')
  assert.equal(event.amountUsd, 0.01)
  assert.equal(event.amountAtomic, '10000000')
  assert.equal(event.txHash, DEPLOY_HASH)
  assert.equal(event.txHash.startsWith('0x'), false)
  assert.equal(event.status, 'settled')
  assert.equal(event.resource, 'https://paid-api.example.com/v1/weather')
})

test('an explicit amountUsd still wins over anything we derive', () => {
  const event = logX402Payment({
    resource: 'https://paid-api.example.com/v1/weather',
    asset: 'casper:casper',
    amountUsd: 42,
    payment: { amount: '10000000' },
    txHash: DEPLOY_HASH,
  })
  assert.equal(event.amountUsd, 42)

  const challenge = { accepts: [{ scheme: 'exact', asset: 'casper:casper', price: '10000000' }] }
  const res = fakeRes({ 'www-authenticate': JSON.stringify(challenge) })
  const events = []
  const middleware = createX402LoggingMiddleware({ sink: (e) => events.push(e) })
  middleware(fakeReq(), res, () => {})
  res.writeHead(402)
  assert.equal(events[0].amountUsd, 0.01)
})

test('an explicit asset still wins over the headers', () => {
  const event = logX402Payment({
    resource: 'https://paid-api.example.com/v1/weather',
    asset: 'casper:casper-test',
    payment: { network: 'casper:casper', amount: '1000000000' },
  })
  assert.equal(event.asset, 'casper:casper-test')
  assert.equal(event.amountUsd, 1)
})
