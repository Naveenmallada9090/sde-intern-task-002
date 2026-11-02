import { Hono } from 'hono'
import {
  errorResponse,
  isUniqueConstraintError,
  readJsonObject,
  readName,
  readPositiveCents,
} from '../lib/http'
import { splitCents } from '../lib/split'
import type { AppEnv, BillRow, ShareRow } from '../types'

type ShareWithMember = {
  id: string
  billId: string
  memberId: string
  memberName: string
  amountCents: number
  paidAt: string | null
}

export const billsRoutes = new Hono<AppEnv>()

billsRoutes.post('/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')

  const body = await readJsonObject(c)
  if (!body) return errorResponse(c, 400, 'Request body must be a JSON object')

  const title = readName(body.title)
  if (!title) {
    return errorResponse(c, 422, 'title must be a non-empty string of at most 120 characters')
  }

  const totalCents = readPositiveCents(body.totalCents)
  if (totalCents === null) {
    return errorResponse(c, 422, 'totalCents must be a positive whole number of cents')
  }

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()
  if (!home) return errorResponse(c, 404, 'Home not found')

  const members = await c.env.DB.prepare(
    'SELECT id FROM members WHERE home_id = ? ORDER BY position',
  )
    .bind(homeId)
    .all<{ id: string }>()

  if (members.results.length === 0) {
    return errorResponse(c, 422, 'A bill cannot be created for a home with no members')
  }

  const amounts = splitCents(totalCents, members.results.length)
  const billId = crypto.randomUUID()
  const createdAt = new Date().toISOString()

  const shares = members.results.map((member, index) => ({
    id: crypto.randomUUID(),
    memberId: member.id,
    amountCents: amounts[index] ?? 0,
    position: index,
    paidAt: null,
  }))

  // A batch runs as one transaction: either the bill and all of its shares exist, or none do.
  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO bills (id, home_id, title, total_cents, created_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(billId, homeId, title, totalCents, createdAt),
    ...shares.map((share) =>
      c.env.DB.prepare(
        'INSERT INTO shares (id, bill_id, member_id, amount_cents, position) VALUES (?, ?, ?, ?, ?)',
      ).bind(share.id, billId, share.memberId, share.amountCents, share.position),
    ),
  ])

  return c.json(
    {
      id: billId,
      homeId,
      title,
      totalCents,
      shares: shares.map((share) => ({
        id: share.id,
        memberId: share.memberId,
        amountCents: share.amountCents,
        paidAt: null,
      })),
    },
    201,
  )
})

// Extra read endpoint used by the web page. The assignment only requires the writes.
billsRoutes.get('/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()
  if (!home) return errorResponse(c, 404, 'Home not found')

  const bills = await c.env.DB.prepare(
    `SELECT id, home_id AS homeId, title, total_cents AS totalCents, created_at AS createdAt
     FROM bills
     WHERE home_id = ?
     ORDER BY created_at DESC, rowid DESC`,
  )
    .bind(homeId)
    .all<BillRow>()

  const shares = await c.env.DB.prepare(
    `SELECT
       s.id AS id,
       s.bill_id AS billId,
       s.member_id AS memberId,
       m.name AS memberName,
       s.amount_cents AS amountCents,
       s.paid_at AS paidAt
     FROM shares s
     JOIN bills b ON b.id = s.bill_id
     JOIN members m ON m.id = s.member_id
     WHERE b.home_id = ?
     ORDER BY b.rowid, s.position`,
  )
    .bind(homeId)
    .all<ShareWithMember>()

  const sharesByBill = new Map<string, ShareWithMember[]>()
  for (const share of shares.results) {
    const list = sharesByBill.get(share.billId)
    if (list) {
      list.push(share)
    } else {
      sharesByBill.set(share.billId, [share])
    }
  }

  return c.json({
    bills: bills.results.map((bill) => ({
      ...bill,
      shares: (sharesByBill.get(bill.id) ?? []).map((share) => ({
        id: share.id,
        memberId: share.memberId,
        memberName: share.memberName,
        amountCents: share.amountCents,
        paidAt: share.paidAt,
      })),
    })),
  })
})

billsRoutes.post('/bills/:billId/shares/:shareId/pay', async (c) => {
  const billId = c.req.param('billId')
  const shareId = c.req.param('shareId')

  const key = c.req.header('Idempotency-Key')?.trim()
  if (!key) return errorResponse(c, 400, 'Idempotency-Key header is required')
  if (key.length > 200) {
    return errorResponse(c, 400, 'Idempotency-Key must be at most 200 characters')
  }

  const readShare = () =>
    c.env.DB.prepare(
      `SELECT
         id, bill_id AS billId, member_id AS memberId,
         amount_cents AS amountCents, position, paid_at AS paidAt,
         payment_key AS paymentKey
       FROM shares
       WHERE id = ? AND bill_id = ?`,
    )
      .bind(shareId, billId)
      .first<ShareRow>()

  const share = await readShare()
  if (!share) return errorResponse(c, 404, 'Bill or share not found')

  // A replay with the same key gets the original result, even after the share is paid.
  if (share.paidAt !== null) {
    if (share.paymentKey === key) {
      return c.json(
        {
          id: share.id,
          memberId: share.memberId,
          amountCents: share.amountCents,
          paidAt: share.paidAt,
        },
        200,
      )
    }
    return errorResponse(c, 409, 'Share was already paid with a different Idempotency-Key')
  }

  const paidAt = new Date().toISOString()

  try {
    // This single conditional UPDATE is the race guard: only one request can change an
    // unpaid share, because the WHERE clause stops matching after the first write.
    const result = await c.env.DB.prepare(
      `UPDATE shares
       SET paid_at = ?, payment_key = ?
       WHERE id = ? AND bill_id = ? AND paid_at IS NULL`,
    )
      .bind(paidAt, key, shareId, billId)
      .run()

    if (result.meta.changes === 1) {
      return c.json(
        { id: share.id, memberId: share.memberId, amountCents: share.amountCents, paidAt },
        200,
      )
    }
  } catch (error) {
    const after = await readShare()
    if (!after) return errorResponse(c, 404, 'Bill or share not found')
    if (after.paymentKey === key && after.paidAt !== null) {
      return c.json(
        {
          id: after.id,
          memberId: after.memberId,
          amountCents: after.amountCents,
          paidAt: after.paidAt,
        },
        200,
      )
    }
    if (isUniqueConstraintError(error)) {
      return errorResponse(c, 409, 'Idempotency-Key was already used for another payment')
    }
    throw error
  }

  // Another request paid the share between our read and our update.
  const after = await readShare()
  if (!after) return errorResponse(c, 404, 'Bill or share not found')

  if (after.paymentKey === key && after.paidAt !== null) {
    return c.json(
      {
        id: after.id,
        memberId: after.memberId,
        amountCents: after.amountCents,
        paidAt: after.paidAt,
      },
      200,
    )
  }

  return errorResponse(c, 409, 'Share was already paid with a different Idempotency-Key')
})
