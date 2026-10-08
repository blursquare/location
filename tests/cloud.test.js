const test = require('node:test');
const assert = require('node:assert/strict');
const { lireConfig } = require('../assets/cloud.js');
const { versChamps, depuisDocument } = require('../outils/firebase-maj.js');

test('configuration Firebase collée depuis la console', () => {
  const extrait = `// Import the functions you need
const firebaseConfig = {
  apiKey: "AIzaSyB-exemple_123",
  authDomain: "gestion-locative-abc.firebaseapp.com",
  projectId: "gestion-locative-abc",
  storageBucket: 'gestion-locative-abc.appspot.com',
  messagingSenderId: "1234",
  appId: "1:1234:web:abcd", // commentaire
};`;
  assert.deepEqual(lireConfig(extrait), { apiKey: 'AIzaSyB-exemple_123', authDomain: 'gestion-locative-abc.firebaseapp.com', projectId: 'gestion-locative-abc', appId: '1:1234:web:abcd' });
  assert.equal(lireConfig('{"apiKey":"k","projectId":"p"}').authDomain, 'p.firebaseapp.com');
  assert.throws(() => lireConfig('bonjour'), /introuvable/);
  assert.throws(() => lireConfig('{ apiKey: "k" }'), /projectId/);
});

test('conversion des documents Firestore REST', () => {
  const champs = versChamps({ json: '{"biens":[]}', version: 7, majPar: 'claude@exemple.fr' });
  assert.deepEqual(champs.version, { integerValue: '7' });
  const d = depuisDocument({ fields: { ...champs, majLe: { timestampValue: '2026-10-08T05:00:00Z' } }, updateTime: 'T' });
  assert.deepEqual(d, { json: '{"biens":[]}', version: 7, majPar: 'claude@exemple.fr', majLe: '2026-10-08T05:00:00Z', updateTime: 'T' });
});
