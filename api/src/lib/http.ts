import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { AppEnv } from '../types'

export type JsonObject = Record<string, unknown>

export function errorResponse(c: Context<AppEnv>, status: ContentfulStatusCode, message: string) {
  return c.json({ error: message }, status)
}

// Reads a JSON object body. Anything else (invalid JSON, arrays, primitives) is rejected.
export async function readJsonObject(c: Context<AppEnv>): Promise<JsonObject | null> {
  try {
    const body: unknown = await c.req.json()
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return null
    return body as JsonObject
  } catch {
    return null
  }
}

// Trims and validates a display name. Returns null when the value is not usable.
export function readName(value: unknown, maxLength = 120): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim()
  if (name.length === 0 || name.length > maxLength) return null
  return name
}

// Accepts only positive, whole, safe integers. Rejects zero, negatives, floats, strings, null.
export function readPositiveCents(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return null
  return value
}

export function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed')
}
