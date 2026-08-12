import { createApiServer } from './app.mjs'

const host = '127.0.0.1'
const port = Number(process.env.PORT || 8787)
const server = createApiServer({ apiKey: process.env.BAILIAN_API_KEY })
server.listen(port, host, () => console.log(`Qling API listening on http://${host}:${port}`))
