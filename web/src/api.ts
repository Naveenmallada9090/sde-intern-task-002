export type Member = { id: string; name: string }

export type Home = { id: string; name: string; members: Member[] }

export type Share = {
  id: string
  memberId: string
  memberName?: string
  amountCents: number
  paidAt: string | null
}

export type Bill = {
  id: string
  homeId: string
  title: string
  totalCents: number
  createdAt?: string
  shares: Share[]
}

export type Balance = { memberId: string; name: string; outstandingCents: number }

export type Payment = { id: string; memberId: string; amountCents: number; paidAt: string }

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

const REQUEST_TIMEOUT_MS = 8000

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function isErrorBody(value: unknown): value is { error: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as { error: unknown }).error === 'string'
  )
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const headers = new Headers(init.headers)
  if (init.body !== undefined) headers.set('content-type', 'application/json')

  try {
    const response = await fetch(path, { ...init, headers, signal: controller.signal })
    const raw = await response.text()
    const data = raw.length > 0 ? parseJson(raw) : null

    if (!response.ok) {
      const message = isErrorBody(data)
        ? data.error
        : `The server answered with status ${response.status}.`
      throw new ApiError(message, response.status)
    }

    if (data === null) throw new ApiError('The server returned an empty response.', response.status)
    return data as T
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('The request is taking too long. Please try again.', 0)
    }
    throw new ApiError('Could not reach the server. Please try again.', 0)
  } finally {
    window.clearTimeout(timeout)
  }
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error && error.message.length > 0) return error.message
  return 'Something went wrong. Please try again.'
}

export function getHome(homeId: string): Promise<Home> {
  return request<Home>(`/api/homes/${encodeURIComponent(homeId)}`)
}

export function getBills(homeId: string): Promise<{ bills: Bill[] }> {
  return request<{ bills: Bill[] }>(`/api/homes/${encodeURIComponent(homeId)}/bills`)
}

export function getBalances(homeId: string): Promise<{ balances: Balance[] }> {
  return request<{ balances: Balance[] }>(`/api/homes/${encodeURIComponent(homeId)}/balances`)
}

export function createHome(name: string): Promise<{ id: string; name: string }> {
  return request<{ id: string; name: string }>('/api/homes', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export function addMember(homeId: string, name: string): Promise<Member> {
  return request<Member>(`/api/homes/${encodeURIComponent(homeId)}/members`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export function createBill(homeId: string, title: string, totalCents: number): Promise<Bill> {
  return request<Bill>(`/api/homes/${encodeURIComponent(homeId)}/bills`, {
    method: 'POST',
    body: JSON.stringify({ title, totalCents }),
  })
}

export function payShare(billId: string, shareId: string, key: string): Promise<Payment> {
  return request<Payment>(
    `/api/bills/${encodeURIComponent(billId)}/shares/${encodeURIComponent(shareId)}/pay`,
    { method: 'POST', headers: { 'Idempotency-Key': key } },
  )
}
