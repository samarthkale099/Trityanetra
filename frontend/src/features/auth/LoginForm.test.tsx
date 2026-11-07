import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router-dom'
import { http as mswHttp, HttpResponse } from 'msw'
import { server } from '@/tests/msw/server'
import { API, makeProfile } from '@/tests/msw/handlers'
import { FakeAuthError, installFakeAuth, type FakeAuthDriverHandle } from '@/tests/fakeAuthDriver'
import { renderWithProviders } from '@/tests/renderWithProviders'
import { setAuthDriver } from '@/features/auth/authApi'
import { LoginForm } from '@/features/auth/LoginForm'

const ACCOUNT = {
  uid: 'u-1',
  email: 'riya@mit.ac.in',
  password: 'secret123',
  displayName: 'Riya Sharma',
}

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="pathname">{location.pathname}</div>
}

/**
 * Real routes, so the form actually unmounts on navigation like it does in the app.
 * Both role homes are declared: the fixture account is a STUDENT, so it lands on
 * `/app/student`, and a route table missing it would render nothing and silently
 * make every navigation assertion pass or fail for the wrong reason.
 */
function renderForm() {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/login" element={<LoginForm />} />
        <Route path="/app/student" element={<div>Student home</div>} />
        <Route path="/app/classrooms" element={<div>Classrooms</div>} />
        <Route path="/app/dashboard" element={<div>Account</div>} />
      </Routes>
      <LocationProbe />
    </>,
    { route: '/login' },
  )
}

let auth: FakeAuthDriverHandle

describe('LoginForm', () => {
  beforeEach(() => {
    auth = installFakeAuth({ accounts: [ACCOUNT] })
  })

  it('renders labelled, autocomplete-correct fields and a submit button', () => {
    renderForm()
    const email = screen.getByLabelText('Email')
    const password = screen.getByLabelText('Password')
    expect(email).toHaveAttribute('type', 'email')
    expect(email).toHaveAttribute('autocomplete', 'email')
    expect(password).toHaveAttribute('autocomplete', 'current-password')
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
  })

  it('shows inline validation errors for empty fields and stays on the page', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Enter your email address.')).toBeInTheDocument()
    expect(screen.getByText('Enter your password.')).toBeInTheDocument()
    expect(screen.getByTestId('pathname')).toHaveTextContent('/login')
  })

  /*
   * A field that is fine must not say it is not. `aria-invalid` is written as
   * the string "false" on an untouched field, and the error styling is keyed on
   * `="true"`, so the border only turns red once there is a real error.
   */
  it('does not mark an untouched, empty field as invalid', async () => {
    const user = userEvent.setup()
    renderForm()

    const email = screen.getByLabelText('Email')
    expect(email).toHaveAttribute('aria-invalid', 'false')
    expect(email).not.toHaveAttribute('aria-invalid', 'true')
    // The live region is always mounted; what must not be there is its message.
    expect(screen.queryByText('Enter your email address.')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Enter your email address.')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true')
  })

  it('rejects a malformed email', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.type(screen.getByLabelText('Email'), 'nope')
    await user.type(screen.getByLabelText('Password'), 'whatever01')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText(/not formatted correctly/)).toBeInTheDocument()
  })

  it('toggles password visibility from the keyboard and reports the pressed state', async () => {
    const user = userEvent.setup()
    renderForm()
    const password = screen.getByLabelText('Password')
    const toggle = screen.getByRole('button', { name: 'Show password' })

    expect(password).toHaveAttribute('type', 'password')
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(toggle).toHaveAttribute('aria-controls', password.id)

    toggle.focus()
    await user.keyboard('{Enter}')

    const hide = await screen.findByRole('button', { name: 'Hide password' })
    expect(password).toHaveAttribute('type', 'text')
    expect(hide).toHaveAttribute('aria-pressed', 'true')

    await user.click(hide)
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
  })

  /*
   * Edge injects its own reveal control into every password field (styling it
   * through ::-ms-reveal), which is what rendered two eyes side by side. CSS
   * removes it; this pins the DOM half of that contract -- exactly one toggle
   * button, holding exactly one icon, whatever state the field is in.
   */
  it('renders exactly one password toggle, in the resting and error states', async () => {
    const user = userEvent.setup()
    renderForm()

    const toggle = screen.getByRole('button', { name: 'Show password' })
    expect(screen.getAllByRole('button', { name: /password/i })).toHaveLength(1)
    expect(toggle.querySelectorAll('svg')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Enter your password.')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true')
    const toggles = screen.getAllByRole('button', { name: /password/i })
    expect(toggles).toHaveLength(1)
    expect(toggles[0].querySelectorAll('svg')).toHaveLength(1)
  })

  it('signs in and redirects to the role home', async () => {
    server.use(mswHttp.get(API.me, () => HttpResponse.json({ user: makeProfile() })))
    const user = userEvent.setup()
    renderForm()

    await user.type(screen.getByLabelText('Email'), 'riya@mit.ac.in')
    await user.type(screen.getByLabelText('Password'), 'secret123')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(screen.getByTestId('pathname'))        .toHaveTextContent('/app/student'))
  })

  it('disables the fields and shows a busy state until the server confirms the session', async () => {
    server.use(
      mswHttp.get(API.me, async () => {
        // Long enough that a busy machine cannot finish the round trip before
        // the assertions below run.
        await new Promise((resolve) => setTimeout(resolve, 1000))
        return HttpResponse.json({ user: makeProfile() })
      }),
    )
    const user = userEvent.setup()
    renderForm()

    await user.type(screen.getByLabelText('Email'), 'riya@mit.ac.in')
    await user.type(screen.getByLabelText('Password'), 'secret123')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    // Held for the whole round trip, not just the instant Firebase call: the
    // role that decides the destination only exists in the server's answer.
    const busy = await screen.findByRole('button', { name: /signing in/i })
    expect(busy).toBeDisabled()
    expect(screen.getByLabelText('Email')).toBeDisabled()
    expect(screen.getByLabelText('Password')).toBeDisabled()
  })

  it('does not hang when the account cannot be loaded, and says so instead of guessing a role', async () => {
    server.use(mswHttp.get(API.me, () => HttpResponse.error()))
    const user = userEvent.setup()
    renderForm()

    await user.type(screen.getByLabelText('Email'), 'riya@mit.ac.in')
    await user.type(screen.getByLabelText('Password'), 'secret123')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    // Not stranded on a spinner, and not sent to a guessed (student) home.
    await waitFor(
      () => {
        expect(screen.getByRole('alert')).toHaveTextContent(/could not load your account/i)
        expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
      },
      { timeout: 6000 },
    )
    expect(screen.getByTestId('pathname')).toHaveTextContent('/login')
  })

  it('shows an accessible inline error for wrong credentials and stays put', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.type(screen.getByLabelText('Email'), 'riya@mit.ac.in')
    await user.type(screen.getByLabelText('Password'), 'wrong-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/email or password is incorrect/i)
    expect(screen.getByTestId('pathname')).toHaveTextContent('/login')
  })

  it('describes an account that does not exist without leaking which part was wrong', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.type(screen.getByLabelText('Email'), 'nobody@mit.ac.in')
    await user.type(screen.getByLabelText('Password'), 'secret123')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/email or password is incorrect/i)
  })

  it('ignores a second submit while the first is in flight', async () => {
    let sessionCalls = 0
    // The response is released by this test rather than by a timer, so "in
    // flight" is a state the test controls instead of a wall-clock guess. With
    // a setTimeout the extra activations below could land after the first
    // request had already settled - at which point submitting again is correct
    // behaviour, and the test would fail for a reason that had nothing to do
    // with the guard it is meant to cover.
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    server.use(
      mswHttp.get(API.me, async () => {
        sessionCalls += 1
        await held
        return HttpResponse.json({ user: makeProfile() })
      }),
    )
    const user = userEvent.setup()
    renderForm()

    await user.type(screen.getByLabelText('Email'), 'riya@mit.ac.in')
    await user.type(screen.getByLabelText('Password'), 'secret123')
    const submit = screen.getByRole('button', { name: 'Sign in' })
    await user.click(submit)

    // Still busy: the button is disabled and further activations are inert.
    const busy = await screen.findByRole('button', { name: /signing in/i })
    expect(busy).toBeDisabled()
    await user.click(busy).catch(() => undefined)
    await user.keyboard('{Enter}')

    // The request is provably still open, so this is the in-flight window. One
    // session exchange for one sign-in attempt, not two, and no navigation yet.
    expect(sessionCalls).toBe(1)
    expect(screen.getByTestId('pathname')).toHaveTextContent('/login')

    release()
    await waitFor(() => expect(screen.getByTestId('pathname'))        .toHaveTextContent('/app/student'))
    // The form has unmounted, so nothing queued can add another exchange.
    expect(sessionCalls).toBe(1)
  })

  it('never writes the password to the console when sign-in fails', async () => {
    const spies = (['error', 'warn', 'log'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    )
    const user = userEvent.setup()
    renderForm()

    await user.type(screen.getByLabelText('Email'), 'riya@mit.ac.in')
    await user.type(screen.getByLabelText('Password'), 'super-secret-value')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByRole('alert')

    const printed = spies.flatMap((spy) => spy.mock.calls).flat().join(' ')
    expect(printed).not.toContain('super-secret-value')
    for (const spy of spies) spy.mockRestore()
  })

  it('describes a disabled account with its own message', async () => {
    auth.driver.signIn = async () => {
      throw new FakeAuthError('auth/user-disabled')
    }
    setAuthDriver(auth.driver)

    const user = userEvent.setup()
    renderForm()
    await user.type(screen.getByLabelText('Email'), 'riya@mit.ac.in')
    await user.type(screen.getByLabelText('Password'), 'secret123')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/disabled/i)
  })

  it('offers to resend the link when the email is not verified yet', async () => {
    vi.spyOn(auth.driver, 'signIn').mockRejectedValueOnce(new FakeAuthError('auth/email-not-verified'))
    server.use(mswHttp.post('/api/auth/resend-verification', () => HttpResponse.json({ message: 'ok' })))
    const user = userEvent.setup()
    renderForm()

    await user.type(screen.getByLabelText('Email'), 'riya@mit.ac.in')
    await user.type(screen.getByLabelText('Password'), 'secret123')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/verify your email first/i))
    await user.click(screen.getByRole('button', { name: 'Resend verification email' }))
    expect(await screen.findByText(/a new link is on its way to riya@mit.ac.in/i)).toBeVisible()
    expect(screen.getByTestId('pathname')).toHaveTextContent('/login')
  })
})
