import type { DatasetBundle, ReviewSentiment, ReviewTheme, ThemeSampleStats } from './types'

export const SAMPLE_THRESHOLDS = { mentionRate: 0.2, negativeRate: 0.6, minimumSamples: 20, minimumMentions: 3 } as const

export function negativeReviewIds(themes: ReviewTheme[], dataset: DatasetBundle): Set<string> {
  const known = new Set(dataset.reviews.map((review) => review.reviewId))
  const predictions = new Map<string, { reviewId: string; values: Set<ReviewSentiment> }>()
  for (const theme of themes) for (const reference of theme.evidence) {
    if (reference.evidenceType !== 'review' || !known.has(reference.recordId)) continue
    const key = JSON.stringify([theme.aspectId ?? theme.id, reference.recordId])
    const prediction = predictions.get(key) ?? { reviewId: reference.recordId, values: new Set<ReviewSentiment>() }
    prediction.values.add(theme.sentiment)
    predictions.set(key, prediction)
  }
  return new Set([...predictions.values()].filter((prediction) => prediction.values.size === 1 && prediction.values.has('negative')).map((prediction) => prediction.reviewId))
}

export function sampleStatistics(theme: ReviewTheme, themes: ReviewTheme[], dataset: DatasetBundle): ThemeSampleStats[] {
  const products = theme.productId ? dataset.products.filter((product) => product.productId === theme.productId && (!theme.market || product.market === theme.market)) : dataset.products
  const related = themes.filter((finding) => (finding.aspectId ?? finding.id) === (theme.aspectId ?? theme.id))
  return products.map((product) => {
    const reviews = new Map(dataset.reviews.filter((review) => review.productId === product.productId).map((review) => [review.reviewId, review]))
    const sentiments = new Map<string, Set<ReviewSentiment>>()
    for (const finding of related) {
      for (const reference of finding.evidence) {
        if (reference.evidenceType !== 'review' || !reviews.has(reference.recordId)) continue
        const values = sentiments.get(reference.recordId) ?? new Set<ReviewSentiment>()
        values.add(finding.sentiment)
        sentiments.set(reference.recordId, values)
      }
    }
    const labels = [...sentiments.values()].map((values) => values.size === 1 ? [...values][0] : 'mixed')
    const sampleCount = reviews.size
    const mentionCount = sentiments.size
    const negativeCount = labels.filter((label) => label === 'negative').length
    const mixedCount = labels.filter((label) => label === 'mixed').length
    const mentionRate = sampleCount ? mentionCount / sampleCount : 0
    const negativeRate = mentionCount ? negativeCount / mentionCount : 0
    const eligible = sampleCount >= SAMPLE_THRESHOLDS.minimumSamples && mentionCount >= SAMPLE_THRESHOLDS.minimumMentions
    const dates = [...reviews.values()].map((review) => review.reviewedAt).sort()
    const highMention = mentionRate >= SAMPLE_THRESHOLDS.mentionRate
    const highNegative = negativeRate >= SAMPLE_THRESHOLDS.negativeRate
    const quadrant = eligible ? highMention ? highNegative ? 'high-mention-high-negative' : 'high-mention-low-negative' : highNegative ? 'low-mention-high-negative' : 'low-mention-low-negative' : null
    return { version: 'qling-sample-statistics/1', productId: product.productId, market: product.market,
      basis: 'unreviewed-predictions', sampleCount, mentionCount, negativeCount, mixedCount, mentionRate, negativeRate,
      timeRange: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
      thresholds: { ...SAMPLE_THRESHOLDS }, status: eligible ? 'eligible' : 'insufficient-sample', quadrant }
  })
}

export function sampleStatisticsLabel(sample: Omit<ThemeSampleStats, 'basis'>): string {
  const quadrant = sample.quadrant ? { 'high-mention-high-negative': '高提及 × 高负向', 'high-mention-low-negative': '高提及 × 低负向', 'low-mention-high-negative': '低提及 × 高负向', 'low-mention-low-negative': '低提及 × 低负向' }[sample.quadrant] : '样本不足，不判断象限'
  const mentions = sample.sampleCount ? `${sample.mentionCount}/${sample.sampleCount}（${(sample.mentionRate * 100).toFixed(1)}%）` : '无有效样本，不可计算'
  const negatives = sample.mentionCount ? `${sample.negativeCount}/${sample.mentionCount}（${(sample.negativeRate * 100).toFixed(1)}%）` : '无方面提及，不可计算'
  return `${sample.productId} / ${sample.market} · 样本提及率 ${mentions} · 预测负向占比 ${negatives} · 混合 ${sample.mixedCount} · ${quadrant}`
}
