// Type definitions for @harpd/x402-logging-middleware

export const MIDDLEWARE_VERSION: string

/**
 * Decimals for assets we do not know about, keyed by CAIP-19 asset id
 * (`sui:mainnet/coin:0xUSDC`) or by CAIP-2 network id (`sui:mainnet`).
 */
export type AssetDecimals = Record<string, number>

export interface X402MiddlewareOptions {
  sink?: (event: any) => void
  sampleRate?: number
  direction?: 'inbound' | 'outbound'
  assetDecimals?: AssetDecimals
}

export type X402Middleware = (req: any, res: any, next: (err?: any) => void) => void

export function createX402LoggingMiddleware(options?: X402MiddlewareOptions): X402Middleware

export interface X402PaymentDetail {
  direction?: 'inbound' | 'outbound'
  method?: string
  resource?: string
  asset?: string
  amountUsd?: number
  txHash?: string
  statusCode?: number
  status?: string
  payment?: unknown
  assetDecimals?: AssetDecimals
}

export function logX402Payment(detail?: X402PaymentDetail): any

export interface ParsedAssetId {
  network: string
  namespace: string
  assetNamespace: string | null
}

export const __internal: {
  readX402Headers: (req: any, res: any) => { payment: any; requirement: any; paymentResponse: any }
  extractAmountUsd: (
    requirement: any,
    payment: any,
    options?: { asset?: string; assetDecimals?: AssetDecimals }
  ) => number | null
  extractAmountAtomic: (requirement: any, payment: any) => string | null
  safeJson: (v: any) => any
  buildEvent: (o: any) => any
  parseAssetId: (asset: any) => ParsedAssetId | null
  decimalsForAsset: (asset: any, overrides?: AssetDecimals | null) => number | null
  fromAtomicUnits: (value: any, decimals: number) => number | null
}
