import { AIFinancialAssistant, type AssistantApiKeys } from '@/services/AIFinancialAssistant';
import type { TransactionType } from '@/context/TransactionContext';

export type CategoryDetail = 'simple' | 'balanced' | 'detailed';
export interface CategoryAnswers { use: 'personal' | 'family' | 'business' | 'both'; income: string; spending: string; commitments: string; detail: CategoryDetail }
export interface CategoryDraft { tempId: string; parentTempId?: string; name: string; type: TransactionType; icon: string; color: string }
type Node = { name: string; type: TransactionType; children?: Node[] };

const colors = ['#8b5cf6','#3b82f6','#10b981','#f59e0b','#ef4444','#06b6d4','#ec4899','#64748b'];
const icons: Record<string, string> = { income:'money', food:'cutlery', home:'home', transport:'car', health:'medkit', family:'users', business:'briefcase', debt:'credit-card', savings:'bank', education:'graduation-cap', giving:'gift', utilities:'bolt' };
const iconFor = (name: string, type: TransactionType) => Object.entries(icons).find(([key]) => name.toLowerCase().includes(key))?.[1] || (type === 'income' ? 'money' : 'folder');
const clean = (value: unknown) => String(value || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 60);

const localPlan = (a: CategoryAnswers): Node[] => {
  const personal: Node[] = [
    { name:'Income', type:'income', children:[{name:'Employment',type:'income',children:[{name:'Salary',type:'income'},{name:'Allowances',type:'income'}]},{name:'Other Income',type:'income',children:[{name:'Freelance',type:'income'},{name:'Gifts Received',type:'income'}]}] },
    { name:'Food', type:'expense', children:[{name:'Home Food',type:'expense',children:[{name:'Groceries',type:'expense'},{name:'Injera & Bakery',type:'expense'}]},{name:'Eating Out',type:'expense',children:[{name:'Restaurants',type:'expense'},{name:'Coffee & Snacks',type:'expense'}]}] },
    { name:'Home', type:'expense', children:[{name:'Housing',type:'expense',children:[{name:'Rent',type:'expense'},{name:'Repairs',type:'expense'}]},{name:'Utilities',type:'expense',children:[{name:'Electricity',type:'expense'},{name:'Water',type:'expense'},{name:'Internet & Phone',type:'expense'}]}] },
    { name:'Transport', type:'expense', children:[{name:'Public Transport',type:'expense',children:[{name:'Taxi & Ride',type:'expense'},{name:'Bus',type:'expense'}]},{name:'Vehicle',type:'expense',children:[{name:'Fuel',type:'expense'},{name:'Maintenance',type:'expense'}]}] },
    { name:'Family & Community', type:'expense', children:[{name:'Education',type:'expense',children:[{name:'School Fees',type:'expense'},{name:'Books & Supplies',type:'expense'}]},{name:'Community',type:'expense',children:[{name:'Equb',type:'expense'},{name:'Iddir',type:'expense'},{name:'Religious Giving',type:'expense'}]}] },
    { name:'Health', type:'expense', children:[{name:'Medical Care',type:'expense',children:[{name:'Medicine',type:'expense'},{name:'Clinic & Hospital',type:'expense'}]}] },
  ];
  const business: Node[] = [
    { name:'Business Income',type:'income',children:[{name:'Sales',type:'income',children:[{name:'Cash Sales',type:'income'},{name:'Digital Sales',type:'income'}]},{name:'Service Revenue',type:'income'}] },
    { name:'Business Costs',type:'expense',children:[{name:'Operations',type:'expense',children:[{name:'Inventory',type:'expense'},{name:'Rent & Utilities',type:'expense'}]},{name:'People',type:'expense',children:[{name:'Wages',type:'expense'},{name:'Contractors',type:'expense'}]},{name:'Taxes & Fees',type:'expense'}] },
  ];
  let plan = a.use === 'business' ? business : a.use === 'both' ? [...personal, ...business] : personal;
  if (a.detail === 'simple') plan = plan.map(node => ({ ...node, children: node.children?.map(child => ({ ...child, children: undefined })) }));
  return plan;
};

const flatten = (nodes: Node[], existingNames: string[]) => {
  const used = new Set(existingNames.map(name => name.toLowerCase())); const result: CategoryDraft[] = []; let sequence = 0;
  const visit = (node: Node, parentTempId?: string, depth = 0) => {
    if (depth > 3 || !node || !['income','expense'].includes(node.type)) return;
    const name = clean(node.name); if (!name || used.has(name.toLowerCase())) return;
    used.add(name.toLowerCase()); const tempId = `suggested-${sequence++}`;
    result.push({ tempId, parentTempId, name, type: node.type, icon: iconFor(name, node.type), color: colors[depth % colors.length] });
    (Array.isArray(node.children) ? node.children : []).slice(0, 10).forEach(child => visit({ ...child, type: node.type }, tempId, depth + 1));
  };
  nodes.slice(0, 16).forEach(node => visit(node)); return result.slice(0, 80);
};

export default class AICategoryService {
  static async suggest(answers: CategoryAnswers, existingNames: string[], keys: AssistantApiKeys) {
    let nodes = localPlan(answers); let source: 'ai' | 'local' = 'local';
    try {
      const text = await AIFinancialAssistant.generateCategoryHierarchy(answers, existingNames, keys);
      const match = text.match(/\[[\s\S]*\]/); if (!match) throw new Error('AI returned no category list');
      const parsed = JSON.parse(match[0]); if (!Array.isArray(parsed)) throw new Error('Invalid category list');
      nodes = parsed; source = 'ai';
    } catch { /* Private, deterministic suggestions remain available offline. */ }
    let categories = flatten(nodes, existingNames);
    if (!categories.length && source === 'ai') { source = 'local'; categories = flatten(localPlan(answers), existingNames); }
    return { source, categories };
  }
}
