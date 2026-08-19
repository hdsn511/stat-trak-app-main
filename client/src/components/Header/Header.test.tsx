import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'
import Header from './Header'

vi.mock('@/services/api', () => ({
  nbaApi: { searchPlayers: vi.fn().mockResolvedValue([]) }
}))

describe('Header', () => {
  it('renders the StatTrakSports brand text', () => {
    render(<MemoryRouter><Header /></MemoryRouter>)
    // The wordmark is three spans so TRAK can take the accent colour.
    expect(screen.getByText('STAT')).toBeInTheDocument()
    expect(screen.getByText('TRAK')).toBeInTheDocument()
    expect(screen.getByText('SPORTS')).toBeInTheDocument()
  })

  it('renders all sport nav links', () => {
    render(<MemoryRouter><Header /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'NBA' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'NFL' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'MLB' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'NHL' })).toBeInTheDocument()
  })

  it('renders search input', () => {
    render(<MemoryRouter><Header /></MemoryRouter>)
    expect(screen.getByPlaceholderText('Search players...')).toBeInTheDocument()
  })
})
