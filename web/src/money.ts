// Display-only formatting. Money stays an integer number of cents everywhere else.
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const absolute = Math.abs(cents)
  const dollars = Math.floor(absolute / 100)
  const remainder = String(absolute % 100).padStart(2, '0')
  return `${sign}$${dollars.toLocaleString('en-US')}.${remainder}`
}

// Converts a human-entered dollar string ("12.34") to whole cents without float maths.
// Returns null for zero, negative, malformed or oversized values.
export function parseDollarsToCents(input: string): number | null {
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(input.trim())
  if (!match) return null

  const dollars = Number(match[1] ?? '0')
  const fraction = (match[2] ?? '').padEnd(2, '0')
  const cents = Number(fraction)
  const total = dollars * 100 + cents

  if (!Number.isSafeInteger(total) || total <= 0) return null
  return total
}

export function formatPaidAt(paidAt: string): string {
  const date = new Date(paidAt)
  if (Number.isNaN(date.getTime())) return paidAt
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
