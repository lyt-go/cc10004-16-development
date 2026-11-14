import { SEED_MESSAGE_BATCHES } from './quality-seed'
import { clone } from './quality-utils'
import { even0002VersionV7 } from './quality-fixtures'
import type { QualityState } from './quality-types'

// 质量检查记录单独存一份，避免和业务清单共用 localStorage 时互相覆盖。
const QUALITY_STORAGE_KEY = 'data-product-ops:quality-checks'

function seedState(): QualityState {
  return {
    revision: 0,
    checks: [],
    eventVersions: [even0002VersionV7()],
    revisions: [],
    messageBatches: clone(SEED_MESSAGE_BATCHES),
  }
}

function readStorage(): QualityState {
  const fallback = seedState()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(QUALITY_STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(QUALITY_STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as QualityState
    return {
      revision: parsed.revision ?? fallback.revision,
      checks: parsed.checks ?? fallback.checks,
      eventVersions: parsed.eventVersions ?? fallback.eventVersions,
      revisions: parsed.revisions ?? fallback.revisions,
      messageBatches: parsed.messageBatches ?? fallback.messageBatches,
    }
  } catch {
    window.localStorage.setItem(QUALITY_STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: QualityState | null = null

export function qualityState(): QualityState {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function saveQualityState(next: QualityState): void {
  const persisted = { ...next, revision: next.revision + 1 }
  cache = persisted
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(QUALITY_STORAGE_KEY, JSON.stringify(persisted))
  }
}

/** 只读快照用：调用方随便改也不会影响持久化数据。 */
export function qualitySnapshot(): QualityState {
  return clone(qualityState())
}

export function resetQualityState(): QualityState {
  const seeded = seedState()
  saveQualityState(seeded)
  return seeded
}
