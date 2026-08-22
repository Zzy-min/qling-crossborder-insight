import { createApiServer } from './app.mjs'

const host = '127.0.0.1'
const port = Number(process.env.PORT || 8787)
const server = createApiServer({
  apiKey: process.env.BAILIAN_API_KEY,
  baseUrl: process.env.BAILIAN_BASE_URL,
  model: process.env.BAILIAN_MODEL,
})
server.listen(port, host, () => console.log(`Qling API listening on http://${host}:${port}`))
