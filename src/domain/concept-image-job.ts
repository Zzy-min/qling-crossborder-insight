import type { AnalysisRun } from './analysis-run'
import type { QuoteAnchor } from './types'
import type { ConceptImageFile } from './concept-image-file'
import type { ProxyProvider } from '../providers/provider'

export type ConceptImageStage = 'generating' | 'downloading' | 'saving' | 'saved'
export async function runConceptImageJob(input: {
  run: AnalysisRun; themeId: string; anchor: QuoteAnchor; hypothesis: string;
  provider: Pick<ProxyProvider, 'generateAnchoredConceptImage' | 'downloadAnchoredConceptImage'>;
  signal: AbortSignal; stillCurrent: () => boolean;
  onStage: (stage: ConceptImageStage) => void; onFile: (file: ConceptImageFile) => void;
  save: (file: ConceptImageFile, options: { signal: AbortSignal; stillCurrent: () => boolean }) => Promise<void>;
}) {
  const check = () => { input.signal.throwIfAborted(); if (!input.stillCurrent()) throw new DOMException('图片操作已失效', 'AbortError') }
  check(); input.onStage('generating')
  const response = await input.provider.generateAnchoredConceptImage(input.run, input.themeId, [input.anchor], input.hypothesis, { signal: input.signal })
  check(); input.onStage('downloading')
  const file = await input.provider.downloadAnchoredConceptImage(input.run, input.themeId, response, { signal: input.signal })
  check(); input.onFile(file); check(); input.onStage('saving'); check()
  await input.save(file, { signal: input.signal, stillCurrent: input.stillCurrent })
  check(); input.onStage('saved')
  return file
}
