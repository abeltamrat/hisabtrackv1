export interface CategoryNode { id: string; name: string; parentId?: string }

export interface FlattenedCategory<T extends CategoryNode> {
  category: T;
  depth: number;
}

export function flattenCategoryHierarchy<T extends CategoryNode>(categories: readonly T[]): FlattenedCategory<T>[] {
  const byId = new Map(categories.map(category => [category.id, category]));
  const children = new Map<string, T[]>();
  categories.forEach(category => {
    if (!category.parentId || !byId.has(category.parentId)) return;
    const siblings = children.get(category.parentId) || [];
    siblings.push(category);
    children.set(category.parentId, siblings);
  });

  const result: FlattenedCategory<T>[] = [];
  const visited = new Set<string>();
  const visit = (category: T, depth: number) => {
    if (visited.has(category.id)) return;
    visited.add(category.id);
    result.push({ category, depth });
    (children.get(category.id) || []).forEach(child => visit(child, depth + 1));
  };

  categories
    .filter(category => !category.parentId || !byId.has(category.parentId))
    .forEach(category => visit(category, 0));

  // Keep malformed or cyclic records visible so a user can still filter by them.
  categories.forEach(category => visit(category, 0));
  return result;
}

export function buildCategoryScopes(categories: readonly CategoryNode[]): Record<string, string[]> {
  const children = new Map<string, CategoryNode[]>();
  for (const category of categories) {
    if (!category.parentId) continue;
    children.set(category.parentId, [...(children.get(category.parentId) || []), category]);
  }
  const scopes: Record<string, string[]> = {};
  for (const category of categories) {
    const names: string[] = [];
    const seen = new Set<string>();
    const visit = (node: CategoryNode) => {
      if (seen.has(node.id)) return;
      seen.add(node.id);
      names.push(node.name);
      for (const child of children.get(node.id) || []) visit(child);
    };
    visit(category);
    scopes[category.name] = names;
  }
  return scopes;
}

export function nonOverlappingCategoryNames(names: string[], scopes: Record<string, string[]>): string[] {
  const selected = new Set(names);
  return names.filter(name => !names.some(other =>
    other !== name && selected.has(other) && (scopes[other] || [other]).includes(name)
  ));
}
