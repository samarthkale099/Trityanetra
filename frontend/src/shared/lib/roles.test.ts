import { describe, expect, it } from 'vitest'
import { ROLE_HOME, isTeacherRole, roleHomePath, roleLabel } from '@/shared/lib/roles'
import { USER_ROLES } from '@/shared/types'

describe('roleHomePath', () => {
  it('sends every known role to a concrete, non-empty path', () => {
    for (const role of USER_ROLES) {
      const path = roleHomePath(role)
      expect(path).toMatch(/^\//)
      expect(path).not.toBe('/login')
    }
  })

  it('sends a signed-out visitor to the login page', () => {
    expect(roleHomePath(null)).toBe('/login')
    expect(roleHomePath(undefined)).toBe('/login')
  })

  it('maps each role to its own home', () => {
    for (const role of USER_ROLES) {
      expect(roleHomePath(role)).toBe(ROLE_HOME[role])
    }
  })
})

describe('isTeacherRole', () => {
  it('accepts teachers and college admins', () => {
    expect(isTeacherRole('TEACHER')).toBe(true)
    expect(isTeacherRole('ADMIN')).toBe(true)
  })

  it('rejects students, guests, and nothing', () => {
    expect(isTeacherRole('STUDENT')).toBe(false)
    expect(isTeacherRole(null)).toBe(false)
    expect(isTeacherRole(undefined)).toBe(false)
  })
})

describe('roleLabel', () => {
  it('gives every role a human label and falls back for a guest', () => {
    expect(roleLabel('STUDENT')).toBe('Student')
    expect(roleLabel('TEACHER')).toBe('Teacher')
    expect(roleLabel('ADMIN')).toBe('Administrator')
    expect(roleLabel(null)).toBe('Guest')
  })
})
