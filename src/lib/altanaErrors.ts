export function altanaErrorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'The passkey request was cancelled or timed out.'
  }
  if (error instanceof Error) {
    if (/quote expired/i.test(error.message)) {
      return 'The relay quote expired before Passkey confirmation completed. No transaction was sent. Try again promptly; MandateFi will skip every owner step already confirmed onchain.'
    }
    if (/invalid parameters were provided to the rpc method/i.test(error.message)) {
      return 'The Altana relay rejected the prepared call before broadcast. No transaction was sent; retry the unfinished owner step.'
    }
    return error.message
  }
  return 'The Altana operation could not be completed.'
}
