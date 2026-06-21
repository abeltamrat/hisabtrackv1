export const MAX_TAGS_PER_TRANSACTION = 12;
export const MAX_TAG_LENGTH = 40;

const splitTags = (value: string): string[] =>
  value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

export const normalizeTransactionTags = (tags?: Array<string | null | undefined>): string[] | undefined => {
  if (!tags || tags.length === 0) {
    return undefined;
  }

  const result: string[] = [];
  const seen = new Set<string>();

  for (const rawTag of tags) {
    if (typeof rawTag !== 'string') continue;
    const collapsed = rawTag.trim().replace(/\s+/g, ' ');
    if (!collapsed) continue;

    const clipped = collapsed.slice(0, MAX_TAG_LENGTH);
    const key = clipped.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(clipped);

    if (result.length >= MAX_TAGS_PER_TRANSACTION) break;
  }

  return result.length > 0 ? result : undefined;
};

export const parseTagInput = (value: string): string[] | undefined => {
  if (!value.trim()) return undefined;
  return normalizeTransactionTags(splitTags(value));
};

export const formatTagInput = (tags?: string[]): string => (tags || []).join(', ');

export const hasTag = (tags: string[] | undefined, selectedTag: string | null) => {
  if (!selectedTag) return true;
  if (!tags || tags.length === 0) return false;
  const wanted = selectedTag.toLowerCase();
  return tags.some((tag) => tag.toLowerCase() === wanted);
};
