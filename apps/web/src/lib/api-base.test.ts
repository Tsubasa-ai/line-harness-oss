import { afterEach, describe, expect, it, vi } from 'vitest'
import { ADMIN_URL_PLACEHOLDER } from '@line-harness/update-engine/pure'

async function loadApiBase() {
  vi.resetModules()
  return import('./api-base')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('getApiBase', () => {
  it('uses the build-time value once the placeholder has been substituted (per-tenant build / self-hosted install)', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://tenant123.example.workers.dev')

    const { getApiBase } = await loadApiBase()

    expect(getApiBase()).toBe('https://tenant123.example.workers.dev')
  })

  it('falls back to the browser origin when the placeholder was never substituted (shared build)', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', ADMIN_URL_PLACEHOLDER)
    vi.stubGlobal('window', { location: { origin: 'https://tenant456.example.com' } })

    const { getApiBase } = await loadApiBase()

    expect(getApiBase()).toBe('https://tenant456.example.com')
  })

  it('returns the placeholder unchanged outside a browser context (no window to fall back to)', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', ADMIN_URL_PLACEHOLDER)
    // No window stub here — simulates the Node-side static prerender pass.
    expect(typeof window).toBe('undefined')

    const { getApiBase } = await loadApiBase()

    expect(getApiBase()).toBe(ADMIN_URL_PLACEHOLDER)
  })

  it('returns undefined when NEXT_PUBLIC_API_URL was never set at all', async () => {
    // vi.stubEnv always assigns a string, so simulate "unset" by deleting
    // the key outright rather than stubbing it to ''.
    const original = process.env.NEXT_PUBLIC_API_URL
    delete process.env.NEXT_PUBLIC_API_URL

    try {
      const { getApiBase } = await loadApiBase()
      expect(getApiBase()).toBeUndefined()
    } finally {
      if (original !== undefined) process.env.NEXT_PUBLIC_API_URL = original
    }
  })
})
