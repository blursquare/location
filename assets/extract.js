/*
 * Extraction des montants depuis le texte d'un PDF :
 *  - appel de fonds du syndic (copropriété)
 *  - relevé / compte rendu de gérance (agence de gestion locative)
 * Fonctions pures, utilisables dans le navigateur (window.Extract) et sous Node.
 * Les formats varient d'un syndic ou d'une agence à l'autre : les résultats
 * sont des propositions, toujours vérifiées par l'utilisateur avant import.
 */
(function (root) {
  'use strict';

  const MOIS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];

  const sansAccents = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');

  // Montant au format français : 1 234,56 | 1.234,56 | 1234,56 | -12,00 | 1 234.56 €
  const RE_MONTANT = /(-\s?)?\d{1,3}(?:[   .]\d{3})*(?:[,.]\d{2})(?!\d)|(-\s?)?\d+(?:[,.]\d{2})(?!\d)/g;

  function parseMontant(s) {
    let t = String(s).replace(/[\s  €]/g, '');
    const neg = t.startsWith('-');
    t = t.replace('-', '');
    // séparateur décimal = dernier , ou . suivi de 2 chiffres
    const m = t.match(/^(.*)[,.](\d{2})$/);
    const n = m ? Number(m[1].replace(/[.,]/g, '') + '.' + m[2]) : Number(t.replace(/[.,]/g, ''));
    return Number.isFinite(n) ? (neg ? -n : n) : null;
  }

  function montantsDe(ligne) {
    // On ignore les dates (12/03/2026) et pourcentages pour ne pas les confondre avec des montants
    const propre = ligne.replace(/\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/g, ' ').replace(/\d+(?:[,.]\d+)?\s?%/g, ' ');
    return (propre.match(RE_MONTANT) || []).map(parseMontant).filter((x) => x !== null);
  }

  /** Dernier montant de la première ligne correspondant à l'un des motifs (ou de la ligne suivante). */
  function montantApres(lignes, motifs, { exclure } = {}) {
    for (const re of motifs) {
      for (let i = 0; i < lignes.length; i++) {
        const l = sansAccents(lignes[i]);
        if (!re.test(l) || (exclure && exclure.test(l))) continue;
        let ms = montantsDe(lignes[i]);
        if (!ms.length && i + 1 < lignes.length) ms = montantsDe(lignes[i + 1]);
        if (ms.length) return ms[ms.length - 1];
      }
    }
    return null;
  }

  /** Somme de tous les montants des lignes correspondant au motif. */
  function sommeLignes(lignes, re, exclure) {
    let s = 0;
    let trouve = false;
    for (const ligne of lignes) {
      const l = sansAccents(ligne);
      if (!re.test(l) || (exclure && exclure.test(l))) continue;
      const ms = montantsDe(ligne);
      if (ms.length) {
        s += ms[ms.length - 1];
        trouve = true;
      }
    }
    return trouve ? Math.round(s * 100) / 100 : null;
  }

  function toISO(j, m, a) {
    a = Number(a);
    if (a < 100) a += 2000;
    return `${a}-${String(m).padStart(2, '0')}-${String(j).padStart(2, '0')}`;
  }

  function dates(texte) {
    const out = [];
    const t = sansAccents(texte).toLowerCase();
    for (const m of t.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/g)) {
      if (Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[1]) >= 1 && Number(m[1]) <= 31) out.push({ iso: toISO(m[1], m[2], m[3]), index: m.index });
    }
    const reLong = new RegExp(`\\b(1er|\\d{1,2})\\s+(${MOIS.join('|')})\\s+(\\d{4})`, 'g');
    for (const m of t.matchAll(reLong)) {
      out.push({ iso: toISO(m[1] === '1er' ? 1 : m[1], MOIS.indexOf(m[2]) + 1, m[3]), index: m.index });
    }
    return out.sort((a, b) => a.index - b.index);
  }

  /** Date suivant un mot-clé (échéance, exigible…) sinon première date du document. */
  function dateApres(texte, motifs) {
    const t = sansAccents(texte).toLowerCase();
    const ds = dates(texte);
    for (const re of motifs) {
      const m = re.exec(t);
      if (!m) continue;
      const d = ds.find((x) => x.index >= m.index && x.index - m.index < 80);
      if (d) return d.iso;
    }
    return ds.length ? ds[0].iso : null;
  }

  /** Période AAAA-MM d'un relevé mensuel (« mois d'octobre 2026 », « période du 01/10/2026 au 31/10/2026 »…). */
  function periodeMensuelle(texte) {
    const t = sansAccents(texte).toLowerCase();
    let m = t.match(/periode\s+du\s+(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
    if (m) return `${m[3]}-${String(m[2]).padStart(2, '0')}`;
    m = t.match(new RegExp(`(?:mois\\s+(?:de\\s+|d'\\s*)?|relev[e]\\s+(?:de\\s+gerance\\s+)?(?:de\\s+|d'\\s*)?|gerance\\s+(?:de\\s+|d'\\s*)?|loyer\\s+(?:de\\s+|d'\\s*)?)(${MOIS.join('|')})\\s+(\\d{4})`));
    if (m) return `${m[2]}-${String(MOIS.indexOf(m[1]) + 1).padStart(2, '0')}`;
    m = t.match(new RegExp(`\\b(${MOIS.join('|')})\\s+(\\d{4})\\b`));
    if (m) return `${m[2]}-${String(MOIS.indexOf(m[1]) + 1).padStart(2, '0')}`;
    m = t.match(/\b(\d{2})[/-](\d{4})\b/);
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return `${m[2]}-${m[1]}`;
    return null;
  }

  function trimestre(texte) {
    const t = sansAccents(texte).toLowerCase();
    let m = t.match(/\b([1-4])\s*(?:er|e|eme|ème)?\s*trimestre\s*(\d{4})?/);
    if (m) return { n: Number(m[1]), annee: m[2] ? Number(m[2]) : null };
    m = t.match(/\bt([1-4])\s*[-/ ]?\s*(\d{4})\b/);
    if (m) return { n: Number(m[1]), annee: Number(m[2]) };
    return null;
  }

  const lignesDe = (texte) =>
    String(texte || '')
      .split(/\r?\n/)
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

  // ---------- Appel de fonds ----------
  function extraireAppel(texte) {
    const lignes = lignesDe(texte);
    const total = montantApres(lignes, [
      /total\s+(?:de\s+l'?\s*)?appel/i,
      /montant\s+(?:de\s+l'?\s*)?appel/i,
      /(?:net|total|montant|solde)\s+a\s+(?:payer|regler|verser)/i,
      /vous\s+(?:devez|reste)/i,
      /total\s+(?:general|ttc|du)/i,
      /^total\b/i,
    ], { exclure: /fonds\s+(?:de\s+)?travaux|alur/i });
    const fondsTravaux = sommeLignes(lignes, /fonds\s+(?:de\s+)?travaux|cotisation\s+alur|fonds\s+alur|art(?:icle)?\.?\s*14-2/i, /total/i);
    const date = dateApres(texte, [/exigib/, /echeance/, /date\s+limite/, /avant\s+le/, /a\s+regler\s+(?:le|pour)/, /appel\s+du/]);
    const tri = trimestre(texte);
    const t = sansAccents(texte).toLowerCase();
    const travaux = /travaux\s+votes|appel\s+(?:de\s+fonds\s+)?travaux|ag\s+du/.test(t) && !/budget\s+previsionnel/.test(t);
    const champs = [total, date].filter((x) => x !== null).length;
    return {
      type: 'appel',
      total,
      fondsTravaux,
      date,
      trimestre: tri,
      travaux,
      confiance: champs === 2 ? 'bonne' : champs === 1 ? 'partielle' : 'faible',
    };
  }

  // ---------- Relevé de gérance ----------
  function extraireGerance(texte) {
    const lignes = lignesDe(texte);
    const exclureLoyer = /honoraire|commission|tva|assurance|garantie|frais|total|net|provision|charge/i;
    const loyer = montantApres(lignes, [/loyer\s+(?:principal|hors\s+charges|hc|nu|mensuel)/i, /^loyer\b/i, /\bloyer\b/i], { exclure: exclureLoyer });
    const provisions = montantApres(lignes, [/provisions?\s+(?:sur|pour|de)\s+charges/i, /charges\s+locatives/i, /provisions?\s+charges/i], { exclure: /total|honoraire/i });
    const honoraires =
      montantApres(lignes, [/honoraires?\s+(?:de\s+gestion|de\s+gerance)?\s*ttc/i, /total\s+honoraires/i]) ??
      sommeLignes(lignes, /honoraires?|frais\s+de\s+gestion|commission\s+de\s+gestion/i, /total|base|taux|ht\b/i);
    const assurance = sommeLignes(lignes, /garantie\s+(?:des\s+)?loyers?|\bgli\b|assurance\s+loyers?\s+impayes/i, /total/i);
    const encaisse = montantApres(lignes, [/total\s+(?:des\s+)?(?:encaissements|recettes|credits?)/i, /total\s+encaisse/i, /loyers?\s+encaisses?/i]);
    const net = montantApres(lignes, [
      /net\s+a\s+(?:vous\s+)?(?:verser|reverser|payer)/i,
      /solde\s+(?:en\s+)?(?:votre\s+faveur|crediteur|a\s+vous\s+verser)/i,
      /montant\s+(?:du\s+)?(?:vire|verse|virement|reglement)/i,
      /(?:virement|reglement)\s+(?:effectue|emis|en\s+votre\s+faveur)/i,
      /net\s+proprietaire/i,
    ]);
    const periode = periodeMensuelle(texte);
    const date = dateApres(texte, [/vir(?:ement|e)\s+(?:effectue\s+)?le/, /arrete\s+au/, /edite\s+le/, /date\s*:/]);
    const champs = [loyer ?? encaisse, net, periode].filter((x) => x !== null && x !== undefined).length;
    return {
      type: 'gerance',
      loyer,
      provisions,
      encaisse,
      honoraires,
      assurance,
      net,
      periode,
      date,
      confiance: champs === 3 ? 'bonne' : champs >= 1 ? 'partielle' : 'faible',
    };
  }

  /** Devine le type de document à partir de son texte. */
  function detecterType(texte, nomFichier) {
    const t = sansAccents(`${nomFichier || ''}\n${texte}`).toLowerCase();
    const gerance = (t.match(/gerance|compte\s+rendu\s+de\s+gestion|releve\s+de\s+gestion|\bcrg\b|mandant|honoraires\s+de\s+gestion|net\s+proprietaire|reverser/g) || []).length;
    const appel = (t.match(/appel\s+de\s+(?:fonds|charges|provisions)|syndic|coproprie|tantiemes|budget\s+previsionnel|fonds\s+travaux/g) || []).length;
    if (!gerance && !appel) return null;
    return gerance > appel ? 'gerance' : 'appel';
  }

  function extraire(texte, type, nomFichier) {
    const t = type || detecterType(texte, nomFichier) || 'appel';
    return t === 'gerance' ? extraireGerance(texte) : extraireAppel(texte);
  }

  /** Reconstitue des lignes de texte à partir des éléments pdf.js (getTextContent). */
  function lignesPdfJs(items) {
    const rows = [];
    for (const it of items) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.transform[5]);
      const x = it.transform[4];
      let row = rows.find((r) => Math.abs(r.y - y) <= 2);
      if (!row) rows.push((row = { y, items: [] }));
      row.items.push({ x, s: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    return rows.map((r) => r.items.sort((a, b) => a.x - b.x).map((i) => i.s).join(' ')).join('\n');
  }

  /**
   * Transforme un document vérifié en opérations importables (format de Calc.fusionnerOperations).
   * v (appel)   : { bienId, date, libelle, categorie, montant, partRecuperable, fondsTravaux }
   * v (gérance) : { bienId, periode, date, encaisse, honoraires, assurance }
   */
  function operationsDepuis(type, source, v) {
    const n = (x) => Math.round((Number(x) || 0) * 100) / 100;
    const ops = { charges: [], paiements: [] };
    if (type === 'appel') {
      if (n(v.montant)) {
        ops.charges.push({ bien: v.bienId, date: v.date, categorie: v.categorie || 'copro', libelle: v.libelle, montant: n(v.montant), partRecuperable: n(v.partRecuperable), source });
      }
      if (n(v.fondsTravaux)) {
        ops.charges.push({ bien: v.bienId, date: v.date, categorie: 'copro_travaux', libelle: `Fonds travaux — ${v.libelle}`, montant: n(v.fondsTravaux), partRecuperable: 0, source: source + ':fonds-travaux' });
      }
    } else {
      const [y, m] = (v.periode || '').split('-').map(Number);
      const finMois = y ? `${v.periode}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}` : v.date;
      const date = v.date || finMois;
      if (n(v.encaisse)) {
        ops.paiements.push({ bien: v.bienId, periode: v.periode, montant: n(v.encaisse), date, mode: 'Agence', note: 'Relevé de gérance', source });
      }
      if (n(v.honoraires)) {
        ops.charges.push({ bien: v.bienId, date, categorie: 'gestion', libelle: `Honoraires de gestion ${v.periode}`, montant: n(v.honoraires), partRecuperable: 0, source: source + ':honoraires' });
      }
      if (n(v.assurance)) {
        ops.charges.push({ bien: v.bienId, date, categorie: 'assurance_pno', libelle: `Garantie loyers impayés ${v.periode}`, montant: n(v.assurance), partRecuperable: 0, source: source + ':gli' });
      }
    }
    return ops;
  }

  const api = { operationsDepuis, parseMontant, montantsDe, dates, periodeMensuelle, trimestre, detecterType, extraireAppel, extraireGerance, extraire, lignesPdfJs };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Extract = api;
})(typeof window !== 'undefined' ? window : globalThis);
