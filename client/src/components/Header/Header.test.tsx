import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'
import Header from './Header'

vi.mock('@/services/api', () => ({
  nbaApi: { searchPlayers: vi.fn().mockResolvedValue([]) }
}))

describe('Header', () => {
  it('renders the StatTrak brand text', () => {
    render(<MemoryRouter><Header /></MemoryRouter>)
    expect(screen.getByText('Stat')).toBeInTheDocument()
    expect(screen.getByText('Trak')).toBeInTheDocument()
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
