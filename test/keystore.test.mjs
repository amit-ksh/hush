import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { resolveKey, maskKey, validateKey, statusLine, isAllowedExternal, REGISTER_URL } = require('../src/main/keylogic.cjs');

// precedence: session > saved > env > none
assert.deepEqual(resolveKey({ session: 'S-key-123456', saved: 'saved-key-1', env: 'env-key-1' }), { key: 'S-key-123456', source: 'session' });
assert.deepEqual(resolveKey({ session: '', saved: 'saved-key-1', env: 'env-key-1' }), { key: 'saved-key-1', source: 'saved' });
assert.deepEqual(resolveKey({ session: '   ', saved: null, env: 'env-key-1' }), { key: 'env-key-1', source: 'env' });
assert.deepEqual(resolveKey({ env: '  padded-key  ' }), { key: 'padded-key', source: 'env' });
assert.deepEqual(resolveKey({}), { key: '', source: 'none' });
assert.deepEqual(resolveKey(), { key: '', source: 'none' });
assert.deepEqual(resolveKey({ session: 42, saved: undefined, env: undefined }), { key: '', source: 'none' });

// masking: last 4 only for long keys, nothing for short ones, never the whole key
const k = 'abcdEFGH12345678wxyz';
const m = maskKey(k);
assert.equal(m, '\u2022\u2022\u2022\u2022wxyz');
assert.ok(!m.includes('abcdEFGH'));
assert.equal(maskKey('short'), '\u2022\u2022\u2022\u2022');
assert.equal(maskKey(''), ''); assert.equal(maskKey(null), ''); assert.equal(maskKey(undefined), '');
assert.equal(maskKey('  ' + k + '  '), m, 'trims before masking');

// validation
assert.equal(validateKey('abcdefgh').ok, true);
assert.equal(validateKey('  abcdefgh  ').key, 'abcdefgh');
assert.equal(validateKey('short').ok, false);
assert.equal(validateKey('has space inside').ok, false);
assert.equal(validateKey('x'.repeat(300)).ok, false);
assert.equal(validateKey(null).ok, false);

// status text
assert.equal(statusLine('saved'), 'Using saved key');
assert.equal(statusLine('env'), 'Using the configured key');
assert.equal(statusLine('none'), 'No key: simulation only');
assert.ok(statusLine('session').includes('session'));

// external link allow-list
assert.ok(isAllowedExternal(REGISTER_URL));
assert.ok(isAllowedExternal('https://physiology.presagetech.com/'));
for (const bad of ['http://physiology.presagetech.com/auth/register', 'https://physiology.presagetech.com.evil.com/', 'https://evil.com/physiology.presagetech.com',
  'https://user@physiology.presagetech.com@evil.com/', 'https://user:pw@physiology.presagetech.com/', 'file:///C:/Windows/System32/calc.exe', 'javascript:alert(1)', 'not a url', '', 'https://physiology.presagetech.com:8443/x']) {
  assert.equal(isAllowedExternal(bad), false, `should reject ${bad}`);
}

console.log('keystore OK: precedence (session>saved>env>none), masking, validation, status text, external-link allow-list');
