const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../assets/coffre.js');

test('chiffrement / déchiffrement par mot de passe', async () => {
  const c = await K.deriverCle('secret-123', null, 1000);
  const donnees = { biens: [{ id: 'x', nom: 'T2 Croix-Rousse' }], montant: 420.5 };
  const env = await K.chiffrer(c, donnees);
  assert.ok(K.estEnveloppe(env));
  assert.ok(!JSON.stringify(env).includes('Croix'));
  const env2 = await K.chiffrer(c, donnees);
  assert.notEqual(env.iv, env2.iv); // IV neuf à chaque enregistrement
  const o = await K.ouvrir('secret-123', env);
  assert.deepEqual(o.donnees, donnees);
  // la clé retrouvée permet de continuer à chiffrer avec le même sel
  assert.deepEqual(await K.dechiffrer(o.cle, await K.chiffrer(o.cle, { a: 1 })), { a: 1 });
});

test('mauvais mot de passe refusé', async () => {
  const c = await K.deriverCle('bon', null, 1000);
  const env = await K.chiffrer(c, { a: 1 });
  await assert.rejects(K.ouvrir('mauvais', env), /incorrect/);
});

test("lien d'import : aller-retour compressé", async () => {
  const donnees = { biens: [{ id: 'x', nom: 'Terre des Rois B01 — é' }], paiements: Array.from({ length: 50 }, (_, i) => ({ montant: i })) };
  const code = await K.encoderLien(donnees);
  assert.match(code, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(await K.decoderLien(code), donnees);
  await assert.rejects(K.decoderLien(code.slice(0, 20)), /abîmé/);
});
