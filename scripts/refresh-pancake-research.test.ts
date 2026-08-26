import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const temporaryDirectories: string[] = []
const scriptPath = resolve(process.cwd(), 'scripts/refresh-pancake-research.mjs')

async function temporaryOutputPath() {
  const directory = await mkdtemp(resolve(tmpdir(), 'mandatefi-research-'))
  temporaryDirectories.push(directory)
  return resolve(directory, 'pancake-research.json')
}

function runRefresh(outputPath: string) {
  return spawnSync(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      PANCAKE_EXPLORER_BASE: 'http://127.0.0.1:9',
      PANCAKE_RESEARCH_OUTPUT: outputPath,
    },
  })
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('PancakeSwap research refresh fallback', () => {
  it('keeps the previous complete snapshot when the upstream API is unavailable', async () => {
    const outputPath = await temporaryOutputPath()
    const snapshot = {
      schemaVersion: 1,
      generatedAt: '2026-08-26T11:27:54.547Z',
      network: { chainId: 56 },
      liquidity: { opportunities: [{ id: 'lp' }] },
      farms: { opportunities: [{ id: 'farm' }] },
      earn: { opportunities: [{ id: 'earn' }] },
    }
    await writeFile(outputPath, JSON.stringify(snapshot), 'utf8')

    const result = runRefresh(outputPath)

    expect(result.status).toBe(0)
    expect(result.stderr).toContain('Keeping the last complete snapshot')
    expect(JSON.parse(await readFile(outputPath, 'utf8'))).toEqual(snapshot)
  })

  it('fails closed when no complete snapshot is available', async () => {
    const outputPath = await temporaryOutputPath()

    const result = runRefresh(outputPath)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('no previous research snapshot could be read')
  })
})
