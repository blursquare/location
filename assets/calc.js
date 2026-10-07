/*
 * Fonctions de calcul pures (sans DOM) : prêts, échéances de loyer,
 * régularisation des charges, synthèses annuelles.
 * Utilisable dans le navigateur (window.Calc) et sous Node (require).
 */
(function (root) {
  'use strict';

  const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

  // ---------- Dates ----------
  function parseDate(s) {
    if (!s) return null;
    const [y, m, d] = s.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d || 1));
  }
  function fmtISO(d) {
    return d.toISOString().slice(0, 10);
  }
  function addMonths(d, n) {
    const r = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
    const last = daysInMonth(r.getUTCFullYear(), r.getUTCMonth() + 1);
    r.setUTCDate(Math.min(d.getUTCDate(), last));
    return r;
  }
  function daysInMonth(y, m) {
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }
  function periodKey(y, m) {
    return `${y}-${String(m).padStart(2, '0')}`;
  }
  function daysBetween(a, b) {
    return Math.round((b - a) / 86400000);
  }

  // ---------- Prêts ----------
  /** Mensualité hors assurance d'un prêt amortissable à échéances constantes. */
  function mensualite(capital, tauxAnnuel, dureeMois) {
    const r = tauxAnnuel / 100 / 12;
    if (!dureeMois) return 0;
    if (r === 0) return capital / dureeMois;
    return (capital * r) / (1 - Math.pow(1 + r, -dureeMois));
  }

  /**
   * Tableau d'amortissement.
   * pret: { capital, tauxAnnuel, dureeMois, dateDebut (1re échéance), assuranceMensuelle, differeMois }
   * Différé partiel : pendant `differeMois`, seuls les intérêts (et l'assurance) sont payés.
   */
  function amortissement(pret) {
    const capital = Number(pret.capital) || 0;
    const taux = Number(pret.tauxAnnuel) || 0;
    const duree = Number(pret.dureeMois) || 0;
    const differe = Math.min(Number(pret.differeMois) || 0, Math.max(duree - 1, 0));
    const assurance = Number(pret.assuranceMensuelle) || 0;
    const r = taux / 100 / 12;
    const start = parseDate(pret.dateDebut) || new Date();
    const m = mensualite(capital, taux, duree - differe);
    const lignes = [];
    let crd = capital;
    for (let i = 0; i < duree; i++) {
      const interets = crd * r;
      let principal = i < differe ? 0 : m - interets;
      if (i === duree - 1) principal = crd; // solde exact à la dernière échéance
      crd -= principal;
      lignes.push({
        n: i + 1,
        date: fmtISO(addMonths(start, i)),
        echeance: round2(principal + interets),
        interets: round2(interets),
        capital: round2(principal),
        assurance: round2(assurance),
        total: round2(principal + interets + assurance),
        crd: round2(Math.max(crd, 0)),
      });
    }
    return lignes;
  }

  /** Totaux d'un prêt sur une année civile + CRD au 31/12. */
  function pretAnnee(pret, annee) {
    const t = amortissement(pret);
    const res = { interets: 0, capital: 0, assurance: 0, total: 0, crdFin: null };
    let crd = Number(pret.capital) || 0;
    for (const l of t) {
      const y = Number(l.date.slice(0, 4));
      if (y < annee) crd = l.crd;
      if (y === annee) {
        res.interets += l.interets;
        res.capital += l.capital;
        res.assurance += l.assurance;
        res.total += l.total;
        crd = l.crd;
      }
    }
    res.crdFin = round2(crd);
    for (const k of ['interets', 'capital', 'assurance', 'total']) res[k] = round2(res[k]);
    return res;
  }

  /** Capital restant dû à une date donnée (après les échéances échues à cette date). */
  function crdAu(pret, dateISO) {
    let crd = Number(pret.capital) || 0;
    for (const l of amortissement(pret)) {
      if (l.date <= dateISO) crd = l.crd;
      else break;
    }
    return crd;
  }

  // ---------- Loyers ----------
  /**
   * Échéances mensuelles d'un bail entre deux périodes incluses (YYYY-MM).
   * Le premier et le dernier mois sont proratisés au nombre de jours occupés.
   */
  function echeancesBail(bail, fromPeriod, toPeriod) {
    const debut = parseDate(bail.dateDebut);
    if (!debut) return [];
    const fin = bail.dateFin ? parseDate(bail.dateFin) : null;
    const [fy, fm] = fromPeriod.split('-').map(Number);
    const [ty, tm] = toPeriod.split('-').map(Number);
    const loyer = Number(bail.loyerHC) || 0;
    const prov = Number(bail.provisionCharges) || 0;
    const out = [];
    for (let y = fy, m = fm; y < ty || (y === ty && m <= tm); m === 12 ? (y++, (m = 1)) : m++) {
      const dim = daysInMonth(y, m);
      const mStart = new Date(Date.UTC(y, m - 1, 1));
      const mEnd = new Date(Date.UTC(y, m - 1, dim));
      if (debut > mEnd) continue;
      if (fin && fin < mStart) continue;
      const s = debut > mStart ? debut : mStart;
      const e = fin && fin < mEnd ? fin : mEnd;
      const jours = daysBetween(s, e) + 1;
      const prorata = jours / dim;
      out.push({
        periode: periodKey(y, m),
        jours,
        prorata,
        loyer: round2(loyer * prorata),
        provision: round2(prov * prorata),
        du: round2((loyer + prov) * prorata),
      });
    }
    return out;
  }

  /** Échéances d'un bail avec montant encaissé et reste dû par période. */
  function situationBail(bail, paiements, fromPeriod, toPeriod) {
    const parPeriode = {};
    for (const p of paiements) {
      if (p.bailId !== bail.id) continue;
      parPeriode[p.periode] = (parPeriode[p.periode] || 0) + (Number(p.montant) || 0);
    }
    return echeancesBail(bail, fromPeriod, toPeriod).map((e) => {
      const paye = round2(parPeriode[e.periode] || 0);
      return { ...e, paye, reste: round2(e.du - paye) };
    });
  }

  /** Nouveau loyer après révision IRL. */
  function revisionIRL(loyer, irlReference, irlNouveau) {
    if (!irlReference || !irlNouveau) return loyer;
    return round2((loyer * irlNouveau) / irlReference);
  }

  // ---------- Charges ----------
  /** Nombre de jours d'occupation d'un bail sur une année. */
  function joursOccupes(bail, annee) {
    const debut = parseDate(bail.dateDebut);
    if (!debut) return 0;
    const fin = bail.dateFin ? parseDate(bail.dateFin) : null;
    const yStart = new Date(Date.UTC(annee, 0, 1));
    const yEnd = new Date(Date.UTC(annee, 11, 31));
    const s = debut > yStart ? debut : yStart;
    const e = fin && fin < yEnd ? fin : yEnd;
    if (e < s) return 0;
    return daysBetween(s, e) + 1;
  }

  /**
   * Régularisation annuelle des charges récupérables pour un bail.
   * Charges récupérables du bien sur l'année, proratisées à la durée d'occupation,
   * comparées aux provisions appelées (échéances) sur l'année.
   * Résultat positif = complément à demander au locataire ; négatif = trop-perçu à rembourser.
   */
  function regularisation(bail, charges, annee) {
    const joursAn = (annee % 4 === 0 && annee % 100 !== 0) || annee % 400 === 0 ? 366 : 365;
    const jours = joursOccupes(bail, annee);
    const prorata = jours / joursAn;
    const recupBien = charges
      .filter((c) => c.bienId === bail.bienId && (c.date || '').startsWith(String(annee)))
      .reduce((s, c) => s + (Number(c.partRecuperable) || 0), 0);
    const recup = recupBien * prorata;
    const provisions = echeancesBail(bail, `${annee}-01`, `${annee}-12`).reduce((s, e) => s + e.provision, 0);
    return {
      jours,
      prorata,
      chargesRecuperablesBien: round2(recupBien),
      chargesRecuperables: round2(recup),
      provisions: round2(provisions),
      solde: round2(recup - provisions),
    };
  }

  // ---------- Synthèse ----------
  const CATEGORIES = {
    copro: { label: 'Charges de copropriété', deductible: true },
    copro_travaux: { label: 'Travaux votés en AG / fonds travaux', deductible: true },
    taxe_fonciere: { label: 'Taxe foncière', deductible: true },
    assurance_pno: { label: 'Assurance PNO', deductible: true },
    gestion: { label: 'Frais de gestion / agence', deductible: true },
    travaux: { label: 'Travaux entretien / réparation', deductible: true },
    amelioration: { label: "Travaux d'amélioration", deductible: true },
    autre: { label: 'Autre (non déductible)', deductible: false },
  };

  /**
   * Synthèse annuelle d'un bien (ou de tous si bienId null).
   * Retourne loyers, charges, prêts, cash-flow et estimation des revenus fonciers (régime réel).
   */
  function syntheseAnnee(data, annee, bienId) {
    const biens = data.biens.filter((b) => !bienId || b.id === bienId);
    const ids = new Set(biens.map((b) => b.id));
    const baux = data.baux.filter((b) => ids.has(b.bienId));
    const bailIds = new Set(baux.map((b) => b.id));
    const y = String(annee);

    let loyersDus = 0;
    let provisionsDues = 0;
    for (const b of baux) {
      for (const e of echeancesBail(b, `${y}-01`, `${y}-12`)) {
        loyersDus += e.loyer;
        provisionsDues += e.provision;
      }
    }
    const encaisse = data.paiements
      .filter((p) => bailIds.has(p.bailId) && (p.periode || '').startsWith(y))
      .reduce((s, p) => s + (Number(p.montant) || 0), 0);

    const charges = data.charges.filter((c) => ids.has(c.bienId) && (c.date || '').startsWith(y));
    const chargesTotal = charges.reduce((s, c) => s + (Number(c.montant) || 0), 0);
    const chargesRecup = charges.reduce((s, c) => s + (Number(c.partRecuperable) || 0), 0);
    const chargesDeductibles = charges
      .filter((c) => (CATEGORIES[c.categorie] || {}).deductible)
      .reduce((s, c) => s + (Number(c.montant) || 0) - (Number(c.partRecuperable) || 0), 0);

    const pret = { interets: 0, capital: 0, assurance: 0, total: 0, crdFin: 0 };
    for (const p of data.prets.filter((p) => ids.has(p.bienId))) {
      const a = pretAnnee(p, annee);
      for (const k of Object.keys(pret)) pret[k] += a[k];
    }

    // Part encaissée imputée en priorité au loyer, le reste aux provisions.
    const totalDu = loyersDus + provisionsDues;
    const loyersEncaisses = totalDu > 0 ? Math.min(encaisse, loyersDus) : encaisse;
    const forfaitGestion = 20 * baux.filter((b) => joursOccupes(b, annee) > 0).length;
    const revenusBruts = loyersEncaisses;
    const deductions = chargesDeductibles + pret.interets + pret.assurance + forfaitGestion;

    const r = {
      loyersDus,
      provisionsDues,
      totalDu,
      encaisse,
      impayes: totalDu - encaisse,
      chargesTotal,
      chargesRecup,
      chargesDeductibles,
      pretInterets: pret.interets,
      pretCapital: pret.capital,
      pretAssurance: pret.assurance,
      pretTotal: pret.total,
      crdFin: pret.crdFin,
      cashFlow: encaisse - chargesTotal - pret.total,
      forfaitGestion,
      revenusBruts,
      deductions,
      resultatFoncier: revenusBruts - deductions,
    };
    for (const k of Object.keys(r)) r[k] = round2(r[k]);

    const investissement = biens.reduce(
      (s, b) => s + (Number(b.prixAchat) || 0) + (Number(b.fraisAcquisition) || 0),
      0
    );
    r.investissement = round2(investissement);
    r.rendementBrut = investissement ? round2((loyersDus / investissement) * 100) : 0;
    r.rendementNet = investissement
      ? round2(((loyersDus - (chargesTotal - chargesRecup)) / investissement) * 100)
      : 0;
    return r;
  }

  const api = {
    round2,
    parseDate,
    addMonths,
    daysInMonth,
    periodKey,
    mensualite,
    amortissement,
    pretAnnee,
    crdAu,
    echeancesBail,
    situationBail,
    revisionIRL,
    joursOccupes,
    regularisation,
    syntheseAnnee,
    CATEGORIES,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calc = api;
})(typeof window !== 'undefined' ? window : globalThis);
