import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import InfoPopover from './InfoPopover'
import { SPORTS, STARTER_QUESTIONS } from './capabilities'

describe('InfoPopover', () => {
  it('is closed until opened, then lists the sport stats', () => {
    render(<InfoPopover onAsk={() => {}} />)
    expect(screen.queryByRole('region')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /what can i ask/i }))
    expect(screen.getByRole('region')).toBeInTheDocument()
    // NBA tab is first and shows its box-score stats.
    expect(screen.getByText('Rebounds')).toBeInTheDocument()
  })

  it('switches sport tabs and shows that sport only', () => {
    render(<InfoPopover onAsk={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /what can i ask/i }))
    fireEvent.click(screen.getByRole('tab', { name: 'NHL' }))
    expect(screen.getByText('Save %')).toBeInTheDocument()
    expect(screen.queryByText('Rebounds')).toBeNull()
    expect(screen.getByText(/NOT AVAILABLE/)).toBeInTheDocument()
  })

  it('opens on hover and asks an example, then closes', () => {
    const onAsk = vi.fn()
    render(<InfoPopover onAsk={onAsk} />)
    fireEvent.mouseEnter(screen.getByRole('button', { name: /what can i ask/i }).parentElement!)
    expect(screen.getByRole('region')).toBeInTheDocument()

    fireEvent.click(screen.getByText(SPORTS[0]!.examples[0]!))
    expect(onAsk).toHaveBeenCalledWith(SPORTS[0]!.examples[0])
  })

  it('closes on Escape', () => {
    render(<InfoPopover onAsk={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /what can i ask/i }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('region')).toBeNull()
  })
})

describe('capabilities', () => {
  it('covers all four sports and only promises markets where they exist', () => {
    expect(SPORTS.map((s) => s.slug)).toEqual(['nba', 'mlb', 'nfl', 'nhl'])
    expect(SPORTS.filter((s) => s.markets).map((s) => s.slug)).toEqual(['nba', 'mlb'])
  })

  it('starter questions are drawn from the documented examples', () => {
    const all = new Set(SPORTS.flatMap((s) => s.examples))
    for (const q of STARTER_QUESTIONS) expect(all.has(q)).toBe(true)
  })
})
