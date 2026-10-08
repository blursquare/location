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
    // ainsi que les numéros (« Lot N°012101 ») qui se colleraient au montant suivant.
    const propre = ligne
      .replace(/\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/g, ' ')
      .replace(/\d+(?:[,.]\d+)?\s?%/g, ' ')
      .replace(/\bn\s*[°o]\s*\d+/gi, ' ');
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
      out.push({ iso: toISO(m[1] === '1er' ? 1 : m[1], MOIS.indexOf(m[2]) + 1, m[3]), index: m.index, longue: true });
    }
    return out.sort((a, b) => a.index - b.index);
  }

  /**
   * Date suivant un mot-clé (échéance, exigible…) : sur la même ligne, ou dans la ligne suivante
   * quand le mot-clé est un en-tête de tableau (dernière date de cette ligne). À défaut, première
   * date du document écrite avec l'année sur 4 chiffres.
   */
  function dateApres(texte, motifs) {
    const t = sansAccents(texte).toLowerCase();
    const ds = dates(texte);
    for (const re of motifs) {
      const m = re.exec(t);
      if (!m) continue;
      const finLigne = t.indexOf('\n', m.index) < 0 ? t.length : t.indexOf('\n', m.index);
      const d = ds.find((x) => x.index >= m.index && x.index < finLigne && x.index - m.index < 80);
      if (d) return d.iso;
      const finSuivante = t.indexOf('\n', finLigne + 1) < 0 ? t.length : t.indexOf('\n', finLigne + 1);
      const suivante = ds.filter((x) => x.index > finLigne && x.index < finSuivante);
      if (suivante.length) return suivante[suivante.length - 1].iso;
    }
    const longues = ds.filter((x) => /\d{4}/.test(t.slice(x.index, x.index + 10).split(/\s/)[0]) || x.longue);
    return (longues[0] || ds[0] || {}).iso || null;
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
    m = t.match(/(?<![\d/.-])(\d{2})[/-](\d{4})\b/);
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return `${m[2]}-${m[1]}`;
    return null;
  }

  function trimestre(texte) {
    const t = sansAccents(texte).toLowerCase();
    let m = t.match(/\b([1-4])\s*(?:er|e|eme|ème)?\s*trimestre\s*(\d{4})?/);
    if (m) return { n: Number(m[1]), annee: m[2] ? Number(m[2]) : null };
    m = t.match(/\bt([1-4])\s*[-/ ]?\s*(\d{4})\b/);
    if (m) return { n: Number(m[1]), annee: Number(m[2]) };
    m = t.match(/\b01[/.-](01|04|07|10)[/.-](\d{4})\s*(?:-|au|a)\s*(?:30|31)[/.-](03|06|09|12)[/.-]\2\b/);
    if (m && Number(m[3]) === Number(m[1]) + 2) return { n: (Number(m[1]) + 2) / 3, annee: Number(m[2]) };
    return null;
  }

  const lignesDe = (texte) =>
    String(texte || '')
      .split(/\r?\n/)
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

  // ---------- Appel de fonds ----------
  const RE_FONDS_TRAVAUX = /fonds\s+(?:de\s+|pour\s+)?travaux|cotisation\s+alur|fonds\s+alur|art(?:icle)?\.?\s*14-2/i;
  function extraireAppel(texte) {
    const lignes = lignesDe(texte);
    // Montant global de l'appel (fonds travaux compris), puis à défaut les formulations par lot.
    const total = montantApres(lignes, [
      /total\s+des\s+appels/i,
      /montant\s+de\s+(?:votre|l'?\s*)\s*appel/i,
      /(?:net|total|montant|solde)\s+a\s+(?:payer|regler|verser)/i,
      /total\s+(?:de\s+l'?\s*)?appel/i,
      /vous\s+(?:devez|reste)/i,
      /total\s+(?:general|ttc|du)/i,
      /^total\b/i,
    ], { exclure: RE_FONDS_TRAVAUX });
    // Fonds travaux : lignes détaillées, ou section « Fonds pour travaux ALUR » close par un total.
    let fondsTravaux = null;
    for (let i = 0; i < lignes.length; i++) {
      const l = sansAccents(lignes[i]);
      if (!RE_FONDS_TRAVAUX.test(l) || montantsDe(lignes[i]).length) continue;
      for (let j = i + 1; j < Math.min(lignes.length, i + 12); j++) {
        if (/^total\s+(?:appel|du\s+groupe)/i.test(sansAccents(lignes[j])) && montantsDe(lignes[j]).length) {
          fondsTravaux = montantsDe(lignes[j]).pop();
          break;
        }
      }
      if (fondsTravaux !== null) break;
    }
    if (fondsTravaux === null) {
      // Tableau à colonnes « Quote-part | Locatif » : la quote-part est l'avant-dernier montant.
      const avecLocatif = lignes.some((l) => /quote-?\s?part\s+locatif/i.test(sansAccents(l)));
      let somme = 0;
      let vu = false;
      for (const l of lignes) {
        if (!RE_FONDS_TRAVAUX.test(sansAccents(l)) || /total|appel\s+n|solde/i.test(sansAccents(l))) continue;
        const ms = montantsDe(l);
        if (!ms.length) continue;
        somme += avecLocatif && ms.length >= 3 ? ms[ms.length - 2] : ms[ms.length - 1];
        vu = true;
      }
      fondsTravaux = vu ? Math.round(somme * 100) / 100 : null;
    }
    // Part récupérable sur le locataire quand le syndic l'indique (« Locatif : 237,56 »).
    let recuperable = null;
    for (const l of lignes) {
      const m = sansAccents(l).match(/^locatif\s*:?\s*(-?[\d\s.]+[,.]\d{2})/i);
      if (m) {
        recuperable = parseMontant(m[1]);
        break;
      }
    }
    if (recuperable === null) recuperable = montantApres(lignes, [/(?:dont|part)\s+(?:charges\s+)?(?:recuperables?|locatives?)/i, /charges\s+recuperables/i], { exclure: /non\s+locat/i });
    // Appels découpés en rubriques (« Appel n°3 : CHARGES COURANTES » … « Total appel Copropriétaire ») :
    // les travaux votés en AG sont isolés des charges courantes et du fonds travaux.
    const sections = [];
    for (let i = 0; i < lignes.length; i++) {
      const m = lignes[i].match(/^appel\s+n\s*°?\s*\d+\s*:\s*(.+)$/i);
      if (!m) continue;
      for (let j = i + 1; j < Math.min(lignes.length, i + 25); j++) {
        if (/^appel\s+n\s*°?\s*\d+\s*:/i.test(lignes[j])) break;
        if (/^total\s+appel/i.test(sansAccents(lignes[j])) && montantsDe(lignes[j]).length) {
          sections.push({ titre: m[1].trim(), montant: montantsDe(lignes[j]).pop() });
          break;
        }
      }
    }
    let travauxVotes = null;
    if (sections.length) {
      const votes = sections.filter((x) => !RE_FONDS_TRAVAUX.test(sansAccents(x.titre)) && !/courantes|budget|provisions?|fonctionnement/i.test(sansAccents(x.titre)));
      const montantVotes = Math.round(votes.reduce((t, x) => t + x.montant, 0) * 100) / 100;
      if (votes.length && montantVotes) travauxVotes = { montant: montantVotes, libelle: votes.map((x) => x.titre.toLowerCase()).join(', ') };
    }
    const date = dateApres(texte, [/exigib/, /echeance/, /date\s+limite/, /avant\s+le/, /a\s+regler\s+(?:le|pour)/, /periode\s+du/, /appel\s+du/]);
    const tri = trimestre(texte);
    const t = sansAccents(texte).toLowerCase();
    const travaux =
      (/travaux\s+votes|appel\s+(?:de\s+fonds\s+)?travaux|charges\s+travaux|appel\s+n\s*°?\s*\d+\s*:\s*travaux|\bag\s*\d{2}\s+r\d|ag\s+du/.test(t)) &&
      !/budget\s+previsionnel|charges\s+courantes|charges\s+de\s+fonctionnement/.test(t);
    const champs = [total, date].filter((x) => x !== null).length;
    return {
      type: 'appel',
      total,
      fondsTravaux,
      recuperable,
      travauxVotes,
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

  /**
   * Relevé de gérance découpé par lots (« Lot N°… / Mandat N°… » … « Total du Lot N°… ») :
   * un relevé peut regrouper plusieurs biens et plusieurs mois. Pour chaque lot : loyers et
   * provisions par mois, garantie loyers impayés par mois, factures imputées, total des recettes.
   * Les honoraires TTC, globaux, sont répartis au prorata des recettes de chaque lot.
   * Retourne null si le document n'est pas découpé par lots.
   */
  function extraireReleveLots(texte) {
    const lignes = lignesDe(texte);
    const debuts = [];
    lignes.forEach((l, i) => {
      if (/^lot\s+n\s*[°o]/i.test(sansAccents(l))) debuts.push(i);
    });
    if (!debuts.length || !lignes.some((l) => /^total\s+du\s+lot/i.test(sansAccents(l)))) return null;
    const periodeDe = (l) => {
      const m = l.match(/\b(\d{2})[/.-](\d{2})[/.-](\d{4})\b/);
      return m ? `${m[3]}-${m[2]}` : null;
    };
    const lots = debuts.map((d, k) => {
      const bloc = lignes.slice(d, k + 1 < debuts.length ? debuts[k + 1] : lignes.length);
      const lot = { texte: bloc.join('\n'), mois: {}, assurances: {}, factures: [], recettes: null, depenses: null };
      let section = '';
      for (const l of bloc) {
        const a = sansAccents(l).toLowerCase();
        if (/^reglements\b/.test(a)) section = 'reglements';
        else if (/^assurances?\b/.test(a)) section = 'assurances';
        else if (/^factures?\b|^depenses\b|^travaux\b/.test(a)) section = 'factures';
        if (/^total\s+du\s+lot/.test(a)) {
          const ms = montantsDe(l);
          if (ms.length >= 2) [lot.depenses, lot.recettes] = ms.slice(-2);
          section = 'fin';
          continue;
        }
        const ms = montantsDe(l);
        const p = periodeDe(l);
        if (ms.length < 2 || !p) continue;
        const [dep, rec] = ms.slice(-2);
        if (section === 'reglements' && /loyer|provision|charges|complement/.test(a)) {
          const m = (lot.mois[p] = lot.mois[p] || { periode: p, loyer: 0, provisions: 0 });
          if (/provision|charges/.test(a)) m.provisions = Math.round((m.provisions + rec - dep) * 100) / 100;
          else m.loyer = Math.round((m.loyer + rec - dep) * 100) / 100;
        } else if (section === 'factures') {
          const date = (dates(l)[0] || {}).iso || null;
          lot.factures.push({ libelle: l.replace(/\s*\d{2}[/.-]\d{2}[/.-]\d{4}.*$/, '').trim(), date, montant: Math.round((dep - rec) * 100) / 100 });
        } else if (section === 'assurances' || /garantie|loyers?\s+impayes|\bgli\b/.test(a)) {
          lot.assurances[p] = Math.round(((lot.assurances[p] || 0) + dep - rec) * 100) / 100;
        }
      }
      lot.mois = Object.values(lot.mois).sort((x, y) => x.periode.localeCompare(y.periode));
      return lot;
    });
    const honoraires = montantApres(lignes, [/honoraires?\s+t\.?\s?t\.?\s?c/i, /honoraires?\s+(?:de\s+gestion\s+)?ttc/i]);
    const totalRecettes = lots.reduce((t, l) => t + (l.recettes || 0), 0);
    let reste = honoraires || 0;
    lots.forEach((l, i) => {
      if (honoraires === null) return (l.honoraires = null);
      l.honoraires = i === lots.length - 1 ? Math.round(reste * 100) / 100 : totalRecettes ? Math.round(((honoraires * (l.recettes || 0)) / totalRecettes) * 100) / 100 : 0;
      reste -= l.honoraires;
    });
    const net = montantApres(lignes, [/a\s+vous\s+verser/i, /net\s+a\s+(?:vous\s+)?(?:verser|reverser)/i]);
    const date = dateApres(texte, [/,\s*le\s+\d/, /vir(?:ement|e)\s+(?:effectue\s+)?le/, /edite\s+le/]);
    return { type: 'gerance', lots, honoraires, net, date, confiance: lots.every((l) => l.recettes !== null) ? 'bonne' : 'partielle' };
  }

  /**
   * Relevé de gérance couvrant plusieurs biens, sans découpage par lots reconnaissable.
   * reperes : [{ id, motifs: ['rue garibaldi', 'bernard', 'lot 7', …] }]
   * Le texte est découpé à la première mention de chaque bien ; chaque section est lue séparément.
   * Retourne [] si moins de deux biens sont repérés (relevé à traiter comme un seul bien).
   */
  function extraireGeranceMulti(texte, reperes) {
    const t = sansAccents(texte).toLowerCase();
    const trouves = [];
    for (const r of reperes || []) {
      let idx = -1;
      for (const m of r.motifs || []) {
        const motif = sansAccents(m).toLowerCase().trim();
        if (motif.length < 4) continue;
        const i = t.indexOf(motif);
        if (i >= 0 && (idx < 0 || i < idx)) idx = i;
      }
      if (idx >= 0) trouves.push({ id: r.id, idx });
    }
    if (trouves.length < 2) return [];
    trouves.sort((a, b) => a.idx - b.idx);
    // Repartir du début de la ligne où le bien est mentionné
    const debutLigne = (i) => t.lastIndexOf('\n', i) + 1;
    const periode = periodeMensuelle(texte);
    const global = extraireGerance(texte);
    return trouves.map((x, k) => {
      const fin = k + 1 < trouves.length ? debutLigne(trouves[k + 1].idx) : texte.length;
      const r = extraireGerance(texte.slice(debutLigne(x.idx), fin));
      return { ...r, bienId: x.id, periode: periode || r.periode, date: global.date || r.date };
    });
  }

  /**
   * Devine le type de document : 'appel', 'gerance', ou un document à ne pas importer comme tel :
   * 'decompte' (décompte / régularisation annuelle du syndic), 'recap' (récapitulatif annuel de
   * l'agence), 'facture' (facture jointe à un relevé, déjà comptée dans celui-ci).
   */
  function detecterType(texte, nomFichier) {
    const nom = sansAccents(nomFichier || '').toLowerCase();
    const t = sansAccents(`${nomFichier || ''}\n${texte}`).toLowerCase();
    if (/historique|revenus\s*fonciers|recapitulatif\s+annuel|declaration\s+des\s+revenus/.test(nom) || /historique\s+des\s+redditions|aide\s+a\s+la\s+declaration/.test(t)) return 'recap';
    if (/decompte\s+(?:de\s+charges|individuel|definitif|des\s+charges)|regularisation\s+(?:des\s+)?charges|repartition\s+des\s+charges\s+(?:de\s+l'?\s*)?exercice/.test(t) && !/appel\s+de\s+fonds/.test(sansAccents(texte).toLowerCase().slice(0, 400))) return 'decompte';
    if (/^(?:fac|facture)\b|\bfacture\b/.test(nom) && !/releve\s+de\s+gerance|lot\s+n\s*°/.test(t)) return 'facture';
    const gerance = (t.match(/gerance|compte\s+rendu\s+de\s+gestion|releve\s+de\s+gestion|\bcrg\b|mandant|honoraires\s+de\s+gestion|net\s+proprietaire|reverser/g) || []).length;
    const appel = (t.match(/appel\s+de\s+(?:fonds|charges|provisions)|syndic|coproprie|tantiemes|budget\s+previsionnel|fonds\s+travaux/g) || []).length;
    if (!gerance && !appel) return null;
    return gerance > appel ? 'gerance' : 'appel';
  }

  function extraire(texte, type, nomFichier) {
    const t = type || detecterType(texte, nomFichier) || 'appel';
    if (t === 'decompte' || t === 'recap' || t === 'facture') return { type: t, confiance: 'bonne' };
    if (t === 'gerance') return extraireReleveLots(texte) || extraireGerance(texte);
    return extraireAppel(texte);
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
   * v (charge)  : { bienId, date, libelle, categorie, montant } (facture imputée par l'agence)
   */
  function operationsDepuis(type, source, v) {
    const n = (x) => Math.round((Number(x) || 0) * 100) / 100;
    const ops = { charges: [], paiements: [] };
    if (type === 'charge') {
      if (n(v.montant)) ops.charges.push({ bien: v.bienId, date: v.date, categorie: v.categorie || 'travaux', libelle: v.libelle, montant: n(v.montant), partRecuperable: n(v.partRecuperable), source });
    } else if (type === 'appel') {
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
        ops.charges.push({ bien: v.bienId, date: v.periode ? `${v.periode}-01` : date, categorie: 'assurance_pno', libelle: `Garantie loyers impayés ${v.periode}`, montant: n(v.assurance), partRecuperable: 0, source: source + ':gli' });
      }
    }
    return ops;
  }

  const api = { extraireReleveLots, extraireGeranceMulti, operationsDepuis, parseMontant, montantsDe, dates, periodeMensuelle, trimestre, detecterType, extraireAppel, extraireGerance, extraire, lignesPdfJs };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Extract = api;
})(typeof window !== 'undefined' ? window : globalThis);
