import { readFile, stat } from 'node:fs/promises'
import { extname, resolve } from 'node:path'

const path = resolve(import.meta.dirname, '../docs/submission/form-fields.json')
const form = JSON.parse(await readFile(path, 'utf8'))
const required = ['teamName', 'track', 'solutionName', 'solutionOverview', 'technicalPlan']
const missing = required.filter((field) => !form.fields[field]?.trim())
const counts = Object.fromEntries(Object.entries(form.fields).map(([field, value]) => [field, typeof value === 'string' ? [...value].length : null]))
const limits = form.verifiedFormLimits
const exceeded = Object.entries(limits)
  .filter(([field, limit]) => typeof limit === 'number' && field in counts && counts[field] > limit)
  .map(([field, limit]) => ({ field, count: counts[field], limit }))
const attachmentPath = resolve(import.meta.dirname, '..', form.fields.attachment)
const attachment = await stat(attachmentPath)
const attachmentExtension = extname(attachmentPath).slice(1).toLowerCase()
const attachmentValid = attachment.size <= limits.attachmentMaxBytes && limits.attachmentExtensions.includes(attachmentExtension)
const result = {
  status: form.status,
  deadline: form.deadline,
  missing,
  characterCounts: counts,
  verifiedFormLimits: limits,
  exceeded,
  attachment: { path: form.fields.attachment, bytes: attachment.size, extension: attachmentExtension, valid: attachmentValid },
  unverifiedLimits: form.unverifiedLimits,
  readyForFinalFormCheck: missing.length === 0 && exceeded.length === 0 && attachmentValid,
  readyToSubmit: false,
  reason: 'All known form constraints pass, but the authenticated form must be updated with this draft and external submission requires fresh confirmation.',
}
console.log(JSON.stringify(result, null, 2))
if (missing.length > 0 || exceeded.length > 0 || !attachmentValid || form.status !== 'draft-not-submitted') process.exitCode = 1
