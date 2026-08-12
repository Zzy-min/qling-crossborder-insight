import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { auditHumanReview } from './human-review.mjs'

const directory = resolve(import.meta.dirname, '../artifacts/evaluation/human-review')
const read = async (name) => JSON.parse(await readFile(resolve(directory, `${name}.json`), 'utf8'))
const result = auditHumanReview(await read('reviewerA'), await read('reviewerB'), await read('resolution'))
console.log(JSON.stringify(result, null, 2))
if (result.partiallyFilledOrInvalidCases.length > 0 || result.containsDirectIdentityFields) process.exitCode = 1
