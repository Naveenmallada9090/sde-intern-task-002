import { Hono } from 'hono'
import { errorResponse, readJsonObject, readName } from '../lib/http'
import type { AppEnv, BalanceRow, HomeRow, MemberRow } from '../types'

export const homesRoutes = new Hono<AppEnv>()

homesRoutes.post('/', async (c) => {
  const body = await readJsonObject(c)
  if (!body) return errorResponse(c, 400, 'Request body must be a JSON object')

  const name = readName(body.name)
  if (!name) {
    return errorResponse(c, 422, 'name must be a non-empty string of at most 120 characters')
  }

  const id = crypto.randomUUID()
  await c.env.DB.prepare('INSERT INTO homes (id, name, created_at) VALUES (?, ?, ?)')
    .bind(id, name, new Date().toISOString())
    .run()

  return c.json({ id, name }, 201)
})

// Extra read endpoint used by the web page. The assignment only requires the writes.
homesRoutes.get('/:homeId', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id, name FROM homes WHERE id = ?')
    .bind(homeId)
    .first<HomeRow>()
  if (!home) return errorResponse(c, 404, 'Home not found')

  const members = await c.env.DB.prepare(
    'SELECT id, home_id AS homeId, name FROM members WHERE home_id = ? ORDER BY position',
  )
    .bind(homeId)
    .all<MemberRow>()

  return c.json({
    id: home.id,
    name: home.name,
    members: members.results.map((member) => ({ id: member.id, name: member.name })),
  })
})

homesRoutes.post('/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')

  const body = await readJsonObject(c)
  if (!body) return errorResponse(c, 400, 'Request body must be a JSON object')

  const name = readName(body.name)
  if (!name) {
    return errorResponse(c, 422, 'name must be a non-empty string of at most 120 characters')
  }

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()
  if (!home) return errorResponse(c, 404, 'Home not found')

  const id = crypto.randomUUID()

  // The position is computed inside the same statement as the insert, so it is atomic.
  await c.env.DB.prepare(
    `INSERT INTO members (id, home_id, name, position, created_at)
     VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM members WHERE home_id = ?), ?)`,
  )
    .bind(id, homeId, name, homeId, new Date().toISOString())
    .run()

  return c.json({ id, homeId, name }, 201)
})

homesRoutes.get('/:homeId/balances', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()
  if (!home) return errorResponse(c, 404, 'Home not found')

  const balances = await c.env.DB.prepare(
    `SELECT
       m.id AS memberId,
       m.name AS name,
       COALESCE(SUM(
         CASE WHEN s.paid_at IS NULL AND b.id IS NOT NULL THEN s.amount_cents ELSE 0 END
       ), 0) AS outstandingCents
     FROM members m
     LEFT JOIN shares s ON s.member_id = m.id
     LEFT JOIN bills b ON b.id = s.bill_id AND b.home_id = m.home_id
     WHERE m.home_id = ?
     GROUP BY m.id, m.name, m.position
     ORDER BY m.position`,
  )
    .bind(homeId)
    .all<BalanceRow>()

  return c.json({ balances: balances.results })
})
