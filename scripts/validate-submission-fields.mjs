import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const path = resolve(import.meta.dirname, '../docs/submission/form-fields.json')
const form = JSON.parse(await readFile(path, 'utf8'))
const required = ['teamName', 'track', 'solutionName', 'solutionOverview', 'coreFunctions', 'highlights', 'technicalPlan']
const missing = required.filter((field) => !form.fields[field]?.trim())
const counts = Object.fromEntries(Object.entries(form.fields).map(([field, value]) => [field, typeof value === 'string' ? [...value].length : null]))
const result = {
  status: form.status,
  deadline: form.deadline,
  missing,
  characterCounts: counts,
  unverifiedLimits: form.unverifiedLimits,
  readyForFinalFormCheck: missing.length === 0,
  readyToSubmit: false,
  reason: 'Character/file limits and personal fields require verification in the authenticated form; external submission requires fresh confirmation.',
}
console.log(JSON.stringify(result, null, 2))
if (missing.length > 0 || form.status !== 'draft-not-submitted') process.exitCode = 1
