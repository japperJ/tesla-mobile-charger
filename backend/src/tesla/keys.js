/**
 * EC P-256 key management for Tesla Fleet API partner registration.
 * Keys are generated once and persisted in the SQLite config table.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function getOrCreateKeys() {
  const { getConfigValue, setConfigValue } = require('../db/config');

  let privateKeyPem = getConfigValue('ec_private_key');
  let publicKeyPem  = getConfigValue('ec_public_key');

  if (!privateKeyPem || !publicKeyPem) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      publicKeyEncoding:  { type: 'spki',  format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    privateKeyPem = privateKey;
    publicKeyPem  = publicKey;
    setConfigValue('ec_private_key', privateKeyPem);
    setConfigValue('ec_public_key',  publicKeyPem);
    console.log('Generated new EC P-256 key pair for Tesla Fleet API');
  }

  return { privateKeyPem, publicKeyPem };
}

function getPublicKeyPem() {
  return getOrCreateKeys().publicKeyPem;
}

/**
 * Write the EC private key to a PEM file so the Vehicle Command Proxy can use it.
 * Called on backend startup; file is on the shared ./data volume.
 */
function exportPrivateKeyFile() {
  const { privateKeyPem } = getOrCreateKeys();
  const dbPath = process.env.DB_PATH || '/app/data/charger.db';
  const keyPath = path.join(path.dirname(dbPath), 'ec_private_key.pem');
  fs.writeFileSync(keyPath, privateKeyPem, { mode: 0o600 });
  console.log(`EC private key exported to ${keyPath}`);
  return keyPath;
}

module.exports = { getOrCreateKeys, getPublicKeyPem, exportPrivateKeyFile };
