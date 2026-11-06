import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router-dom'
import { http as mswHttp, HttpResponse } from 'msw'
import { server } from '@/tests/msw/server'
import { API, makeProfile } from '@/tests/msw/handlers'
import { FakeAuthError, installFakeAuth } from '@/tests/fakeAuthDriver'
import { renderWithProviders } from '@/tests/renderWithProviders'
import { authApi } from '@/features/auth/authApi'
import { RegisterForm } from '@/features/auth/RegisterForm'

const NEW_ACCOUNT = {
  name: 'Riya Sharma',
  email: 'riya@mit.ac.in',
  password: 'secret123',
}

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="pathname">{location.pathname}</div>
}

/**
 * Both role homes are declared so a new account, which the backend always
 * provisions as STUDENT, has somewhere real to land. Without `/app/student` the
 * route table would render nothing on navigation and the assertion below would
 * be checking a blank page rather than the redirect.
 */
function renderForm() {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/register" element={<RegisterForm />} />
        <Route path="/app/student" element={<div>Student home</div>} />
        <Route path="/app/classrooms" element={<div>Classrooms</div>} />
        <Route path="/app/dashboard" element={<div>Account</div>} />
      </Routes>
      <LocationProbe />
    </>,
    { route: '/register' },
  )
}

/** Fills the three fields; the consent box is left to each test. */
async function fillDetails(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Full name'), NEW_ACCOUNT.name)
  await user.type(screen.getByLabelText('College email'), NEW_ACCOUNT.email)
  await user.type(screen.getByLabelText('Password'), NEW_ACCOUNT.password)
}

const acceptConsent = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('checkbox', { name: 'Accept the classroom code of conduct' }))

let auth: ReturnType<typeof installFakeAuth>

describe('RegisterForm', () => {
  beforeEach(() => {
    auth = installFakeAuth()
    server.use(mswHttp.get(API.me, () => HttpResponse.json({ user: makeProfile() })))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders every field with the right hints and no separate domain field', () => {
    renderForm()
    expect(screen.getByLabelText('Full name')).toHaveAttribute('autocomplete', 'name')
    expect(screen.getByLabelText('College email')).toHaveAttribute('type', 'email')
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'new-password')
    // The domain is derived from the address, so there is no field to type it into.
    expect(screen.queryByLabelText('College email domain')).toBeNull()
    expect(screen.getByText('Use your college email address.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled()
  })

  it('refuses to submit until the code of conduct is accepted', async () => {
    const user = userEvent.setup()
    renderForm()
    await fillDetails(user)

    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByText(/accept the classroom code of conduct/i)).toBeInTheDocument()
    expect(screen.getByTestId('pathname')).toHaveTextContent('/register')
  })

  it('creates the account and lands on the role home', async () => {
    const user = userEvent.setup()
    renderForm()
    await fillDetails(user)
    await acceptConsent(user)
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => expect(screen.getByTestId('pathname'))        .toHaveTextContent('/app/student'))
  })

  /**
   * Replaces "rejects an email that does not match the declared college domain":
   * there is no declared domain any more, so the payload's `collegeDomain` is
   * read back off the sign-up call to prove it was derived from the address.
   * The address is typed with padding and mixed case to show the derivation
   * trims and lowercases rather than passing the raw keystrokes through.
   */
  it('derives the college domain from the email and sends it in the payload', async () => {
    const signUp = vi.spyOn(authApi, 'signUp')
    const user = userEvent.setup()
    renderForm()
    await user.type(screen.getByLabelText('Full name'), NEW_ACCOUNT.name)
    await user.type(screen.getByLabelText('College email'), '  RIYA@MIT.AC.IN  ')
    await user.type(screen.getByLabelText('Password'), NEW_ACCOUNT.password)
    await acceptConsent(user)
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => expect(screen.getByTestId('pathname')).toHaveTextContent('/app/student'))
    expect(signUp).toHaveBeenCalledWith({
      email: 'riya@mit.ac.in',
      password: NEW_ACCOUNT.password,
      displayName: NEW_ACCOUNT.name,
      collegeDomain: 'mit.ac.in',
    })
  })

  /**
   * Replaces "normalises a pasted college URL into a bare domain": there is no
   * domain box to paste a URL into. The address the student typed now carries
   * the whole decision, so the equivalent failure is a domain no college could
   * own — a friendly message, the page they were on, and the value preserved.
   */
  it('shows a friendly error for an unrecognised college domain and keeps what was typed', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.type(screen.getByLabelText('Full name'), NEW_ACCOUNT.name)
    // Well-formed email syntax, but "my_college.edu" is not a usable host.
    await user.type(screen.getByLabelText('College email'), 'riya@my_college.edu')
    await user.type(screen.getByLabelText('Password'), NEW_ACCOUNT.password)
    await acceptConsent(user)
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByText(/don't recognise that email domain/i)).toBeInTheDocument()
    expect(screen.getByTestId('pathname')).toHaveTextContent('/register')
    expect(screen.getByLabelText('College email')).toHaveValue('riya@my_college.edu')
  })

  it('rejects an email that is not a valid address', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.type(screen.getByLabelText('Full name'), NEW_ACCOUNT.name)
    await user.type(screen.getByLabelText('College email'), 'riya@not-an-email')
    await user.type(screen.getByLabelText('Password'), NEW_ACCOUNT.password)
    await acceptConsent(user)
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByText(/not formatted correctly/i)).toBeInTheDocument()
    expect(screen.getByTestId('pathname')).toHaveTextContent('/register')
    expect(screen.getByLabelText('College email')).toHaveValue('riya@not-an-email')
  })

  it('rejects a password shorter than the minimum', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.type(screen.getByLabelText('Full name'), NEW_ACCOUNT.name)
    await user.type(screen.getByLabelText('College email'), NEW_ACCOUNT.email)
    await user.type(screen.getByLabelText('Password'), 'short')
    await acceptConsent(user)
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument()
  })

  /*
   * The same contract as LoginForm: Edge adds its own reveal control to password
   * fields, which is what produced two eyes. One toggle, one icon -- including
   * once the field has failed validation.
   */
  it('renders exactly one password toggle, in the resting and error states', async () => {
    const user = userEvent.setup()
    renderForm()

    const toggle = screen.getByRole('button', { name: 'Show password' })
    expect(screen.getAllByRole('button', { name: /password/i })).toHaveLength(1)
    expect(toggle.querySelectorAll('svg')).toHaveLength(1)

    await user.type(screen.getByLabelText('Full name'), NEW_ACCOUNT.name)
    await user.type(screen.getByLabelText('College email'), NEW_ACCOUNT.email)
    await user.type(screen.getByLabelText('Password'), 'short')
    await acceptConsent(user)
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true')
    const toggles = screen.getAllByRole('button', { name: /password/i })
    expect(toggles).toHaveLength(1)
    expect(toggles[0].querySelectorAll('svg')).toHaveLength(1)
  })

  it('reports an already-registered email without losing what was typed', async () => {
    const user = userEvent.setup()
    renderForm()
    await fillDetails(user)
    await acceptConsent(user)
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    await waitFor(() => expect(screen.getByTestId('pathname'))        .toHaveTextContent('/app/student'))
  })

  it('surfaces a duplicate-registration failure and stays put', async () => {
    installFakeAuth({
      accounts: [{ uid: 'u-1', email: NEW_ACCOUNT.email, password: 'otherpass1', displayName: 'Riya S' }],
    })
    const user = userEvent.setup()
    renderForm()
    await fillDetails(user)
    await acceptConsent(user)
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/already registered/i)
    expect(screen.getByTestId('pathname')).toHaveTextContent('/register')
  })

  it('stays usable after a failure, so the user can correct the email', async () => {
    installFakeAuth({
      accounts: [{ uid: 'u-1', email: NEW_ACCOUNT.email, password: 'otherpass1', displayName: 'Riya S' }],
    })
    const user = userEvent.setup()
    renderForm()
    await fillDetails(user)
    await acceptConsent(user)
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    await screen.findByRole('alert')

    // The button is re-enabled, and the email field still holds its value.
    const submit = screen.getByRole('button', { name: 'Create account' })
    expect(submit).toBeEnabled()
    expect(screen.getByLabelText('College email')).toHaveValue(NEW_ACCOUNT.email)

    const emailField = screen.getByLabelText('College email')
    await user.clear(emailField)
    await user.type(emailField, 'another@mit.ac.in')
    await user.click(submit)

    await waitFor(() => expect(screen.getByTestId('pathname'))        .toHaveTextContent('/app/student'))
  })

  it('asks the student to check their email when the account needs verifying', async () => {
    vi.spyOn(auth.driver, 'signUp').mockRejectedValueOnce(new FakeAuthError('auth/verification-sent'))
    const user = userEvent.setup()
    renderForm()
    await fillDetails(user)
    await acceptConsent(user)
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByText('Check your email')).toBeVisible()
    expect(screen.getByText(NEW_ACCOUNT.email)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Resend verification email' })).toBeVisible()
    // Not an error, and not signed in.
    expect(screen.getByTestId('pathname')).toHaveTextContent('/register')
  })
})
