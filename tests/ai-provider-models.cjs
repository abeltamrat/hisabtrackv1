const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
let sharing = true;
function load(file) {
  const mod = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function('require', 'module', 'exports', code)(name => {
    if (name === 'react-native') return { Platform: { OS: 'android' } };
    if (name === '@/contexts/AppSettingsContext') return { loadStoredAppSettings: async () => ({ aiSharingEnabled: sharing }) };
    if (name === '@/services/TopToolsAIClient') return load('services/TopToolsAIClient.ts');
    if (name === '@/utils/finance') return {};
    throw new Error(name);
  }, mod, mod.exports);
  return mod.exports;
}
const { AIFinancialAssistant: AI } = load('services/AIFinancialAssistant.ts');
const ok = content => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) });
test('Gemini uses supported endpoint and joins visible response parts', async () => {
  const original = global.fetch;
  global.fetch = async (url, options) => {
    assert.match(url, /v1beta.*gemini-3.5-flash-lite:generateContent$/);
    assert.ok(!url.includes('secret'));
    assert.equal(options.headers['x-goog-api-key'], 'secret');
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ thought: true, text: 'hidden' }, { text: 'hello ' }, { text: 'world' }] } }] }) };
  };
  try { assert.equal(await AI.generateWithGeminiFallback('secret', 'hi'), 'hello world'); }
  finally { global.fetch = original; }
});
test('Groq retries retired models and preserves earlier failure reasons', async () => {
  const original = global.fetch;
  const models = [];
  global.fetch = async (url, options) => {
    models.push(JSON.parse(options.body).model);
    return { ok: false, status: 400, text: async () => 'model has been decommissioned' };
  };
  try {
    await assert.rejects(AI.generateWithGroqFallback('groq-test', 'hi'), error => error.message.includes('openai/gpt-oss-20b') && error.message.includes('llama-3.3-70b-versatile'));
    assert.equal(models.length, 3);
    assert.ok(!models.includes('mixtral-8x7b-32768'));
  } finally { global.fetch = original; }
});
test('Top Tools is tried first with configured keys; sharing off blocks network', async () => {
  const original = global.fetch;
  const calls = [];
  global.fetch = async url => { calls.push(url); return ok('cloud reply'); };
  const keys = { topToolsApiKey: 'top-test', geminiApiKey: 'gemini-test', groqApiKey: 'groq-test' };
  try {
    assert.equal(await AI.generateWithProviderFallback(keys, 'hi'), 'cloud reply');
    assert.equal(AI.getLastProviderUsed(), 'toptools');
    assert.deepEqual(calls, ['https://top-tools-ai.com/api/v1/chat/completions']);
    sharing = false;
    await assert.rejects(AI.generateWithProviderFallback(keys, 'hi'), /Enable AI data sharing/);
    assert.equal(calls.length, 1);
  } finally { sharing = true; global.fetch = original; }
});
