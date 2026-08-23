import { describe, expect, it } from 'vitest'
import { hasActivityDetails, summarizeActivityText } from './activity'

describe('activity presentation', () => {
  it('shortens long RPC data without exposing an unbroken layout token', () => {
    const calldata = `Execution reverted. Details: 0x${'a'.repeat(256)}`
    const summary = summarizeActivityText(calldata)

    expect(summary).toMatch(/^Execution reverted\. Details: 0xaaaaaaaa…aaaaaaaa$/)
    expect(summary.length).toBeLessThan(80)
    expect(hasActivityDetails(calldata)).toBe(true)
  })

  it('keeps a concise decision unchanged', () => {
    const rationale = 'The policy gate held because execution cost exceeded the approved ceiling.'

    expect(summarizeActivityText(rationale)).toBe(rationale)
    expect(hasActivityDetails(rationale)).toBe(false)
  })

  it('truncates verbose prose on a word boundary', () => {
    const rationale = Array.from({ length: 80 }, () => 'evidence').join(' ')
    const summary = summarizeActivityText(rationale, 100)

    expect(summary.endsWith('…')).toBe(true)
    expect(summary.length).toBeLessThanOrEqual(101)
    expect(hasActivityDetails(rationale, 100)).toBe(true)
  })
})
