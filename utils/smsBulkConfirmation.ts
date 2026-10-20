export type BulkConfirmationDraft = {
  type: 'INCOME' | 'EXPENSE';
  is_transfer?: boolean;
  category: string;
  description: string;
};

export type BulkConfirmationEdits = {
  applyCategory: boolean;
  category?: string;
  description?: string;
  tags?: string[];
};

export type BulkEditEligibility = {
  canEditTogether: boolean;
  type?: 'INCOME' | 'EXPENSE';
  reason?: string;
};

/**
 * Shared classification is intentionally limited to ordinary transactions of
 * one direction. Transfers retain their transfer classification, while mixed
 * income/expense batches retain every draft's original classification.
 */
export function getBulkEditEligibility(drafts: BulkConfirmationDraft[]): BulkEditEligibility {
  if (drafts.length === 0) {
    return { canEditTogether: false, reason: 'Select at least one SMS transaction.' };
  }
  if (drafts.some(draft => draft.is_transfer)) {
    return {
      canEditTogether: false,
      reason: 'Transfers keep their detected accounts and transfer classification.',
    };
  }
  const types = new Set(drafts.map(draft => draft.type));
  if (types.size !== 1) {
    return {
      canEditTogether: false,
      reason: 'Select only expenses or only income to apply one category and description.',
    };
  }
  return { canEditTogether: true, type: drafts[0].type };
}

/** Resolve only the editable classification fields. Amount, account, date,
 * SMS/reference identity, recipient and fees never pass through this helper,
 * so callers must preserve those values from the individual parsed draft. */
export function resolveBulkConfirmationFields(
  draft: BulkConfirmationDraft,
  edits: BulkConfirmationEdits,
  canEditTogether: boolean,
): { category: string; description: string; tags: string[]; isCorrection: boolean } {
  const sharedDescription = edits.description?.trim();
  const category = canEditTogether && edits.applyCategory && edits.category?.trim()
    ? edits.category.trim()
    : draft.category;
  const description = canEditTogether && sharedDescription
    ? sharedDescription
    : draft.description;
  const tags = canEditTogether ? [...(edits.tags || [])] : [];

  return {
    category,
    description,
    tags,
    isCorrection: category !== draft.category || description !== draft.description,
  };
}
