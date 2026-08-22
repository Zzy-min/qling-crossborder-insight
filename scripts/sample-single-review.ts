import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { goldenCases } from '../src/evaluation/goldenSet'
import { buildBlindReviewPackets } from './human-review.mjs'

// P1-2 抽样复核：单人参赛场景下，从 200 例机器播种集分层抽 40 例做单人复核。
// 设计目标：
//   1. 可复现——固定种子，任何人重跑都能得到同一份抽样。
//   2. 分层均衡——4 个 family 各抽 10 例，避免某一类被漏掉。
//   3. 不破坏双人流程——独立产出，不改 reviewerA/reviewerB 包。
//   4. 诚实标注——复核者含 AI，覆盖率 20%，无双人交叉，全部写入报告。
//
// 用法：tsx scripts/sample-single-review.ts
// 产出：artifacts/evaluation/single-review/sample-40.json + sample-40.md

const SAMPLE_SIZE = 40
const PER_FAMILY = 10
const SEED = 20260822

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const outputDirectory = resolve(root, 'artifacts/evaluation/single-review')

// 确定性伪随机（mulberry32），保证可复现
function mulberry32(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6D2B79F5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// AI 预填判断：核对 body 文本是否直接支持 expected themeIds。
// 模板标签是构造时硬编码的，这里逐例验证“文本确实支持标签”这一假设。
// 返回 { decision, themeIds, riskIds, notes, confidence }
function prefillJudgment(goldenCase: (typeof goldenCases)[number]) {
  const body = goldenCase.dataset.reviews[0]?.body ?? ''
  const expectedThemes = goldenCase.expected.themeIds
  const family = goldenCase.family

  // 文本→主题支持性核对（基于模板构造规则，但逐字验证关键词出现）
  const themeChecks = expectedThemes.map((theme) => {
    if (theme === 'thermal') {
      const hit = /hot|overheat|heat/i.test(body)
      return { theme, supported: hit, evidence: hit ? 'body 含热相关词' : 'body 未含热相关词' }
    }
    if (theme === 'port-reset') {
      const hit = /reset|interrupt|second device|second cable|another cable/i.test(body)
      return { theme, supported: hit, evidence: hit ? 'body 含复位/中断相关词' : 'body 未含复位相关词' }
    }
    return { theme, supported: false, evidence: '未知主题，无法自动核对' }
  })

  // neutral 族：期望 0 主题，验证 body 确实不含热/复位词
  let neutralClean = true
  if (family === 'neutral') {
    neutralClean = !/hot|overheat|heat|reset|interrupt/i.test(body)
  }

  const allSupported = themeChecks.every((c) => c.supported)
  const decision = (family === 'neutral' ? neutralClean : allSupported) ? 'accept' : 'revise'
  const confidence = decision === 'accept' ? 'high' : 'low'

  const notes = family === 'neutral'
    ? neutralClean
      ? 'neutral 族：body 不含热/复位词，与 expected.themeIds=[] 一致'
      : 'neutral 族：body 误含热/复位词，与空主题矛盾，需 revise'
    : `${family} 族：${themeChecks.map((c) => `${c.theme}=${c.supported ? 'supported' : 'MISSING'}`).join('; ')}`

  return {
    decision,
    themeIds: expectedThemes,
    riskIds: goldenCase.expected.riskIds,
    notes,
    confidence,
    themeChecks,
  }
}

async function main() {
  // 按 family 分组
  const byFamily = new Map<string, (typeof goldenCases)[number][]>()
  for (const c of goldenCases) {
    const arr = byFamily.get(c.family) ?? []
    arr.push(c)
    byFamily.set(c.family, arr)
  }

  const families = ['thermal', 'port-reset', 'combined', 'neutral']
  const rng = mulberry32(SEED)
  const sampled: (typeof goldenCases)[number][] = []

  for (const family of families) {
    const pool = byFamily.get(family) ?? []
    // 确定性洗牌：用 rng 给每个 case 打分，取分最高的 PER_FAMILY 个
    const scored = pool.map((c) => ({ c, r: rng() }))
      .sort((a, b) => b.r - a.r)
      .slice(0, PER_FAMILY)
      .map((x) => x.c)
    sampled.push(...scored)
  }

  // 构造单人复核包
  const reviewerId = 'qling-qiqi-ai'
  const cases = sampled.map((c) => {
    const input = {
      reviewTitle: c.dataset.reviews[0]?.title ?? '',
      reviewBody: c.dataset.reviews[0]?.body ?? '',
      policyIds: c.dataset.policies.map((p) => p.policyId),
    }
    const prefill = prefillJudgment(c)
    return {
      id: c.id,
      family: c.family,
      seed: c.seed,
      input,
      machineExpectation: c.expected,
      decision: prefill.decision,
      themeIds: prefill.themeIds,
      riskIds: prefill.riskIds,
      notes: prefill.notes,
      confidence: prefill.confidence,
      themeChecks: prefill.themeChecks,
      humanConfirm: '', // 留空：accept / revise / dispute
      humanNotes: '',   // 留空：人类复核者备注
    }
  })

  const document = {
    schemaVersion: '3.0-single-review',
    generatedAt: new Date().toISOString(),
    sampleSize: SAMPLE_SIZE,
    perFamily: PER_FAMILY,
    seed: SEED,
    reviewerId,
    reviewerType: 'ai-prefill-with-human-confirm',
    coverage: `${SAMPLE_SIZE}/${goldenCases.length}`,
    limitations: [
      '单人参赛，无双人独立复核',
      '覆盖率 20%（40/200），未达 95% 门槛',
      'AI 预填判断，非纯人类独立判断',
      '合成 fixture，复核主要验证模板标注一致性，非模型真实表现',
      '双人流程（reviewerA/B + resolution）保留为升级路径，待第二人加入',
    ],
    cases,
  }

  await mkdir(outputDirectory, { recursive: true })
  const jsonPath = resolve(outputDirectory, 'sample-40.json')
  await writeFile(jsonPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8')

  // 同时输出 Markdown 工作表，供人类 10 分钟扫视确认
  const mdPath = resolve(outputDirectory, 'sample-40.md')
  const md = buildMarkdown(document)
  await writeFile(mdPath, md, 'utf8')

  const accepted = cases.filter((c) => c.decision === 'accept').length
  const revise = cases.filter((c) => c.decision === 'revise').length
  console.log(JSON.stringify({
    jsonPath,
    mdPath,
    sampleSize: SAMPLE_SIZE,
    coverage: document.coverage,
    seed: SEED,
    prefill: { accept: accepted, revise },
  }, null, 2))
}

function buildMarkdown(doc: typeof documentType): string {
  const lines: string[] = []
  lines.push(`# 黄金集单人抽样复核工作表（P1-2）`)
  lines.push('')
  lines.push(`- 生成时间：${doc.generatedAt}`)
  lines.push(`- 抽样：${doc.coverage}（每 family ${doc.perFamily} 例，种子 ${doc.seed}，可复现）`)
  lines.push(`- 复核者：${doc.reviewerId}（${doc.reviewerType}）`)
  lines.push('')
  lines.push(`## 局限性（必须如实写入复赛材料）`)
  lines.push('')
  for (const l of doc.limitations) lines.push(`- ${l}`)
  lines.push('')
  lines.push(`## 复核表`)
  lines.push('')
  lines.push('| # | id | family | body（节选） | 机器期望 | AI 预填 | 置信 | 人类确认 | 备注 |')
  lines.push('|---|---|---|---|---|---|---|---|---|')
  doc.cases.forEach((c, i) => {
    const bodySnippet = c.input.reviewBody.length > 60 ? c.input.reviewBody.slice(0, 57) + '...' : c.input.reviewBody
    const expected = `themes=[${c.machineExpectation.themeIds.join(',')}] risks=[${c.machineExpectation.riskIds.join(',')}]`
    const aiDecision = c.decision
    const conf = c.confidence
    lines.push(`| ${i + 1} | ${c.id} | ${c.family} | ${bodySnippet.replace(/\|/g, '\\|')} | ${expected} | ${aiDecision} | ${conf} | ☐ accept ☐ revise ☐ dispute | ${c.notes.replace(/\|/g, '\\|')} |`)
  })
  lines.push('')
  lines.push(`## 复核者签名`)
  lines.push('')
  lines.push(`- AI 预填：${doc.reviewerId}（${new Date().toISOString().slice(0, 10)}）`)
  lines.push(`- 人类确认：______________（日期：________）`)
  lines.push('')
  lines.push(`## 复核流程`)
  lines.push('')
  lines.push(`1. AI 已对 40 例逐字核对 body 文本是否支持 expected themeIds，预填 accept/revise。`)
  lines.push(`2. 人类复核者扫视上表，对每例勾选确认（accept/revise/dispute）。`)
  lines.push(`3. 有 dispute 的样例记入 humanNotes，后续单独处置。`)
  lines.push(`4. 全部确认后，将结果回写到 resolution.json 的对应 40 例，并更新 human-review.md 进度。`)
  lines.push(`5. \`npm run eval\` 重跑，确认无回归。`)
  lines.push('')
  return lines.join('\n')
}

// 仅用于类型
const documentType = {
  schemaVersion: '', generatedAt: '', sampleSize: 0, perFamily: 0, seed: 0,
  reviewerId: '', reviewerType: '', coverage: '', limitations: [] as string[],
  cases: [] as never[],
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
