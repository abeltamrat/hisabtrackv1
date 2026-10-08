export interface StoredForecastWarning {
  id: string;
  timestamp: number;
  read: boolean;
  sourceKey?: string;
}

export function reconcileForecastWarnings<T extends StoredForecastWarning>(
  existing: T[],
  active: Array<Omit<T, 'id' | 'timestamp' | 'read'>>,
  now = Date.now(),
): T[] {
  const activeKeys = new Set<string>(active.flatMap(item => typeof item.sourceKey === 'string' ? [item.sourceKey] : []));
  const retained = existing.filter(item => !item.sourceKey?.startsWith('forecast:low:') || activeKeys.has(item.sourceKey));
  for (const warning of active) {
    const index = retained.findIndex(item => item.sourceKey === warning.sourceKey);
    if (index >= 0) retained[index] = { ...retained[index], ...warning };
    else retained.unshift({ ...warning, id: `forecast-${now}-${retained.length}`, timestamp: now, read: false } as unknown as T);
  }
  return retained;
}
