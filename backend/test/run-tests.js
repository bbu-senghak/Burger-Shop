const assert = require('node:assert/strict');
const { hashPassword, verifyPassword, signJwt, verifyJwt, isPasswordHashed } = require('../auth');

function testHashPassword() {
    const plain = 'my-secret-password';
    const hash = hashPassword(plain);
    assert.equal(isPasswordHashed(hash), true);
    assert.equal(verifyPassword(plain, hash), true);
    assert.equal(verifyPassword('wrong-password', hash), false);
}

function testPlaintextFallback() {
    assert.equal(verifyPassword('abc123', 'abc123'), true);
    assert.equal(verifyPassword('abc124', 'abc123'), false);
}

function testJwtRoundtrip() {
    const secret = 'test-secret';
    const token = signJwt({ sub: '1', role: 'admin' }, secret, 60);
    const payload = verifyJwt(token, secret);
    assert.ok(payload);
    assert.equal(payload.sub, '1');
    assert.equal(payload.role, 'admin');
}

function testJwtExpiry() {
    const secret = 'test-secret';
    const token = signJwt({ sub: '1', role: 'staff' }, secret, -1);
    const payload = verifyJwt(token, secret);
    assert.equal(payload, null);
}

function run() {
    testHashPassword();
    testPlaintextFallback();
    testJwtRoundtrip();
    testJwtExpiry();
    console.log('All tests passed.');
}

run();
