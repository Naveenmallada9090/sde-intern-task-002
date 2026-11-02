// Splits a whole number of cents into `memberCount` shares.
// The remainder goes to the first members, one cent each, so the sum is always exact.
export function splitCents(totalCents: number, memberCount: number): number[] {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) {
    throw new RangeError('totalCents must be a non-negative safe integer')
  }
  if (!Number.isSafeInteger(memberCount) || memberCount <= 0) {
    throw new RangeError('memberCount must be a positive safe integer')
  }

  const base = Math.floor(totalCents / memberCount)
  const remainder = totalCents % memberCount

  return Array.from({ length: memberCount }, (_, index) => base + (index < remainder ? 1 : 0))
}
