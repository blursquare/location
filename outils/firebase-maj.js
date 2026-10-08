#!/usr/bin/env node
/*
 * Mise à jour de la base Firebase de l'outil de gestion locative, en ligne de commande.
 * Sert à Claude pour reporter dans la base les données lues dans vos documents.
 *
 * Variables d'environnement :
 *   FIREBASE_CONFIG   chemin d'un fichier contenant le bloc firebaseConfig (ou ce bloc lui-même)
 *   FIREBASE_EMAIL    compte Firebase autorisé (ex. le compte dédié à Claude)
 *   FIREBASE_MDP      son mot de passe
 *   FIREBASE_BASE     nom de la base (défaut : principal)
 *   FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST   tests sur émulateurs (facultatif)
 *
 * Commandes :
 *   lire [fichier.json]          affiche un résumé ; enregistre les données si un fichier est donné
 *   fusionner operations.json    ajoute charges et encaissements (sans doublon, voir README)
 *   remplacer donnees.json       remplace toutes les données (nécessite --oui)
 *   modifier script.js           exécute script.js(donnees, outils) puis enregistre le résultat
 *   historique                   liste les dernières versions
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Calc = require('../assets/calc.js');
const { lireConfig } = require('../assets/cloud.js');

// ---------- Conversion Firestore REST ----------
function versChamps(c) {
  return {
    json: { stringValue: c.json },
    version: { integerValue: String(c.version) },
    majPar: { stringValue: c.majPar || '' },
  };
}
function depuisDocument(doc) {
  const f = doc.fields || {};
  return {
    json: f.json ? f.json.stringValue : null,
    version: f.version ? Number(f.version.integerValue) : 0,
    majPar: f.majPar ? f.majPar.stringValue : '',
    majLe: f.majLe ? f.majLe.timestampValue : null,
    updateTime: doc.updateTime,
  };
}

function resume(d) {
  const n = (x) => (Array.isArray(x) ? x.length : 0);
  return `${n(d.proprietaires)} propriétaire(s), ${n(d.biens)} bien(s), ${n(d.baux)} bail(s), ${n(d.paiements)} encaissement(s), ${n(d.charges)} charge(s), ${n(d.decomptes)} décompte(s), ${n(d.prets)} prêt(s)`;
}

// ---------- Client ----------
function client(env = process.env) {
  if (!env.FIREBASE_CONFIG) throw new Error('FIREBASE_CONFIG manquant');
  const brut = fs.existsSync(env.FIREBASE_CONFIG) ? fs.readFileSync(env.FIREBASE_CONFIG, 'utf8') : env.FIREBASE_CONFIG;
  const config = lireConfig(brut);
  const base = env.FIREBASE_BASE || 'principal';
  const authHote = env.FIREBASE_AUTH_EMULATOR_HOST ? `http://${env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com` : 'https://identitytoolkit.googleapis.com';
  const fsHote = env.FIRESTORE_EMULATOR_HOST ? `http://${env.FIRESTORE_EMULATOR_HOST}/v1` : 'https://firestore.googleapis.com/v1';
  const racine = `projects/${config.projectId}/databases/(default)/documents`;
  const nomDoc = `${racine}/gestion/${base}`;
  let jeton = null;
  let email = null;

  async function requete(url, options = {}) {
    const r = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}), ...(options.headers || {}) } });
    const texte = await r.text();
    const corps = texte ? JSON.parse(texte) : {};
    if (!r.ok) {
      const e = new Error((corps.error && corps.error.message) || `HTTP ${r.status}`);
      e.status = r.status;
      e.code = corps.error && corps.error.status;
      throw e;
    }
    return corps;
  }

  async function connexion() {
    if (!env.FIREBASE_EMAIL || !env.FIREBASE_MDP) throw new Error('FIREBASE_EMAIL et FIREBASE_MDP sont nécessaires');
    const r = await requete(`${authHote}/v1/accounts:signInWithPassword?key=${encodeURIComponent(config.apiKey)}`, {
      method: 'POST',
      body: JSON.stringify({ email: env.FIREBASE_EMAIL, password: env.FIREBASE_MDP, returnSecureToken: true }),
    }).catch((e) => {
      const m = String(e.message);
      if (/INVALID_PASSWORD|INVALID_LOGIN_CREDENTIALS|EMAIL_NOT_FOUND/.test(m)) throw new Error(`connexion refusée pour ${env.FIREBASE_EMAIL} : e-mail ou mot de passe incorrect`);
      if (/API key not valid/.test(m)) throw new Error('clé API invalide : vérifiez FIREBASE_CONFIG');
      if (/OPERATION_NOT_ALLOWED|PASSWORD_LOGIN_DISABLED/.test(m)) throw new Error('la connexion par e-mail et mot de passe n’est pas activée dans Firebase');
      throw e;
    });
    jeton = r.idToken;
    email = r.email;
    return { email, uid: r.localId };
  }

  async function lire() {
    try {
      return depuisDocument(await requete(`${fsHote}/${nomDoc}`));
    } catch (e) {
      if (e.status === 404) return null;
      if (e.status === 403) throw new Error(`lecture refusée : le compte ${email} n'est pas autorisé dans les règles Firestore`);
      throw e;
    }
  }

  /** Écrit les données en version+1, à condition que la base n'ait pas changé depuis `actuel`. */
  async function ecrire(donnees, actuel) {
    const version = (actuel ? actuel.version : 0) + 1;
    const contenu = { json: JSON.stringify(donnees), version, majPar: email };
    const transformation = [{ fieldPath: 'majLe', setToServerValue: 'REQUEST_TIME' }];
    await requete(`${fsHote}/${racine}:commit`, {
      method: 'POST',
      body: JSON.stringify({
        writes: [
          { update: { name: nomDoc, fields: versChamps(contenu) }, updateTransforms: transformation, currentDocument: actuel ? { updateTime: actuel.updateTime } : { exists: false } },
          { update: { name: `${nomDoc}/historique/${String(version).padStart(6, '0')}`, fields: versChamps(contenu) }, updateTransforms: transformation, currentDocument: { exists: false } },
        ],
      }),
    }).catch((e) => {
      if (e.code === 'FAILED_PRECONDITION' || e.code === 'ALREADY_EXISTS') throw new Error('la base a été modifiée entre-temps : relancez la commande');
      if (e.code === 'PERMISSION_DENIED') throw new Error(`écriture refusée : le compte ${email} n'est pas autorisé dans les règles Firestore`);
      throw e;
    });
    return version;
  }

  async function historique(n = 10) {
    const r = await requete(`${fsHote}/${nomDoc}/historique?pageSize=200`);
    return (r.documents || [])
      .map(depuisDocument)
      .sort((a, b) => b.version - a.version)
      .slice(0, n);
  }

  return { config, base, connexion, lire, ecrire, historique };
}

// ---------- Ligne de commande ----------
async function principal(argv) {
  const [commande, fichier] = argv.filter((a) => !a.startsWith('--'));
  const oui = argv.includes('--oui');
  if (!commande || !['lire', 'fusionner', 'remplacer', 'modifier', 'historique'].includes(commande)) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 21).join('\n').replace(/^ \* ?/gm, ''));
    return 1;
  }
  const c = client();
  const { email } = await c.connexion();
  console.log(`Connecté à ${c.config.projectId} (base « ${c.base} ») en tant que ${email}.`);
  const actuel = await c.lire();
  const donnees = actuel && actuel.json ? JSON.parse(actuel.json) : null;
  if (commande === 'lire') {
    if (!donnees) return console.log('La base est vide.'), 0;
    console.log(`Version ${actuel.version}, modifiée par ${actuel.majPar || '?'} le ${actuel.majLe || '?'} : ${resume(donnees)}.`);
    if (fichier) fs.writeFileSync(fichier, JSON.stringify(donnees, null, 1)), console.log(`Données enregistrées dans ${fichier}.`);
    return 0;
  }
  if (commande === 'historique') {
    for (const v of await c.historique()) console.log(`v${v.version}  ${v.majLe || ''}  ${v.majPar}  ${resume(JSON.parse(v.json))}`);
    return 0;
  }
  if (!fichier) throw new Error(`indiquez le fichier pour « ${commande} »`);
  let nouvelles;
  if (commande === 'fusionner') {
    if (!donnees) throw new Error('la base est vide : utilisez « remplacer » pour l’initialiser');
    const ops = JSON.parse(fs.readFileSync(fichier, 'utf8'));
    let n = 0;
    const r = Calc.fusionnerOperations(Calc.migrer(donnees), ops, () => `cl-${Date.now().toString(36)}-${(n++).toString(36)}`);
    console.log(`${r.ajouts.charges} charge(s) et ${r.ajouts.paiements} encaissement(s) ajoutés, ${r.ignores} déjà présent(s).`);
    for (const e of r.erreurs) console.log(`  ⚠ ${e}`);
    if (!r.ajouts.charges && !r.ajouts.paiements) return console.log('Rien à enregistrer.'), r.erreurs.length ? 2 : 0;
    nouvelles = r.data;
  } else if (commande === 'remplacer') {
    nouvelles = Calc.migrer(JSON.parse(fs.readFileSync(fichier, 'utf8')));
    if (!Array.isArray(nouvelles.biens)) throw new Error('fichier non reconnu (liste « biens » absente)');
    if (donnees && !oui) throw new Error(`la base contient déjà des données (${resume(donnees)}) : ajoutez --oui pour les remplacer`);
  } else {
    if (!donnees) throw new Error('la base est vide');
    const script = require(path.resolve(fichier));
    nouvelles = Calc.migrer((await script(JSON.parse(JSON.stringify(donnees)), { Calc })) || donnees);
  }
  const v = await c.ecrire(nouvelles, actuel);
  console.log(`Base enregistrée en version ${v} : ${resume(nouvelles)}.`);
  return 0;
}

if (require.main === module) {
  principal(process.argv.slice(2))
    .then((code) => process.exit(code || 0))
    .catch((e) => {
      console.error(`Erreur : ${e.message}`);
      process.exit(1);
    });
}
module.exports = { client, versChamps, depuisDocument, principal };
