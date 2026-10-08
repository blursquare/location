/*
 * Synchronisation avec une base Firebase (Firestore), facultative.
 * Toutes les données tiennent dans un document « gestion/{base} » :
 *   { json: <données sérialisées>, version: n, majPar: <e-mail>, majLe: <horodatage serveur> }
 * Chaque écriture passe la version de n à n+1 dans une transaction (contrôlée aussi par les
 * règles Firestore) et laisse une copie dans « gestion/{base}/historique/{n} ».
 * Accès réservé aux comptes autorisés par les règles (voir firestore.rules).
 */
(function (root) {
  'use strict';
  const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
  const NOM_APP = 'gestion-locative';

  /**
   * Lit la configuration Firebase collée par l'utilisateur : objet JSON, ou extrait de code
   * « const firebaseConfig = { apiKey: "…", … }; » tel que fourni par la console Firebase.
   */
  function lireConfig(texte) {
    if (texte && typeof texte === 'object') return valider(texte);
    const t = String(texte || '');
    const debut = t.indexOf('{');
    const fin = t.lastIndexOf('}');
    if (debut < 0 || fin < debut) throw new Error('configuration introuvable (attendu : { apiKey: …, projectId: … })');
    const corps = t
      .slice(debut, fin + 1)
      .replace(/\/\/[^\n]*/g, '')
      .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
      .replace(/'([^'\\]*)'/g, '"$1"')
      .replace(/,\s*}/g, '}');
    let objet;
    try {
      objet = JSON.parse(corps);
    } catch (e) {
      throw new Error('configuration illisible : collez le bloc « firebaseConfig » tel quel');
    }
    return valider(objet);
  }
  function valider(c) {
    if (!c.apiKey || !c.projectId) throw new Error('la configuration doit contenir apiKey et projectId');
    const r = { apiKey: c.apiKey, projectId: c.projectId, authDomain: c.authDomain || `${c.projectId}.firebaseapp.com` };
    if (c.appId) r.appId = c.appId;
    if (c.emulateur) r.emulateur = c.emulateur;
    return r;
  }

  // ---------- Navigateur (SDK Firebase « compat », chargé à la demande) ----------
  const scripts = {};
  function charger(src) {
    if (!scripts[src]) {
      scripts[src] = new Promise((ok, ko) => {
        const s = root.document.createElement('script');
        s.src = src;
        s.onload = ok;
        s.onerror = () => {
          delete scripts[src];
          ko(new Error('chargement de Firebase impossible (connexion internet ?)'));
        };
        root.document.head.appendChild(s);
      });
    }
    return scripts[src];
  }

  let app = null;
  let auth = null;
  let fs = null;

  async function init(config) {
    await charger(SDK + 'firebase-app-compat.js');
    await Promise.all([charger(SDK + 'firebase-auth-compat.js'), charger(SDK + 'firebase-firestore-compat.js')]);
    const fb = root.firebase;
    const existant = fb.apps.find((a) => a.name === NOM_APP);
    if (existant && existant.options.projectId !== config.projectId) await existant.delete();
    app = fb.apps.find((a) => a.name === NOM_APP) || fb.initializeApp(config, NOM_APP);
    auth = app.auth();
    fs = app.firestore();
    if (config.emulateur && !init.emule) {
      // Tests uniquement : émulateurs Firebase locaux.
      auth.useEmulator(`http://${config.emulateur.auth}`);
      const [h, p] = config.emulateur.firestore.split(':');
      fs.useEmulator(h, Number(p));
      init.emule = true;
    }
  }

  const surUtilisateur = (cb) => auth.onAuthStateChanged(cb);
  const utilisateur = () => (auth && auth.currentUser) || null;

  async function connexion(email, motDePasse) {
    try {
      await auth.signInWithEmailAndPassword(email, motDePasse);
    } catch (e) {
      const messages = {
        'auth/invalid-credential': 'e-mail ou mot de passe incorrect',
        'auth/wrong-password': 'mot de passe incorrect',
        'auth/user-not-found': 'compte inconnu',
        'auth/invalid-email': 'adresse e-mail invalide',
        'auth/too-many-requests': 'trop de tentatives, réessayez plus tard',
        'auth/network-request-failed': 'pas de connexion internet',
        'auth/operation-not-allowed': 'la connexion par e-mail n’est pas activée dans Firebase (Authentication → Méthode de connexion)',
      };
      throw new Error(messages[e.code] || e.message);
    }
  }
  const deconnexion = () => auth.signOut();

  const refBase = (base) => fs.collection('gestion').doc(base);
  const lireDoc = (snap) => {
    if (!snap.exists) return null;
    const d = snap.data();
    return { json: d.json, version: d.version, majPar: d.majPar || '', majLe: d.majLe && d.majLe.toDate ? d.majLe.toDate() : null };
  };

  /** Écoute la base en temps réel. cb(null) si la base n'existe pas encore. Retourne la fonction d'arrêt. */
  function ecouter(base, cb, erreur) {
    return refBase(base).onSnapshot(
      (snap) => {
        if (snap.metadata.hasPendingWrites) return;
        cb(lireDoc(snap));
      },
      (e) => erreur && erreur(e.code === 'permission-denied' ? new Error('accès refusé : ce compte n’est pas autorisé dans les règles Firestore') : e)
    );
  }

  /**
   * Enregistre les données. versionBase : version sur laquelle les modifications ont été faites
   * (null pour forcer). Si la base a changé entre-temps, lève une erreur portant .conflit (la version distante).
   */
  async function ecrire(base, donnees, versionBase) {
    const ref = refBase(base);
    const json = JSON.stringify(donnees);
    try {
      return await fs.runTransaction(async (t) => {
        const snap = await t.get(ref);
        const actuel = lireDoc(snap);
        const v = actuel ? actuel.version : 0;
        if (versionBase !== null && versionBase !== undefined && v !== versionBase) {
          const e = new Error('modifiée ailleurs');
          e.conflit = actuel;
          throw e;
        }
        const contenu = { json, version: v + 1, majPar: auth.currentUser.email || '', majLe: root.firebase.firestore.FieldValue.serverTimestamp() };
        t.set(ref, contenu);
        t.set(ref.collection('historique').doc(String(v + 1).padStart(6, '0')), contenu);
        return v + 1;
      });
    } catch (e) {
      if (e.conflit) throw e;
      if (e.code === 'permission-denied') throw new Error('écriture refusée par les règles Firestore');
      throw e;
    }
  }

  const api = { lireConfig, init, surUtilisateur, utilisateur, connexion, deconnexion, ecouter, ecrire };
  if (typeof module !== 'undefined' && module.exports) module.exports = { lireConfig };
  else root.Cloud = api;
})(typeof window !== 'undefined' ? window : globalThis);
