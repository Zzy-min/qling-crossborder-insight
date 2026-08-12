import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { goldenCases } from '../src/evaluation/goldenSet'
import { buildBlindReviewPackets } from './human-review.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const outputDirectory = resolve(root, 'artifacts/evaluation/human-review')
const packets = buildBlindReviewPackets(goldenCases)
await mkdir(outputDirectory, { recursive: true })

for (const [name, document] of Object.entries(packets)) {
  const outputPath = resolve(outputDirectory, `${name}.json`)
  await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'EEXIST') throw new Error(`Review packet already exists and was not overwritten: ${outputPath}`)
    throw error
  })
}
console.log(JSON.stringify({ outputDirectory, cases: goldenCases.length, packets: Object.keys(packets), status: 'awaiting-independent-review' }, null, 2))
