import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PrivacyPage, TermsPage } from './LegalPages'

describe('legal pages', () => {
  it('terms state the age gate and the quota', () => {
    render(<TermsPage />)
    expect(screen.getByRole('heading', { name: 'Terms of Use' })).toBeTruthy()
    expect(screen.getByText(/at least 18/)).toBeTruthy()
    expect(screen.getByText(/25 SportQuery questions/)).toBeTruthy()
  })
  it('privacy discloses the language-model processor', () => {
    render(<PrivacyPage />)
    expect(screen.getByText(/Cerebras/)).toBeTruthy()
  })
})
