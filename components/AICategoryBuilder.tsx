import CoinLoader from '@/components/CoinLoader';
import { useAppSettings } from '@/contexts/AppSettingsContext';
import AICategoryService, { type CategoryAnswers, type CategoryDraft } from '@/services/AICategoryService';
import { FontAwesome } from '@expo/vector-icons';
import React from 'react';
import { Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

const uses: Array<[CategoryAnswers['use'], string]> = [['personal','Personal'],['family','Family'],['business','Business'],['both','Personal + business']];
const details: Array<[CategoryAnswers['detail'], string]> = [['simple','Simple'],['balanced','Balanced'],['detailed','Detailed']];
const initial: CategoryAnswers = { use:'personal', income:'', spending:'', commitments:'', detail:'balanced' };

export default function AICategoryBuilder({ visible, existingNames, onClose, onSave }: { visible:boolean; existingNames:string[]; onClose:()=>void; onSave:(drafts:CategoryDraft[])=>Promise<void> }) {
  const settings = useAppSettings();
  const [answers, setAnswers] = React.useState(initial);
  const [suggestions, setSuggestions] = React.useState<CategoryDraft[]>([]);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [working, setWorking] = React.useState(false);
  const [source, setSource] = React.useState<'ai'|'local'>('local');
  const [error, setError] = React.useState('');
  const update = (patch: Partial<CategoryAnswers>) => setAnswers(value => ({ ...value, ...patch }));
  const reset = () => { setAnswers(initial); setSuggestions([]); setSelected(new Set()); setError(''); setWorking(false); };
  const close = () => { if (!working) { reset(); onClose(); } };
  const generate = async () => {
    setWorking(true); setError('');
    try {
      const result = await AICategoryService.suggest(answers, existingNames, { geminiApiKey:settings.geminiApiKey, groqApiKey:settings.groqApiKey, openRouterApiKey:settings.openRouterApiKey, topToolsApiKey:settings.topToolsApiKey, usePuterJs:settings.puterJsEnabled });
      setSuggestions(result.categories); setSelected(new Set(result.categories.map(item => item.tempId))); setSource(result.source);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create suggestions'); }
    finally { setWorking(false); }
  };
  const toggle = (item: CategoryDraft) => setSelected(previous => {
    const next = new Set(previous); const removing = next.has(item.tempId);
    const descendants = new Set<string>(); let changed = true;
    while (changed) { changed = false; for (const draft of suggestions) if (draft.parentTempId && (draft.parentTempId === item.tempId || descendants.has(draft.parentTempId)) && !descendants.has(draft.tempId)) { descendants.add(draft.tempId); changed = true; } }
    if (removing) { next.delete(item.tempId); descendants.forEach(id => next.delete(id)); }
    else { next.add(item.tempId); let parent = item.parentTempId; while (parent) { next.add(parent); parent = suggestions.find(draft => draft.tempId === parent)?.parentTempId; } }
    return next;
  });
  const save = async () => {
    setWorking(true); setError('');
    try { await onSave(suggestions.filter(item => selected.has(item.tempId))); reset(); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save categories'); setWorking(false); }
  };
  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
    <View className="flex-1 bg-slate-50 dark:bg-slate-950">
      <View className="flex-row items-center justify-between px-5 pt-5 pb-3"><View><Text className="text-xl font-extrabold text-slate-900 dark:text-white">AI category builder</Text><Text className="text-xs text-slate-500 dark:text-slate-400">Answer first, review everything, then save.</Text></View><TouchableOpacity accessibilityLabel="Close category builder" onPress={close} className="w-10 h-10 rounded-xl bg-slate-200 dark:bg-slate-800 items-center justify-center"><FontAwesome name="times" size={18} color="#64748b"/></TouchableOpacity></View>
      <ScrollView contentContainerStyle={{ padding:20, paddingBottom:40 }}>
        {!suggestions.length ? <>
          <Text className="font-bold text-slate-800 dark:text-slate-100 mb-2">1. What are you organizing?</Text><View className="flex-row flex-wrap mb-5">{uses.map(([value,label]) => <TouchableOpacity key={value} onPress={() => update({use:value})} className={`mr-2 mb-2 px-4 py-3 rounded-xl ${answers.use===value?'bg-violet-600':'bg-white dark:bg-slate-800'}`}><Text className={answers.use===value?'text-white font-bold':'text-slate-700 dark:text-slate-200 font-semibold'}>{label}</Text></TouchableOpacity>)}</View>
          <Question label="2. Where does money come from?" placeholder="Salary, shop sales, freelance, farming…" value={answers.income} onChangeText={income=>update({income})}/>
          <Question label="3. What do you spend most on?" placeholder="Rent, food, school, transport, inventory…" value={answers.spending} onChangeText={spending=>update({spending})}/>
          <Question label="4. What regular commitments matter?" placeholder="Equb, Iddir, loans, family support, taxes…" value={answers.commitments} onChangeText={commitments=>update({commitments})}/>
          <Text className="font-bold text-slate-800 dark:text-slate-100 mb-2">5. How much detail?</Text><View className="flex-row mb-5">{details.map(([value,label]) => <TouchableOpacity key={value} onPress={()=>update({detail:value})} className={`flex-1 mr-2 px-2 py-3 rounded-xl items-center ${answers.detail===value?'bg-violet-600':'bg-white dark:bg-slate-800'}`}><Text className={answers.detail===value?'text-white font-bold':'text-slate-700 dark:text-slate-200 font-semibold'}>{label}</Text></TouchableOpacity>)}</View>
          <Text className="text-xs text-slate-500 dark:text-slate-400 mb-4">If AI sharing and a provider are enabled, these answers are sent to that provider. Otherwise the builder creates private offline suggestions.</Text>
          <TouchableOpacity disabled={working} onPress={generate} className="bg-violet-600 rounded-2xl py-4 items-center">{working?<CoinLoader size="small"/>:<Text className="text-white font-extrabold">Create my category plan</Text>}</TouchableOpacity>
        </> : <>
          <View className="bg-violet-50 dark:bg-violet-950/40 rounded-2xl p-4 mb-4"><Text className="text-violet-900 dark:text-violet-200 font-bold">Review {selected.size} selected categories</Text><Text className="text-violet-700 dark:text-violet-300 text-xs mt-1">Generated with {source==='ai'?'your AI provider':'the private offline planner'}. Tap any row to include or remove its branch.</Text></View>
          {suggestions.map(item => { let depth=0,parent=item.parentTempId; while(parent){depth++;parent=suggestions.find(x=>x.tempId===parent)?.parentTempId;} const checked=selected.has(item.tempId); return <TouchableOpacity key={item.tempId} onPress={()=>toggle(item)} style={{ marginLeft:depth*18 }} className={`flex-row items-center p-3 mb-2 rounded-xl ${checked?'bg-white dark:bg-slate-800':'bg-slate-200 dark:bg-slate-900 opacity-60'}`}><FontAwesome name={checked?'check-square':'square-o'} size={18} color={checked?'#7c3aed':'#94a3b8'}/><View className="ml-3 flex-1"><Text className="font-bold text-slate-800 dark:text-slate-100">{item.name}</Text><Text className="text-[10px] uppercase text-slate-500 dark:text-slate-400">Level {depth+1} · {item.type}</Text></View></TouchableOpacity>; })}
          <View className="flex-row mt-4"><TouchableOpacity disabled={working} onPress={()=>setSuggestions([])} className="flex-1 mr-2 border border-violet-500 rounded-2xl py-4 items-center"><Text className="text-violet-600 font-bold">Change answers</Text></TouchableOpacity><TouchableOpacity disabled={working||!selected.size} onPress={save} className="flex-1 bg-violet-600 rounded-2xl py-4 items-center">{working?<CoinLoader size="small"/>:<Text className="text-white font-extrabold">Save hierarchy</Text>}</TouchableOpacity></View>
        </>}
        {!!error&&<Text accessibilityRole="alert" className="text-red-600 font-semibold mt-4">{error}</Text>}
      </ScrollView>
    </View>
  </Modal>;
}

function Question({label,...props}:{label:string;placeholder:string;value:string;onChangeText:(text:string)=>void}) { return <View className="mb-5"><Text className="font-bold text-slate-800 dark:text-slate-100 mb-2">{label}</Text><TextInput {...props} multiline className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl px-4 py-3 min-h-14" placeholderTextColor="#94a3b8"/></View>; }
