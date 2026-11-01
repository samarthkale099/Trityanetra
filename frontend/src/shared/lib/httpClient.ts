import { apiUrl, API_TIMEOUT_MS } from '@/shared/lib/env'
import type { ApiErrorBody } from '@/shared/types'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export const ErrorCode = {
  TIMEOUT: 'TIMEOUT',
  NETWORK: 'NETWORK_ERROR',
  ABORTED: 'ABORTED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  HTTP: 'HTTP_ERROR',
} as const

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode]

export interface ApiErrorInit {
  status: number
  code?: string
  details?: unknown
  cause?: unknown
}

/** Every failure the client can produce is an ApiError, so callers have one shape to handle. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown

  constructor(message: string, init: ApiErrorInit) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause })
    this.name = 'ApiError'
    this.status = init.status
    this.code = init.code ?? ErrorCode.HTTP
    this.details = init.details
  }

  /** No HTTP response arrived: offline, DNS failure, connection reset. */
  get isNetworkError(): boolean {
    return this.code === ErrorCode.NETWORK
  }

  get isTimeout(): boolean {
    return this.code === ErrorCode.TIMEOUT
  }

  /** Caller-initiated cancellation (React unmount, superseded search). Not a failure to surface. */
  get isAborted(): boolean {
    return this.code === ErrorCode.ABORTED
  }

  get isUnauthorized(): boolean {
    return this.status === 401
  }

  /** True when retrying the exact same request unchanged could plausibly succeed. */
  get isRetryable(): boolean {
    return (
      this.isNetworkError ||
      this.isTimeout ||
      this.status === 429 ||
      (this.status >= 500 && this.status <= 599)
    )
  }
}

export interface HttpOptions {
  headers?: Record<string, string>
  /** Explicit token. Overrides the client-wide token provider; `null` sends no header. */
  token?: string | null
  body?: unknown
  signal?: AbortSignal
  /** Milliseconds before the request is aborted. Defaults to the configured timeout. */
  timeoutMs?: number
  /** Set false to opt out of the automatic 401 refresh-and-retry. */
  retryOnUnauthorized?: boolean
}

export interface HttpClientConfig {
  /** Returns the current ID token, or null when signed out. */
  getToken: () => Promise<string | null> | string | null
  /**
   * Obtains a fresh ID token after a 401. Return null when the session cannot
   * be recovered (the client then signs out). Concurrent 401s share one call.
   */
  refreshToken?: () => Promise<string | null>
  /** Invoked once when a 401 survives the refresh, so the app can sign the user out. */
  onUnauthorized?: (error: ApiError) => void
}

let config: HttpClientConfig = { getToken: () => null }

/** Wires the auth layer into the client. Called once by AuthProvider on mount. */
export function configureHttpClient(next: HttpClientConfig): void {
  config = next
}

function fallbackMessage(status: number): string {
  switch (status) {
    case 400:
      return "That request isn't valid. Check the details and try again."
    case 401:
      return 'Your session has expired. Please sign in again.'
    case 403:
      return "You don't have permission to do that."
    case 404:
      return 'That page or record could not be found.'
    case 409:
      return 'That conflicts with something that already exists.'
    case 422:
      return 'Some of the details are not valid. Review and try again.'
    case 429:
      return 'Too many requests in a short time. Wait a moment and try again.'
    default:
      return status >= 500
        ? 'Something went wrong on our side. Please try again.'
        : 'That request could not be completed.'
  }
}

async function readErrorBody(response: Response): Promise<ApiErrorBody | undefined> {
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) return undefined
  try {
    return (await response.json()) as ApiErrorBody
  } catch {
    return undefined
  }
}

interface TimeoutHandle {
  signal: AbortSignal
  /** True when the abort came from the timeout rather than the caller. */
  timedOut: () => boolean
  dispose: () => void
}

/**
 * Combines the caller's abort signal with a timeout, and keeps the two causes
 * distinguishable so a cancellation is not reported to the user as a failure.
 * Returns a disposer so the timer is always cleared — a leaked 15s timer per
 * request keeps the Node event loop alive and holds the response in memory.
 */
function withTimeout(timeoutMs: number, external?: AbortSignal): TimeoutHandle {
  const controller = new AbortController()
  let timedOut = false

  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  const forwardAbort = () => controller.abort()
  if (external) {
    if (external.aborted) controller.abort()
    else external.addEventListener('abort', forwardAbort, { once: true })
  }

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer)
      external?.removeEventListener('abort', forwardAbort)
    },
  }
}

/**
 * Single-flight guard: a burst of parallel 401s must trigger exactly one token
 * refresh, otherwise each request races its own refresh and most fail.
 */
let refreshInFlight: Promise<string | null> | null = null

function refreshOnce(): Promise<string | null> {
  if (!config.refreshToken) return Promise.resolve(null)
  if (!refreshInFlight) {
    refreshInFlight = Promise.resolve()
      .then(() => config.refreshToken?.() ?? null)
      .catch(() => null)
      .finally(() => {
        refreshInFlight = null
      })
  }
  return refreshInFlight
}

interface RequestArgs extends HttpOptions {
  method: HttpMethod
  path: string
  /** Internal: prevents infinite 401 retry loops. */
  isRetry?: boolean
}

async function performRequest<T>({
  method,
  path,
  headers = {},
  token,
  body,
  signal,
  timeoutMs = API_TIMEOUT_MS,
  retryOnUnauthorized = true,
  isRetry = false,
}: RequestArgs): Promise<T> {
  const timeout = withTimeout(timeoutMs, signal)
  const requestSignal = timeout.signal

  // Fail fast on an already-aborted request. Dispatching `fetch` here would
  // still hit the network, and an `abort` listener attached afterwards never
  // fires — the request would hang until the timeout instead.
  if (requestSignal.aborted) {
    timeout.dispose()
    throw new ApiError('Request cancelled.', { status: 0, code: ErrorCode.ABORTED })
  }

  let authToken: string | null
  try {
    authToken = token === undefined ? await config.getToken() : token
  } catch {
    // A token provider that throws must not take the request down; send it
    // unauthenticated and let the server return a clean 401.
    authToken = null
  }

  // Re-check: resolving the token can involve a network round trip (a forced
  // Firebase refresh), and the caller may have cancelled in the meantime.
  // Dispatching now would send a request the caller already gave up on.
  if (requestSignal.aborted) {
    timeout.dispose()
    throw new ApiError('Request cancelled.', { status: 0, code: ErrorCode.ABORTED })
  }

  let response: Response
  try {
    response = await fetch(apiUrl(path), {
      method,
      signal: requestSignal,
      credentials: 'omit',
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        // The token is a credential: it travels in a header only, never in a
        // URL, a query string, or a log line.
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (cause) {
    timeout.dispose()
    if (requestSignal.aborted) {
      if (timeout.timedOut()) {
        throw new ApiError('The server took too long to respond. Check your connection and try again.', {
          status: 0,
          code: ErrorCode.TIMEOUT,
          cause,
        })
      }
      throw new ApiError('Request cancelled.', { status: 0, code: ErrorCode.ABORTED, cause })
    }
    throw new ApiError('Could not reach the server. Check your connection and try again.', {
      status: 0,
      code: ErrorCode.NETWORK,
      cause,
    })
  }
  timeout.dispose()

  if (response.status === 401) {
    if (retryOnUnauthorized) {
      // Exactly one refresh, then one replay. `isRetry` stops the replay from
      // refreshing again, so a genuinely dead session terminates instead of
      // looping between refresh and retry.
      if (!isRetry) {
        const freshToken = await refreshOnce()
        if (freshToken) {
          return performRequest<T>({ method, path, headers, token: freshToken, body, signal, timeoutMs, isRetry: true })
        }
      }
      // The session is unrecoverable: tell the app so it can sign the user out.
      // Skipped when the caller opted out, so a single failing call (e.g. the
      // session exchange) cannot force a global sign-out.
      const error = new ApiError(fallbackMessage(401), { status: 401, code: ErrorCode.UNAUTHORIZED })
      config.onUnauthorized?.(error)
      throw error
    }
    const errorBody = await readErrorBody(response)
    throw new ApiError(errorBody?.message ?? fallbackMessage(401), {
      status: 401,
      code: errorBody?.code ?? ErrorCode.UNAUTHORIZED,
      details: errorBody?.details,
    })
  }

  if (!response.ok) {
    const errorBody = await readErrorBody(response)
    throw new ApiError(errorBody?.message ?? fallbackMessage(response.status), {
      status: response.status,
      code: errorBody?.code ?? ErrorCode.HTTP,
      details: errorBody?.details,
    })
  }

  if (response.status === 204 || response.status === 205) {
    return undefined as T
  }

  const text = await response.text()
  if (text.length === 0) return undefined as T
  try {
    return JSON.parse(text) as T
  } catch (cause) {
    throw new ApiError('The server sent a response we could not read.', {
      status: response.status,
      code: ErrorCode.HTTP,
      cause,
    })
  }
}

function request<T>(method: HttpMethod, path: string, options: HttpOptions = {}): Promise<T> {
  return performRequest<T>({ ...options, method, path })
}

export const http = {
  get: <T>(path: string, options?: HttpOptions) => request<T>('GET', path, options),
  post: <T>(path: string, options?: HttpOptions) => request<T>('POST', path, options),
  put: <T>(path: string, options?: HttpOptions) => request<T>('PUT', path, options),
  patch: <T>(path: string, options?: HttpOptions) => request<T>('PATCH', path, options),
  delete: <T>(path: string, options?: HttpOptions) => request<T>('DELETE', path, options),
}
