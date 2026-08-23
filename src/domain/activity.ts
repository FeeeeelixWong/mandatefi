const longHexPattern = /0x[0-9a-fA-F]{32,}/g

function normalizedActivityText(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

export function summarizeActivityText(value: string, maximumLength = 260) {
  const readable = normalizedActivityText(value).replace(longHexPattern, (token) => (
    `${token.slice(0, 10)}…${token.slice(-8)}`
  ))
  if (readable.length <= maximumLength) return readable

  const candidate = readable.slice(0, maximumLength)
  const lastWordBoundary = candidate.lastIndexOf(' ')
  const cutoff = lastWordBoundary > maximumLength * 0.7 ? lastWordBoundary : maximumLength
  return `${candidate.slice(0, cutoff).trimEnd()}…`
}

export function hasActivityDetails(value: string, maximumLength = 260) {
  return normalizedActivityText(value) !== summarizeActivityText(value, maximumLength)
}
