const test=require('node:test');
const assert=require('node:assert/strict');
const {configureReleaseSigning}=require('../plugins/withReleaseSigning');
test('prebuild release signing replaces debug fallback and is idempotent',()=>{
 const input='android { buildTypes { release { signingConfig signingConfigs.debug } } }';
 const output=configureReleaseSigning(input);
 assert.match(output,/android.buildTypes.release.signingConfig = hisabSigning/);
 assert.match(output,/Missing release signing environment variable/);
 assert.equal(configureReleaseSigning(output),output);
});
