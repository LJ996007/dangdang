import type { WeightOwner } from './types'

export const weightOwners: WeightOwner[] = ['baby', 'mother']

export const weightOwnerLabels: Record<WeightOwner, string> = {
  baby: '宝宝',
  mother: '妈妈',
}

export function normalizeWeightKg(value: unknown) {
  const numberValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : Number.NaN

  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return null
  }

  return Math.round(numberValue * 100) / 100
}

export function inferWeightOwner(weightKg: number) {
  return weightKg < 10 ? 'baby' : 'mother'
}

export function normalizeWeightOwner(
  value: unknown,
  weightKg: number | null | undefined,
) {
  if (value === 'baby' || value === 'mother') {
    return value
  }

  if (weightKg == null) {
    return null
  }

  return inferWeightOwner(weightKg)
}
