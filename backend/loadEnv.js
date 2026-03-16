const fs = require('fs');

function stripWrappingQuotes(value) {
    if (!value) return value;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        return value.slice(1, -1);
    }
    return value;
}

function loadEnv(filePath) {
    if (!fs.existsSync(filePath)) {
        return;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const separatorIndex = trimmed.indexOf('=');
        if (separatorIndex < 1) continue;

        const key = trimmed.slice(0, separatorIndex).trim();
        const value = stripWrappingQuotes(trimmed.slice(separatorIndex + 1).trim());
        if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
            process.env[key] = value;
        }
    }
}

module.exports = { loadEnv };
