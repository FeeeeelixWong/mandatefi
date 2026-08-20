import { useEffect, useState } from 'react'
import { fetchBnbRegistrySnapshot, type RegistrySnapshot } from '../services/erc8004'

export function use8004Registry() {
  const [snapshot, setSnapshot] = useState<RegistrySnapshot | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    fetchBnbRegistrySnapshot(controller.signal)
      .then((result) => {
        setSnapshot(result)
        setError('')
      })
      .catch((fetchError: unknown) => {
        if (controller.signal.aborted) return
        setError(fetchError instanceof Error ? fetchError.message : '8004scan data is unavailable.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [])

  return { snapshot, error, loading }
}
