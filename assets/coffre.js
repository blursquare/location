/*
 * Coffre : chiffrement des données par mot de passe (Web Crypto).
 * Clé dérivée par PBKDF2-SHA256 (sel aléatoire), chiffrement AES-GCM 256 bits
 * avec un vecteur d'initialisation neuf à chaque enregistrement.
 * Sans le mot de passe, les données sont illisibles ; il n'existe aucun moyen de le récupérer.
 */
(function (root) {
  'use strict';
  const ITERATIONS = 310000;
  const subtle = () => (root.crypto || globalThis.crypto).subtle;
  const rand = (n) => (root.crypto || globalThis.crypto).getRandomValues(new Uint8Array(n));

  const toB64 = (bytes) => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

  /** Dérive une clé AES depuis le mot de passe. sel : base64 (nouveau sel si absent). */
  async function deriverCle(motDePasse, sel, iterations = ITERATIONS) {
    const salt = sel ? fromB64(sel) : rand(16);
    const base = await subtle().importKey('raw', new TextEncoder().encode(motDePasse), 'PBKDF2', false, ['deriveKey']);
    const cle = await subtle().deriveKey(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
    return { cle, sel: toB64(salt), iterations };
  }

  /** Chiffre un objet JSON. Retourne une enveloppe sérialisable. */
  async function chiffrer(c, objet) {
    const iv = rand(12);
    const data = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, c.cle, new TextEncoder().encode(JSON.stringify(objet))));
    return { format: 'gestion-locative-chiffre', v: 1, kdf: 'PBKDF2-SHA256', iterations: c.iterations, sel: c.sel, iv: toB64(iv), data: toB64(data) };
  }

  /** Déchiffre une enveloppe. Lève une erreur si le mot de passe est faux. */
  async function dechiffrer(c, env) {
    try {
      const buf = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(env.iv) }, c.cle, fromB64(env.data));
      return JSON.parse(new TextDecoder().decode(buf));
    } catch (e) {
      throw new Error('Mot de passe incorrect.');
    }
  }

  /** Ouvre une enveloppe avec un mot de passe (dérive la clé avec le sel de l'enveloppe). */
  async function ouvrir(motDePasse, env) {
    const c = await deriverCle(motDePasse, env.sel, env.iterations || ITERATIONS);
    return { cle: c, donnees: await dechiffrer(c, env) };
  }

  /*
   * Lien d'import : données JSON compressées (gzip) en base64url, placées après « #import= ».
   * La partie après « # » n'est jamais envoyée au serveur qui héberge l'outil.
   */
  async function encoderLien(objet) {
    const flux = new Blob([JSON.stringify(objet)]).stream().pipeThrough(new CompressionStream('gzip'));
    const octets = new Uint8Array(await new Response(flux).arrayBuffer());
    return toB64(octets).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  async function decoderLien(texte) {
    const b64 = String(texte || '').trim().replace(/-/g, '+').replace(/_/g, '/');
    let octets;
    try {
      octets = fromB64(b64 + '==='.slice((b64.length + 3) % 4));
    } catch (e) {
      throw new Error('lien incomplet ou abîmé');
    }
    try {
      if (typeof DecompressionStream === 'undefined' && root.document) {
        // Navigateurs anciens : décompression par pako, chargé à la demande.
        if (!root.pako) {
          await new Promise((ok, ko) => {
            const sc = root.document.createElement('script');
            sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako_inflate.min.js';
            sc.onload = ok;
            sc.onerror = () => ko(new Error('décompression indisponible'));
            root.document.head.appendChild(sc);
          });
        }
        return JSON.parse(root.pako.ungzip(octets, { to: 'string' }));
      }
      const flux = new Blob([octets]).stream().pipeThrough(new DecompressionStream('gzip'));
      return JSON.parse(await new Response(flux).text());
    } catch (e) {
      throw new Error('lien incomplet ou abîmé');
    }
  }

  const estEnveloppe = (x) => !!x && x.format === 'gestion-locative-chiffre' && typeof x.data === 'string';

  const api = { deriverCle, chiffrer, dechiffrer, ouvrir, estEnveloppe, encoderLien, decoderLien };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Coffre = api;
})(typeof window !== 'undefined' ? window : globalThis);
