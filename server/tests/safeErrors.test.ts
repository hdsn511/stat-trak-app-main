import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import express from 'express'
import type { Server } from 'http'
import type { AddressInfo } from 'net'
import { GENERIC_ERROR, apiErrorHandler, apiNotFound, safeErrors } from '../src/middleware/safeErrors'

function app() {
  const a = express()
  a.use('/api', safeErrors())
  a.get('/api/boom', (_req, res) => {
    res.status(500).json({ success: false, error: 'invalid input syntax for type bigint: "NaN"' })
  })
  a.get('/api/missing', (_req, res) => {
    res.status(404).json({ success: false, error: 'Player not found' })
  })
  a.get('/api/throw', () => {
    throw new Error('relation "secret" does not exist')
  })
  a.use('/api', apiNotFound())
  a.use(apiErrorHandler())
  return a
}

let server: Server
let base: string
beforeAll(async () => {
  server = app().listen(0)
  await new Promise((r) => server.once('listening', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>((r) => server.close(() => r())))

async function get(path: string) {
  const res = await fetch(base + path)
  return { status: res.status, body: await res.json() }
}

describe('safeErrors', () => {
  it('replaces 5xx messages with a generic one and logs the original', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await get('/api/boom')
    expect(res.status).toBe(500)
    expect(res.body.error).toBe(GENERIC_ERROR)
    expect(log.mock.calls[0]?.[0]).toContain('bigint')
    log.mockRestore()
  })

  it('passes 4xx messages through', async () => {
    const res = await get('/api/missing')
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Player not found')
  })

  it('answers unknown /api paths with JSON 404', async () => {
    const res = await get('/api/xfl/games/today')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ success: false, error: 'Not found' })
  })

  it('turns thrown errors into a generic JSON 500', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await get('/api/throw')
    expect(res.status).toBe(500)
    expect(res.body.error).toBe(GENERIC_ERROR)
    log.mockRestore()
  })
})
