// src/pages/GuidesPage.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { GuidesPage } from './GuidesPage'
import { decks } from '@/data/guides'

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>
}

describe('GuidesPage', () => {
  it('renders page heading', () => {
    render(<GuidesPage />, { wrapper: Wrapper })
    expect(screen.getByRole('heading', { name: /guides/i })).toBeInTheDocument()
  })

  it('renders the first deck steps by default', () => {
    render(<GuidesPage />, { wrapper: Wrapper })
    const firstStep = decks[0].steps[0]
    expect(screen.getByText(firstStep.title)).toBeInTheDocument()
  })

  it('switches to the second deck when its button is clicked', () => {
    render(<GuidesPage />, { wrapper: Wrapper })
    const secondDeck = decks[1]
    fireEvent.click(screen.getByRole('button', { name: secondDeck.label }))
    expect(screen.getByText(secondDeck.steps[0].title)).toBeInTheDocument()
    expect(screen.queryByText(decks[0].steps[0].title)).not.toBeInTheDocument()
  })

  it('expands a step card when clicked', () => {
    render(<GuidesPage />, { wrapper: Wrapper })
    const firstStep = decks[0].steps[0]
    expect(screen.queryByText('Why this matters')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText(firstStep.title))
    expect(screen.getByText('Why this matters')).toBeInTheDocument()
  })

  it('collapses an open step when clicked again', () => {
    render(<GuidesPage />, { wrapper: Wrapper })
    const firstStep = decks[0].steps[0]
    fireEvent.click(screen.getByText(firstStep.title))
    expect(screen.getByText('Why this matters')).toBeInTheDocument()
    fireEvent.click(screen.getByText(firstStep.title))
    expect(screen.queryByText('Why this matters')).not.toBeInTheDocument()
  })

  it('only one step expanded at a time', () => {
    render(<GuidesPage />, { wrapper: Wrapper })
    const [step1, step2] = decks[0].steps
    fireEvent.click(screen.getByText(step1.title))
    expect(screen.getByText('Why this matters')).toBeInTheDocument()
    // Expanding step2 should collapse step1
    fireEvent.click(screen.getByText(step2.title))
    // Only one "Why this matters" label visible
    expect(screen.getAllByText('Why this matters')).toHaveLength(1)
    // step1 content gone, step2 content visible
    expect(screen.getByText(step2.whyItMatters)).toBeInTheDocument()
    expect(screen.queryByText(step1.whyItMatters)).not.toBeInTheDocument()
  })

  it('resets expanded step when switching deck', () => {
    render(<GuidesPage />, { wrapper: Wrapper })
    fireEvent.click(screen.getByText(decks[0].steps[0].title))
    expect(screen.getByText('Why this matters')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: decks[1].label }))
    expect(screen.queryByText('Why this matters')).not.toBeInTheDocument()
  })
})
