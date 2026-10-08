/*
 * Récupération des PDF joints aux e-mails Gmail, directement depuis le navigateur.
 * - Authentification Google Identity Services (jeton d'accès, lecture seule).
 * - Lecture du texte des PDF avec pdf.js, puis extraction des montants (Extract).
 * Aucune donnée ne transite par un serveur tiers : le navigateur parle directement à Google.
 */
(function () {
  'use strict';
  const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
  const GIS_SRC = 'https://accounts.google.com/gsi/client';
  const PDFJS_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
  const MAX_MESSAGES = 60;
  const MAX_PAGES_PDF = 6;

  const scripts = {};
  function loadScript(src) {
    if (!scripts[src]) {
      scripts[src] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = resolve;
        s.onerror = () => {
          delete scripts[src];
          reject(new Error(`Chargement impossible : ${src}`));
        };
        document.head.appendChild(s);
      });
    }
    return scripts[src];
  }

  let token = null;
  let tokenExpire = 0;
  let tokenClient = null;
  let tokenClientId = null;

  async function connecter(clientId) {
    if (!clientId) throw new Error("Renseignez d'abord l'identifiant client Google.");
    if (token && Date.now() < tokenExpire - 60000) return token;
    await loadScript(GIS_SRC);
    return new Promise((resolve, reject) => {
      const callback = (resp) => {
        if (resp.error) return reject(new Error(`Connexion Google refusée : ${resp.error_description || resp.error}`));
        token = resp.access_token;
        tokenExpire = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
        resolve(token);
      };
      if (!tokenClient || tokenClientId !== clientId) {
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: SCOPE,
          callback,
          error_callback: (e) => reject(new Error(e.type === 'popup_closed' ? 'Fenêtre de connexion fermée.' : `Connexion Google impossible (${e.type || e.message}).`)),
        });
        tokenClientId = clientId;
      } else {
        tokenClient.callback = callback;
      }
      tokenClient.requestAccessToken({ prompt: token ? '' : 'consent' });
    });
  }

  function deconnecter() {
    if (token && window.google && google.accounts) google.accounts.oauth2.revoke(token, () => {});
    token = null;
    tokenExpire = 0;
  }

  const estConnecte = () => !!token && Date.now() < tokenExpire - 60000;

  async function api(path, params) {
    const url = new URL(API + path);
    for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== '') url.searchParams.set(k, v);
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 401) {
      token = null;
      throw new Error('Session Google expirée, reconnectez-vous.');
    }
    if (!r.ok) {
      let msg = r.statusText;
      try {
        msg = (await r.json()).error.message;
      } catch (_) {
        /* corps non JSON */
      }
      throw new Error(`Gmail : ${msg} (${r.status})`);
    }
    return r.json();
  }

  function b64urlToBytes(data) {
    const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function piecesPdf(part, out = []) {
    if (!part) return out;
    const nom = part.filename || '';
    if (part.body && part.body.attachmentId && (/\.pdf$/i.test(nom) || part.mimeType === 'application/pdf')) {
      out.push({ nom: nom || 'document.pdf', attachmentId: part.body.attachmentId });
    }
    for (const p of part.parts || []) piecesPdf(p, out);
    return out;
  }
  const entete = (msg, nom) => ((msg.payload.headers || []).find((h) => h.name.toLowerCase() === nom) || {}).value || '';

  async function textePdf(bytes) {
    await loadScript(PDFJS_SRC);
    const lib = window.pdfjsLib;
    lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    const doc = await lib.getDocument({ data: bytes.slice() }).promise;
    const pages = [];
    for (let i = 1; i <= Math.min(doc.numPages, MAX_PAGES_PDF); i++) {
      const page = await doc.getPage(i);
      pages.push(Extract.lignesPdfJs((await page.getTextContent()).items));
    }
    return pages.join('\n');
  }

  const source = (messageId, nom) => `gmail:${messageId}:${nom}`;

  /**
   * Cherche les e-mails d'une règle et analyse leurs PDF.
   * regle : { requete, type ('appel' | 'gerance' | 'auto'), depuis (AAAA-MM-JJ) }
   * dejaImportes : Set des sources déjà présentes (ces PDF ne sont pas retéléchargés).
   */
  async function chercher(regle, dejaImportes, onProgress = () => {}) {
    let q = `${regle.requete || ''} has:attachment filename:pdf`.trim();
    if (regle.depuis) q += ` after:${regle.depuis.replace(/-/g, '/')}`;
    const ids = [];
    let pageToken;
    do {
      const r = await api('/messages', { q, maxResults: 50, pageToken });
      ids.push(...(r.messages || []).map((m) => m.id));
      pageToken = r.nextPageToken;
    } while (pageToken && ids.length < MAX_MESSAGES);
    onProgress(`${ids.length} e-mail(s) trouvé(s) pour « ${regle.nom || regle.requete} »`);

    const resultats = [];
    let deja = 0;
    for (const [i, id] of ids.slice(0, MAX_MESSAGES).entries()) {
      const msg = await api(`/messages/${id}`, { format: 'full' });
      for (const piece of piecesPdf(msg.payload)) {
        const src = source(id, piece.nom);
        if (dejaImportes.has(src)) {
          deja++;
          continue;
        }
        onProgress(`Analyse ${i + 1}/${ids.length} : ${piece.nom}`);
        const res = {
          source: src,
          messageId: id,
          fichier: piece.nom,
          sujet: entete(msg, 'subject'),
          expediteur: entete(msg, 'from'),
          dateMail: new Date(Number(msg.internalDate)).toISOString().slice(0, 10),
          lienMail: `https://mail.google.com/mail/u/0/#all/${msg.threadId}`,
        };
        try {
          const att = await api(`/messages/${id}/attachments/${piece.attachmentId}`);
          const bytes = b64urlToBytes(att.data);
          res.blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
          const texte = await textePdf(bytes);
          res.texte = texte;
          // Décomptes annuels, récapitulatifs et factures jointes sont signalés quel que soit le type de la règle.
          const detecte = Extract.detecterType(texte + '\n' + res.sujet, piece.nom);
          const type = ['decompte', 'recap', 'facture'].includes(detecte) ? detecte : regle.type && regle.type !== 'auto' ? regle.type : detecte || 'appel';
          res.extraction = Extract.extraire(texte, type, piece.nom);
          if (!texte.trim()) res.erreur = 'PDF sans texte (document scanné ?) : saisissez les montants à la main.';
        } catch (e) {
          res.erreur = /password/i.test(e.name + e.message) ? 'PDF protégé par mot de passe.' : `Lecture du PDF impossible : ${e.message}`;
          res.extraction = Extract.extraire('', regle.type === 'gerance' ? 'gerance' : 'appel');
        }
        resultats.push(res);
      }
    }
    if (deja) onProgress(`${deja} PDF déjà importé(s), ignoré(s).`);
    return resultats;
  }

  window.GmailSource = { connecter, deconnecter, estConnecte, chercher, source };
})();
