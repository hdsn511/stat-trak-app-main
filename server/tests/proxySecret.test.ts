import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// The Function URL serving this API is public (AuthType NONE is required for
// one), so this header check is the only thing between the open internet and
// endpoints that bill per call to Groq/OpenAI.

const ORIGINAL_ENV = { ...process.env };

async function loadGate() {
  vi.resetModules();
  const mod = await import('../src/middleware/proxySecret');
  return mod.proxySecretGate();
}

function call(gate: ReturnType<typeof Function.prototype.call>, header?: string) {
  const req = { get: (_: string) => header } as unknown as Request;
  const status = vi.fn().mockReturnThis();
  const json = vi.fn();
  const res = { status, json } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  (gate as (r: Request, s: Response, n: NextFunction) => void)(req, res, next);
  return { status, json, next };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe('proxySecretGate', () => {
  it('passes a request carrying the right secret', async () => {
    process.env.API_SHARED_SECRET = 'correct-horse';
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    const { next, status } = call(await loadGate(), 'correct-horse');
    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });

  it.each([
    ['a wrong secret', 'wrong-horse'],
    ['a secret of matching length', 'correct-hors3'],
    ['no header at all', undefined],
  ])('rejects %s with 403', async (_label, header) => {
    process.env.API_SHARED_SECRET = 'correct-horse';
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    const { next, status, json } = call(await loadGate(), header);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ success: false, error: 'forbidden' });
  });

  it('is disabled when no secret is configured locally', async () => {
    delete process.env.API_SHARED_SECRET;
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    const { next, status } = call(await loadGate(), undefined);
    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });

  it('fails closed on Lambda when the secret is missing', async () => {
    // A deploy that lost its secret must not silently serve the API to anyone
    // who finds the Function URL.
    delete process.env.API_SHARED_SECRET;
    process.env.AWS_LAMBDA_FUNCTION_NAME = 'stattrak-api';
    const { next, status, json } = call(await loadGate(), 'anything');
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith({ success: false, error: 'server misconfigured' });
  });
});
