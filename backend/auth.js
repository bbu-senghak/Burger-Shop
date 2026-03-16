const crypto = require('crypto');

const HASH_PREFIX = 'scrypt';

function base64UrlEncode(value) {
    return Buffer.from(value)
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

function base64UrlDecode(value) {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    const padLength = (4 - (padded.length % 4)) % 4;
    return Buffer.from(`${padded}${'='.repeat(padLength)}`, 'base64').toString('utf8');
}

function isPasswordHashed(password) {
    return typeof password === 'string' && password.startsWith(`${HASH_PREFIX}$`);
}

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const key = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${HASH_PREFIX}$${salt}$${key}`;
}

function verifyPassword(password, storedHash) {
    if (!storedHash || typeof storedHash !== 'string') return false;
    if (!isPasswordHashed(storedHash)) return password === storedHash;

    const parts = storedHash.split('$');
    if (parts.length !== 3) return false;
    const [, salt, expectedKey] = parts;

    const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
    const derivedBuffer = Buffer.from(derivedKey, 'hex');
    const expectedBuffer = Buffer.from(expectedKey, 'hex');
    if (derivedBuffer.length !== expectedBuffer.length) return false;
    return crypto.timingSafeEqual(derivedBuffer, expectedBuffer);
}

function signJwt(payload, secret, ttlSeconds = 28800) {
    const header = { alg: 'HS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const body = { ...payload, iat: now, exp: now + ttlSeconds };

    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedBody = base64UrlEncode(JSON.stringify(body));
    const unsignedToken = `${encodedHeader}.${encodedBody}`;
    const signature = crypto.createHmac('sha256', secret).update(unsignedToken).digest('base64url');
    return `${unsignedToken}.${signature}`;
}

function verifyJwt(token, secret) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [encodedHeader, encodedBody, signature] = parts;
    const unsignedToken = `${encodedHeader}.${encodedBody}`;
    const expectedSignature = crypto.createHmac('sha256', secret).update(unsignedToken).digest('base64url');

    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);
    if (signatureBuffer.length !== expectedBuffer.length) return null;
    if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) return null;

    try {
        const payload = JSON.parse(base64UrlDecode(encodedBody));
        const now = Math.floor(Date.now() / 1000);
        if (!payload.exp || payload.exp <= now) return null;
        return payload;
    } catch (_err) {
        return null;
    }
}

module.exports = {
    hashPassword,
    verifyPassword,
    signJwt,
    verifyJwt,
    isPasswordHashed
};
