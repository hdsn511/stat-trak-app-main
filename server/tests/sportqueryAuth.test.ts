import { describe, it, expect, vi, beforeEach } from 'vitest'

const getUser = vi.fn()
const rpc = vi.fn()
vi.mock('../src/config/supabaseAdmin', () => ({
  supabaseAdmin: { auth: { getUser: (...a: unknown[]) => getUser(...a) }, rpc: (...a: unknown[]) => rpc(...a) },
}))

import { requireUser, enforceQuota } from '../src/middleware/sportqueryAuth'

function mockRes() {
  const res: any = { statusCode: 200, body: null }
  res.status = (c: number) => ((res.statusCode = c), res)
  res.json = (b: unknown) => ((res.body = b), res)
  return res
}
const reqWith = (auth?: string, sqUser?: unknown): any => ({ get: () => auth, sqUser })

beforeEach(() => {
  getUser.mockReset()
  rpc.mockReset()
})

describe('requireUser', () => {
  it('401s without a bearer token', async () => {
    const res = mockRes()
    const next = vi.fn()
    await requireUser(reqWith(undefined), res, next)
    expect(res.statusCode).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('401s on an invalid token', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: new Error('bad') })
    const res = mockRes()
    await requireUser(reqWith('Bearer x'), res, vi.fn())
    expect(res.statusCode).toBe(401)
  })

  it('sets sqUser for a valid anonymous token', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1', is_anonymous: true } }, error: null })
    const req = reqWith('Bearer x')
    const next = vi.fn()
    await requireUser(req, mockRes(), next)
    expect(req.sqUser).toEqual({ id: 'u1', isAnon: true })
    expect(next).toHaveBeenCalled()
  })
})

describe('enforceQuota', () => {
  it('402 signup_required when an anonymous user is over the limit', async () => {
    rpc
      .mockResolvedValueOnce({ data: [{ allowed: true, used: 1 }], error: null }) // global
      .mockResolvedValueOnce({ data: [{ allowed: false, used: 25 }], error: null }) // user
    const res = mockRes()
    await enforceQuota(reqWith(undefined, { id: 'u1', isAnon: true }), res, vi.fn())
    expect(res.statusCode).toBe(402)
    expect(res.body.code).toBe('signup_required')
    expect(rpc).toHaveBeenLastCalledWith('sportquery_consume', { p_user: 'u1', p_period: 'lifetime', p_limit: 25 })
  })

  it('uses a monthly period and 100 limit for signed-in users', async () => {
    rpc.mockResolvedValue({ data: [{ allowed: true, used: 1 }], error: null })
    const next = vi.fn()
    await enforceQuota(reqWith(undefined, { id: 'u2', isAnon: false }), mockRes(), next)
    const call = rpc.mock.calls[1]![1]
    expect(call.p_limit).toBe(100)
    expect(call.p_period).toMatch(/^\d{4}-\d{2}$/)
    expect(next).toHaveBeenCalled()
  })

  it('fails closed when the quota check errors', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('db down') })
    const res = mockRes()
    const next = vi.fn()
    await enforceQuota(reqWith(undefined, { id: 'u3', isAnon: true }), res, next)
    expect(res.statusCode).toBe(503)
    expect(next).not.toHaveBeenCalled()
  })
})
