import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import yauzlPromise from 'yauzl-promise'

const root = resolve(import.meta.dirname, '..')
const output = resolve(root, 'artifacts/submission')
const manifest = JSON.parse(await readFile(resolve(output, 'manifest.json'), 'utf8'))
if (manifest.status !== 'draft-not-submitted') throw new Error('Submission status must remain draft-not-submitted')
for (const entry of manifest.files) {
  const path = entry.path.startsWith('screenshots/') ? resolve(output, entry.path) : resolve(root, entry.path)
  const bytes = await readFile(path)
  const hash = createHash('sha256').update(bytes).digest('hex')
  if (hash !== entry.sha256) throw new Error(`Hash mismatch: ${entry.path}`)
}

const zip = await yauzlPromise.open(resolve(output, 'qling-preliminary-materials.zip'))
const forbidden = /(^|\/)(\.env|node_modules|dist|release)(\/|$)|\.log$|\.tsbuildinfo$/
let count = 0
try {
  for await (const entry of zip) {
    count += 1
    if (forbidden.test(entry.filename)) throw new Error(`Forbidden ZIP entry: ${entry.filename}`)
  }
} finally {
  await zip.close()
}
if (count !== 10) throw new Error(`Unexpected ZIP entry count: ${count}`)
console.log(JSON.stringify({ verifiedFiles: manifest.files.length, zipEntries: count, status: manifest.status }, null, 2))
