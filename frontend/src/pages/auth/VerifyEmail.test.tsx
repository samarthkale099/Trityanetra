import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { http as mswHttp, HttpResponse } from 'msw'
import { server } from '@/tests/msw/server'
import { renderWithProviders } from '@/tests/renderWithProviders'
import { VerifyEmailPage } from './VerifyEmail'

function renderAt(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/verify-email" element={<VerifyEmailPage />} />
    </Routes>,
    { route },
  )
}

describe('VerifyEmailPage', () => {
  it('confirms the email with the token from the link and offers sign-in', async () => {
    let sentToken: unknown = null
    server.use(
      mswHttp.post('/api/auth/verify-email', async ({ request }) => {
        sentToken = ((await request.json()) as { token?: string }).token
        return HttpResponse.json({ message: 'Email verified. You can now log in.' })
      }),
    )
    renderAt('/verify-email?token=abc123')

    expect(await screen.findByRole('heading', { name: 'Email confirmed' })).toBeVisible()
    expect(sentToken).toBe('abc123')
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/login')
  })

  it('explains an expired or used link instead of failing silently', async () => {
    server.use(
      mswHttp.post('/api/auth/verify-email', () =>
        HttpResponse.json({ error: 'Invalid or expired verification link' }, { status: 400 }),
      ),
    )
    renderAt('/verify-email?token=old')

    expect(await screen.findByRole('heading', { name: 'This link does not work' })).toBeVisible()
  })

  it('treats a link with no token as broken without calling the server', async () => {
    renderAt('/verify-email')
    expect(await screen.findByRole('heading', { name: 'This link does not work' })).toBeVisible()
  })
})
