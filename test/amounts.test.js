import test from 'node:test'
import assert from 'node:assert/strict'
import { __internal } from '../src/index.js'

const { extractAmountUsd, parseAssetId, decimalsForAsset, fromAtomicUnits } = __internal

function requirement(accept) {
  return JSON.stringify({ accepts: [{ scheme: 'exact', maxTimeoutSeconds: 60, ...accept }] })
}

test('README example: 10000 atomic USDC units on eip155 is 0.01', () => {
  const req = requirement({ asset: 'eip155:8453/erc20:0xUSDC', price: '10000' })
  assert.equal(extractAmountUsd(req, null), 0.01)
})

test('EVM: a whole USDC unit is 1', () => {
  const req = requirement({ asset: 'eip155:8453/erc20:0xUSDC', price: '1000000' })
  assert.equal(extractAmountUsd(req, null), 1)
})

test('Casper mainnet: 1000000000 motes is 1 CSPR', () => {
  const req = requirement({ asset: 'casper:casper/cep18:0e5a5f4e...', price: '1000000000' })
  assert.equal(extractAmountUsd(req, null), 1)
})

test('Casper testnet: 10000000 motes is 0.01 CSPR', () => {
  const req = requirement({ asset: 'casper:casper-test', price: '10000000' })
  assert.equal(extractAmountUsd(req, null), 0.01)
})

test('Casper: a single mote keeps all nine decimals', () => {
  const req = requirement({ asset: 'casper:casper', price: '1' })
  assert.equal(extractAmountUsd(req, null), 0.000000001)
})

test('Casper: a large motes value does not lose precision', () => {
  const req = requirement({ asset: 'casper:casper', price: '123456789123456789' })
  assert.equal(extractAmountUsd(req, null), 123456789.123456789)
})

test('unknown asset falls back to the legacy plain Number behaviour', () => {
  const req = requirement({ asset: 'solana:mainnet/spl:SomeMint', price: '10000' })
  assert.equal(extractAmountUsd(req, null), 10000)
})

test('missing asset falls back to the legacy plain Number behaviour', () => {
  const req = JSON.stringify({ accepts: [{ scheme: 'exact', price: '10000' }] })
  assert.equal(extractAmountUsd(req, null), 10000)
})

test('a bare eip155 network is not treated as a 6 decimal token', () => {
  const req = requirement({ asset: 'eip155:8453', price: '10000' })
  assert.equal(extractAmountUsd(req, null), 10000)
})

test('an already fractional price is left alone', () => {
  const req = requirement({ asset: 'casper:casper', price: '0.01' })
  assert.equal(extractAmountUsd(req, null), 0.01)
})

test('assetDecimals declares decimals for an asset we do not know', () => {
  const req = requirement({ asset: 'solana:mainnet/spl:SomeMint', price: '10000' })
  assert.equal(extractAmountUsd(req, null, { assetDecimals: { 'solana:mainnet': 6 } }), 0.01)
})

test('assetDecimals can be keyed by the full asset id', () => {
  const req = requirement({ asset: 'solana:mainnet/spl:SomeMint', price: '10000' })
  const opts = { assetDecimals: { 'solana:mainnet/spl:SomeMint': 4 } }
  assert.equal(extractAmountUsd(req, null, opts), 1)
})

test('assetDecimals overrides a built in default', () => {
  const req = requirement({ asset: 'casper:casper', price: '10000' })
  assert.equal(extractAmountUsd(req, null, { assetDecimals: { 'casper:casper': 4 } }), 1)
})

test('a payment payload amount wins over the requirement price', () => {
  const req = requirement({ asset: 'casper:casper', price: '1000000000' })
  const pay = JSON.stringify({ scheme: 'exact', network: 'casper:casper', amount: '2000000000' })
  assert.equal(extractAmountUsd(req, pay), 2)
})

test('maxAmountRequired is read when no price is present', () => {
  const req = requirement({ asset: 'casper:casper', maxAmountRequired: '5000000000' })
  assert.equal(extractAmountUsd(req, null), 5)
})

test('no price at all stays null', () => {
  assert.equal(extractAmountUsd(requirement({ asset: 'casper:casper' }), null), null)
  assert.equal(extractAmountUsd(null, null), null)
})

test('parseAssetId splits CAIP-2 and CAIP-19 ids', () => {
  assert.deepEqual(parseAssetId('casper:casper'), {
    network: 'casper:casper',
    namespace: 'casper',
    assetNamespace: null,
  })
  assert.deepEqual(parseAssetId('casper:casper-test/cep18:abc'), {
    network: 'casper:casper-test',
    namespace: 'casper',
    assetNamespace: 'cep18',
  })
  assert.equal(parseAssetId('not-an-asset'), null)
  assert.equal(parseAssetId(null), null)
})

test('decimalsForAsset knows Casper and EVM tokens only', () => {
  assert.equal(decimalsForAsset('casper:casper', null), 9)
  assert.equal(decimalsForAsset('casper:casper-test/cep18:abc', null), 9)
  assert.equal(decimalsForAsset('eip155:8453/erc20:0xUSDC', null), 6)
  assert.equal(decimalsForAsset('cosmos:cosmoshub-4', null), null)
})

test('fromAtomicUnits rejects values it cannot convert exactly', () => {
  assert.equal(fromAtomicUnits('12.5', 9), null)
  assert.equal(fromAtomicUnits('abc', 9), null)
  assert.equal(fromAtomicUnits('100', 0), 100)
  assert.equal(fromAtomicUnits('-1000000000', 9), -1)
})
