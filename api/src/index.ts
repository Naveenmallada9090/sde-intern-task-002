import { Hono } from 'hono'
import { billsRoutes } from './routes/bills'
import { homesRoutes } from './routes/homes'
import type { AppEnv } from './types'

const app = new Hono<AppEnv>()

app.get('/api/health', (c) => c.json({ status: 'ok' }))
app.route('/api/homes', homesRoutes)
app.route('/api', billsRoutes)

app.notFound((c) => c.json({ error: 'Not found' }, 404))

app.onError((error, c) => {
  console.error(error)
  return c.json({ error: 'Internal server error' }, 500)
})

export default app
