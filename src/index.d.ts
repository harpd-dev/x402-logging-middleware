// Type definitions for @harpd/x402-logging-middleware

export const MIDDLEWARE_VERSION: string

export interface X402MiddlewareOptions {
  sink?: (event: any) => void
  sampleRate?: number
  direction?: 'inbound' | 'outbound'
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
}

export function logX402Payment(detail?: X402PaymentDetail): any

export const __internal: {
  readX402Headers: (req: any, res: any) => { payment: any; requirement: any; paymentResponse: any }
  extractAmountUsd: (requirement: any, payment: any) => number | null
  safeJson: (v: any) => any
  buildEvent: (o: any) => any
}
