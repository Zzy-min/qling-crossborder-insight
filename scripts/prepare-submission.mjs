import archiver from 'archiver'
import { chromium } from '@playwright/test'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const output = resolve(root, 'artifacts/submission')
const screenshots = join(output, 'screenshots')
await rm(output, { recursive: true, force: true })
await mkdir(screenshots, { recursive: true })

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.csv': 'text/csv' }
const server = createServer(async (request, response) => {
  const pathname = request.url === '/' ? '/index.html' : request.url.split('?')[0]
  const path = resolve(root, `dist${pathname}`)
  if (!path.startsWith(resolve(root, 'dist'))) return response.writeHead(403).end()
  try {
    response.setHeader('Content-Type', mime[extname(path)] ?? 'application/octet-stream')
    response.end(await readFile(path))
  } catch {
    response.writeHead(404).end()
  }
})
await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
const { port } = server.address()

const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 })
  await desktop.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' })
  await desktop.screenshot({ path: join(screenshots, '01-overview-desktop.png'), fullPage: true })
  await desktop.locator('input[type=file]').setInputFiles(resolve(root, 'public/samples/reviews-template.csv'))
  await desktop.getByText('本地 CSV · reviews-template.csv').waitFor()
  await desktop.screenshot({ path: join(screenshots, '02-csv-evidence-report.png'), fullPage: true })

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })
  await mobile.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' })
  await mobile.screenshot({ path: join(screenshots, '03-mobile.png'), fullPage: true })
} finally {
  await browser.close()
  await new Promise((resolveClose) => server.close(resolveClose))
}

const materialFiles = [
  'docs/submission/preliminary-submission.md',
  'docs/submission/demo-script.md',
  'docs/submission/submission-evidence.md',
  'docs/hackathon-build/architecture.md',
  'docs/hackathon-build/acceptance.md',
  'public/samples/reviews-template.csv',
]
const generatedFiles = [
  ...materialFiles,
  'artifacts/submission/screenshots/01-overview-desktop.png',
  'artifacts/submission/screenshots/02-csv-evidence-report.png',
  'artifacts/submission/screenshots/03-mobile.png',
]
const manifest = {
  schemaVersion: '1.0',
  generatedAt: new Date().toISOString(),
  gitCommit: process.env.GIT_COMMIT || 'working-tree',
  status: 'draft-not-submitted',
  files: await Promise.all(generatedFiles.map(async (file) => {
    const bytes = await readFile(resolve(root, file))
    return { path: file.replace('artifacts/submission/', ''), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
  })),
}
await writeFile(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

const zipPath = join(output, 'qling-preliminary-materials.zip')
await new Promise((resolveZip, reject) => {
  const archive = archiver('zip', { zlib: { level: 9 } })
  const stream = createWriteStream(zipPath)
  stream.on('close', resolveZip)
  archive.on('error', reject)
  archive.pipe(stream)
  for (const file of materialFiles) archive.file(resolve(root, file), { name: file })
  archive.directory(screenshots, 'screenshots')
  archive.file(join(output, 'manifest.json'), { name: 'manifest.json' })
  void archive.finalize()
})
console.log(JSON.stringify({ output, screenshots: 3, materials: materialFiles.length, zip: zipPath }, null, 2))
