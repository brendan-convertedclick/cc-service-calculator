import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { LimitedList } from './LimitedList'

const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
const renderItem = (item: string) => <div key={item}>item-{item}</div>

describe('LimitedList', () => {
  it('shows only the first 5 items by default', () => {
    render(<LimitedList items={items} renderItem={renderItem} />)
    expect(screen.getByText('item-e')).toBeInTheDocument()
    expect(screen.queryByText('item-f')).not.toBeInTheDocument()
  })

  it('shows a "+N more" toggle for the hidden items', () => {
    render(<LimitedList items={items} renderItem={renderItem} />)
    expect(screen.getByRole('button', { name: '+2 more' })).toBeInTheDocument()
  })

  it('expands to the full list and collapses again', () => {
    render(<LimitedList items={items} renderItem={renderItem} />)
    fireEvent.click(screen.getByRole('button', { name: '+2 more' }))
    expect(screen.getByText('item-g')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show less' }))
    expect(screen.queryByText('item-g')).not.toBeInTheDocument()
  })

  it('renders no toggle when items fit within the limit', () => {
    render(<LimitedList items={['a', 'b']} renderItem={renderItem} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('collapses again when the items change', () => {
    const { rerender } = render(<LimitedList items={items} renderItem={renderItem} />)
    fireEvent.click(screen.getByRole('button', { name: '+2 more' }))
    expect(screen.getByText('item-g')).toBeInTheDocument()
    rerender(<LimitedList items={['x', 'y', 'z', 'a', 'b', 'c', 'd']} renderItem={renderItem} />)
    expect(screen.queryByText('item-d')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+2 more' })).toBeInTheDocument()
  })

  it('respects a custom limit', () => {
    render(<LimitedList items={items} limit={2} renderItem={renderItem} />)
    expect(screen.queryByText('item-c')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+5 more' })).toBeInTheDocument()
  })
})
