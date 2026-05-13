import { describe, it, expect } from 'vitest'
import { decks } from './guides'

describe('guides data', () => {
  it('has all 7 decks', () => {
    expect(decks).toHaveLength(7)
  })

  it('every deck has at least one step', () => {
    decks.forEach((deck) => {
      expect(deck.steps.length).toBeGreaterThan(0)
    })
  })

  it('every step has required fields populated', () => {
    decks.forEach((deck) => {
      deck.steps.forEach((step) => {
        expect(step.key, `${deck.key}/${step.key} missing key`).toBeTruthy()
        expect(step.title, `${step.key} missing title`).toBeTruthy()
        expect(step.subtitle, `${step.key} missing subtitle`).toBeTruthy()
        expect(step.whyItMatters, `${step.key} missing whyItMatters`).toBeTruthy()
        expect(step.prerequisites.length, `${step.key} has no prerequisites`).toBeGreaterThan(0)
        expect(step.playbook.length, `${step.key} has no playbook`).toBeGreaterThanOrEqual(4)
        expect(step.gradient, `${step.key} bad gradient`).toHaveLength(2)
        expect(step.estMinutes, `${step.key} missing estMinutes`).toBeGreaterThan(0)
      })
    })
  })

  it('all action hrefs are internal paths starting with /', () => {
    decks.forEach((deck) => {
      deck.steps.forEach((step) => {
        step.actions.forEach((action) => {
          expect(action.href.startsWith('/'), `${step.key} action "${action.label}" href "${action.href}" is not internal`).toBe(true)
        })
      })
    })
  })
})
