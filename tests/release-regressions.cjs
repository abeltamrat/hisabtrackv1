const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
test('EAS owns Android release signing without a conflicting config plugin',()=>{
 const app=JSON.parse(fs.readFileSync(path.join(__dirname,'..','app.json'),'utf8'));
 const plugins=app.expo.plugins || [];
 assert.equal(plugins.some(plugin => {
  const name=Array.isArray(plugin) ? plugin[0] : plugin;
  return String(name).includes('withReleaseSigning');
 }),false);
});
