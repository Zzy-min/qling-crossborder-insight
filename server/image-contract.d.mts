import type { ConceptImageBinding } from '../src/domain/concept-image'
export const IMAGE_PROMPT_VERSION: 'qling-image-evidence/2'
export function imageDataDigest(value: unknown): string
export function validateAnchoredImageRequest(value: unknown): { prompt: string; reviewIds: string[]; binding: ConceptImageBinding }
