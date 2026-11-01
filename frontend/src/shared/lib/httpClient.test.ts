import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, ErrorCode, configureHttpClient, http } from '@/shared/lib/httpClient'
import { redactToken } from '@/shared/lib/jwt'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Awaits a rejection as an ApiError, and fails loudly if it resolves. */
async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise
  } catch (error) {
    return error as ApiError
  }
  throw new Error('Expected the request to reject, but it resolved.')
}

describe('httpClient', () => {
  const fetchMock = vi.fn()
  let token: string | null = null
  let refreshToken: ReturnType<typeof vi.fn<() => Promise<string | null>>>
  let onUnauthorized: ReturnType<typeof vi.fn<(error: ApiError) => void>>

  /** `fetch` is stubbed, so the RequestInit handed to it is plain test data. */
  function requestInit(call = 0): { url: string; init: RequestInit & { headers: Record<string, string> } } {
    const [url, init] = fetchMock.mock.calls[call] as [string, RequestInit & { headers: Record<string, string> }]
    return { url, init }
  }

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    token = null
    refreshToken = vi.fn(async () => 'fresh-token')
    onUnauthorized = vi.fn()
    configureHttpClient({ getToken: () => token, refreshToken, onUnauthorized })
  })

  afterEach(() => {
    fetchMock.mockReset()
    vi.unstubAllGlobals()
    configureHttpClient({ getToken: () => null })
  })

  it('GET attaches the configured ID token and parses JSON', async () => {
    token = 'tok-1'
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))

    const result = await http.get<{ ok: boolean }>('/api/foo')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const { url, init } = requestInit()
    expect(url).toBe('/api/foo')
    expect(init.headers.Authorization).toBe('Bearer tok-1')
    expect(init.method).toBe('GET')
    expect(result).toEqual({ ok: true })
  })

  it('sends no Authorization header when signed out', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}))
    await http.get('/api/foo')
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined()
  })

  it('never sends a Content-Type on a bodyless request', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}))
    await http.get('/api/foo')
    expect(fetchMock.mock.calls[0][1].headers['Content-Type']).toBeUndefined()
  })

  it('POST stringifies the body and sets Content-Type', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 7 }))
    await http.post('/api/foo', { body: { email: 'a@example.com' } })

    const { init } = requestInit()
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ email: 'a@example.com' }))
    expect(init.headers['Content-Type']).toBe('application/json')
  })

  it('PUT is available alongside PATCH', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}))
    await http.put('/api/foo', { body: { a: 1 } })
    expect(requestInit().init.method).toBe('PUT')
  })

  it('fails with a structured ApiError on non-2xx, using the server message', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'Out of chalk.', code: 'X' }, 422))
    const error = await rejection(http.get('/api/foo'))

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(422)
    expect(error.message).toBe('Out of chalk.')
    expect(error.code).toBe('X')
    expect(error.isRetryable).toBe(false)
  })

  it('carries Zod-style validation details through', async () => {
    const details = [{ path: ['email'], message: 'Invalid' }]
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'bad', code: 'VALIDATION_ERROR', details }, 400))
    const error = await rejection(http.post('/api/foo', { body: {} }))
    expect(error.code).toBe('VALIDATION_ERROR')
    expect(error.details).toEqual(details)
  })

  it('falls back to a friendly message when the server sends none', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 500))
    const error = await rejection(http.get('/api/foo'))
    expect(error.status).toBe(500)
    expect(error.message).toMatch(/went wrong on our side/)
    expect(error.isRetryable).toBe(true)
  })

  it('returns undefined for 204 no-content responses', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await expect(http.delete('/api/foo')).resolves.toBeUndefined()
  })

  it('returns undefined for an empty 200 body', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 200 }))
    await expect(http.get('/api/foo')).resolves.toBeUndefined()
  })

  it('normalises a network failure instead of leaking the TypeError', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const error = await rejection(http.get('/api/foo'))

    expect(error).toBeInstanceOf(ApiError)
    expect(error.isNetworkError).toBe(true)
    expect(error.code).toBe(ErrorCode.NETWORK)
    expect(error.status).toBe(0)
    expect(error.isRetryable).toBe(true)
    expect(error.message).toMatch(/could not reach the server/i)
  })

  it('times out slow responses and reports a timeout, not a network error', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        }),
    )

    const pending = rejection(http.get('/api/foo', { timeoutMs: 50 }))
    await vi.advanceTimersByTimeAsync(60)
    const error = await pending
    vi.useRealTimers()

    expect(error.isTimeout).toBe(true)
    expect(error.code).toBe(ErrorCode.TIMEOUT)
    expect(error.isNetworkError).toBe(false)
  })

  it('reports a caller-initiated abort as cancelled, not as a failure to surface', async () => {
    const controller = new AbortController()
    fetchMock.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        }),
    )

    const pending = rejection(http.get('/api/foo', { signal: controller.signal }))
    controller.abort()
    const error = await pending

    expect(error.isAborted).toBe(true)
    expect(error.isTimeout).toBe(false)
    expect(error.isNetworkError).toBe(false)
  })

  it('does not send a request whose signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const error = await rejection(http.get('/api/foo', { signal: controller.signal }))
    expect(error.isAborted).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refreshes once on 401 and replays the request with the new token', async () => {
    token = 'stale-token'
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: 'nope' }, 401))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))

    await expect(http.get('/api/foo')).resolves.toEqual({ ok: true })
    expect(refreshToken).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer stale-token')
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer fresh-token')
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('gives up after one retry rather than looping on a persistent 401', async () => {
    token = 'stale-token'
    fetchMock.mockResolvedValue(jsonResponse({ message: 'still nope' }, 401))

    const error = await rejection(http.get('/api/foo'))

    expect(error.isUnauthorized).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('signs the user out when the refresh cannot recover the session', async () => {
    token = 'stale-token'
    refreshToken.mockResolvedValue(null)
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'nope' }, 401))

    const error = await rejection(http.get('/api/foo'))

    expect(error.isUnauthorized).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('collapses a burst of parallel 401s into a single refresh', async () => {
    token = 'stale-token'
    let resolveRefresh: (value: string) => void = () => {}
    refreshToken.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveRefresh = resolve
        }),
    )
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string> | undefined
      if (headers?.Authorization === 'Bearer stale-token') return jsonResponse({ message: 'nope' }, 401)
      return jsonResponse({ ok: true })
    })

    const inFlight = Promise.all([http.get('/api/a'), http.get('/api/b'), http.get('/api/c')])
    await vi.waitFor(() => expect(refreshToken).toHaveBeenCalled())
    resolveRefresh('fresh-token')

    await expect(inFlight).resolves.toEqual([{ ok: true }, { ok: true }, { ok: true }])
    expect(refreshToken).toHaveBeenCalledTimes(1)
  })

  it('treats a refresh that throws as a failed refresh', async () => {
    token = 'stale-token'
    refreshToken.mockRejectedValue(new Error('offline'))
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'nope' }, 401))

    const error = await rejection(http.get('/api/foo'))
    expect(error.isUnauthorized).toBe(true)
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('can opt a call out of the 401 refresh', async () => {
    token = 'stale-token'
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'nope' }, 401))

    const error = await rejection(http.get('/api/foo', { retryOnUnauthorized: false }))

    expect(error.isUnauthorized).toBe(true)
    // A caller that opts out owns the failure, so a global sign-out is not fired.
    expect(onUnauthorized).not.toHaveBeenCalled()
    expect(refreshToken).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps going when the token provider itself throws', async () => {
    configureHttpClient({
      getToken: () => {
        throw new Error('firebase not ready')
      },
    })
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))

    await expect(http.get('/api/foo')).resolves.toEqual({ ok: true })
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined()
  })

  it('does not log the token anywhere', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})

    token = 'super-secret-token'
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'nope' }, 401))

    await http.get('/api/foo').catch(() => undefined)

    const printed = [logSpy, errorSpy, warnSpy, debugSpy]
      .flatMap((spy) => spy.mock.calls)
      .flat()
      .join(' ')
    expect(printed).not.toContain('super-secret-token')
    // The redaction helper exists for the places that must describe a token.
    expect(redactToken('super-secret-token')).toBe('<redacted:18>')

    logSpy.mockRestore()
    errorSpy.mockRestore()
    warnSpy.mockRestore()
    debugSpy.mockRestore()
  })
})
