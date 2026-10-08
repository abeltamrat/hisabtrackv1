export interface CategoryNode { id: string; name: string; parentId?: string }

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
