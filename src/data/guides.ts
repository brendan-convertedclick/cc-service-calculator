// src/data/guides.ts

export type StepAction = {
  label: string
  href: string
}

export type Step = {
  key: string
  title: string
  subtitle: string
  icon: string             // lucide-react icon name
  gradient: [string, string]  // two hex colours: badge bg + callout tint
  estMinutes: number
  whyItMatters: string
  prerequisites: string[]
  playbook: string[]
  actions: StepAction[]
}

export type Deck = {
  key: string
  label: string
  icon: string             // lucide-react icon name for deck picker tab
  steps: Step[]
}

export const decks: Deck[] = []
