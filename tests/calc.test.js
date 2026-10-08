const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../assets/calc.js');

test('mensualité classique', () => {
  // 200 000 € à 3,5 % sur 20 ans ≈ 1159,92 €
  assert.equal(C.round2(C.mensualite(200000, 3.5, 240)), 1159.92);
  assert.equal(C.mensualite(12000, 0, 120), 100);
});

test("tableau d'amortissement soldé", () => {
  const t = C.amortissement({ capital: 100000, tauxAnnuel: 2, dureeMois: 120, dateDebut: '2024-01-05', assuranceMensuelle: 15 });
  assert.equal(t.length, 120);
  assert.equal(t[0].date, '2024-01-05');
  assert.equal(t[119].crd, 0);
  const capital = t.reduce((s, l) => s + l.capital, 0);
  assert.ok(Math.abs(capital - 100000) < 0.05);
  assert.equal(t[0].assurance, 15);
});

test('différé partiel : intérêts seuls', () => {
  const t = C.amortissement({ capital: 120000, tauxAnnuel: 3, dureeMois: 24, dateDebut: '2025-01-01', differeMois: 6 });
  assert.equal(t[5].capital, 0);
  assert.equal(t[5].crd, 120000);
  assert.equal(t[23].crd, 0);
});

test('synthèse annuelle du prêt', () => {
  const p = { capital: 100000, tauxAnnuel: 2, dureeMois: 120, dateDebut: '2024-07-01' };
  const a = C.pretAnnee(p, 2024);
  const t = C.amortissement(p).slice(0, 6);
  assert.equal(a.interets, C.round2(t.reduce((s, l) => s + l.interets, 0)));
  assert.equal(a.crdFin, t[5].crd);
  assert.equal(C.pretAnnee(p, 2023).crdFin, 100000);
});

test('échéances de bail proratisées', () => {
  const bail = { id: 'b', dateDebut: '2026-03-16', dateFin: '2026-05-10', loyerHC: 620, provisionCharges: 80 };
  const e = C.echeancesBail(bail, '2026-01', '2026-12');
  assert.deepEqual(e.map((x) => x.periode), ['2026-03', '2026-04', '2026-05']);
  assert.equal(e[0].jours, 16);
  assert.equal(e[0].du, C.round2((700 * 16) / 31));
  assert.equal(e[1].du, 700);
  assert.equal(e[2].jours, 10);
});

test('situation : paiements partiels', () => {
  const bail = { id: 'b', dateDebut: '2026-01-01', loyerHC: 600, provisionCharges: 50 };
  const s = C.situationBail(bail, [{ bailId: 'b', periode: '2026-02', montant: 400 }, { bailId: 'x', periode: '2026-02', montant: 999 }], '2026-01', '2026-02');
  assert.equal(s[0].reste, 650);
  assert.equal(s[1].paye, 400);
  assert.equal(s[1].reste, 250);
});

test('révision IRL', () => {
  assert.equal(C.revisionIRL(700, 142.06, 145.17), 715.32);
});

test('régularisation des charges', () => {
  const bail = { id: 'b', bienId: 'x', dateDebut: '2025-07-01', loyerHC: 500, provisionCharges: 60 };
  const charges = [
    { bienId: 'x', date: '2025-03-01', montant: 400, partRecuperable: 300 },
    { bienId: 'x', date: '2025-09-01', montant: 500, partRecuperable: 430 },
    { bienId: 'y', date: '2025-09-01', montant: 900, partRecuperable: 900 },
  ];
  const r = C.regularisation(bail, charges, 2025);
  assert.equal(r.jours, 184);
  assert.equal(r.chargesRecuperablesBien, 730);
  assert.equal(r.provisions, 360);
  assert.equal(r.solde, C.round2((730 * 184) / 365 - 360));
});

test('synthèse annuelle', () => {
  const data = {
    biens: [{ id: 'x', prixAchat: 150000, fraisAcquisition: 12000 }],
    baux: [{ id: 'b', bienId: 'x', dateDebut: '2025-01-01', loyerHC: 700, provisionCharges: 100 }],
    paiements: Array.from({ length: 12 }, (_, i) => ({ bailId: 'b', periode: C.periodKey(2025, i + 1), montant: 800 })),
    charges: [
      { bienId: 'x', date: '2025-04-01', categorie: 'copro', montant: 1600, partRecuperable: 1100 },
      { bienId: 'x', date: '2025-10-15', categorie: 'taxe_fonciere', montant: 900, partRecuperable: 150 },
    ],
    prets: [],
  };
  const s = C.syntheseAnnee(data, 2025, null);
  assert.equal(s.loyersDus, 8400);
  assert.equal(s.encaisse, 9600);
  assert.equal(s.impayes, 0);
  assert.equal(s.chargesDeductibles, 1250);
  assert.equal(s.resultatFoncier, 8400 - 1250 - 20);
  assert.equal(s.cashFlow, 9600 - 2500);
  assert.equal(s.rendementBrut, C.round2((8400 / 162000) * 100));
});

test("fusion d'opérations importées sans doublon", () => {
  const data = {
    biens: [{ id: 'x', nom: 'T2 Croix-Rousse', adresse: '12 rue d’Austerlitz' }, { id: 'y', nom: 'Studio' }],
    baux: [
      { id: 'a', bienId: 'x', locataire: 'Marie Martin', dateDebut: '2024-01-01', dateFin: '2025-12-31' },
      { id: 'b', bienId: 'x', locataire: 'Paul Durand', dateDebut: '2026-01-01' },
    ],
    paiements: [],
    charges: [{ id: 'c0', bienId: 'x', date: '2026-01-01', montant: 1, source: 'mail-1' }],
    prets: [],
  };
  let n = 0;
  const imp = {
    charges: [
      { bien: 't2 croix-rousse', date: '2026-04-01', libelle: 'Appel T2', montant: 420, partRecuperable: 290, source: 'mail-2' },
      { bien: 'T2 Croix-Rousse', date: '2026-01-01', montant: 1, source: 'mail-1' },
      { bien: 'Inconnu', date: '2026-01-01', montant: 5 },
    ],
    paiements: [
      { bien: 'T2 Croix-Rousse', periode: '2026-03', montant: 800, source: 'crg-3' },
      { locataire: 'Marie', periode: '2025-06', montant: 750, source: 'crg-old' },
      { locataire: 'Paul', periode: '2026-03', montant: 800, source: 'crg-3' },
    ],
  };
  const r = C.fusionnerOperations(data, imp, () => 'n' + n++);
  assert.deepEqual(r.ajouts, { charges: 1, paiements: 2 });
  assert.equal(r.ignores, 2);
  assert.equal(r.erreurs.length, 1);
  assert.equal(r.data.charges[1].categorie, 'copro');
  assert.equal(r.data.paiements[0].bailId, 'b'); // bail actif à la période
  assert.equal(r.data.paiements[1].bailId, 'a');
  assert.equal(data.charges.length, 1); // données d'origine intactes
});

test('migration vers propriétaires et gestionnaires', () => {
  const d = C.migrer({ bailleur: { nom: 'Jean', adresse: 'Lyon' }, biens: [{ id: 'x' }, { id: 'y', enCopropriete: false, gestionMode: 'agence' }], baux: [] });
  assert.equal(d.proprietaires.length, 1);
  assert.equal(d.biens[0].proprietaireId, 'proprio-1');
  assert.equal(d.biens[0].enCopropriete, true);
  assert.equal(d.biens[0].gestionMode, 'direct');
  assert.equal(d.biens[1].enCopropriete, false);
  assert.equal(d.biens[1].gestionMode, 'agence');
  assert.deepEqual(C.migrer(d).proprietaires, d.proprietaires); // idempotent
});

test('associés et quotes-parts', () => {
  assert.deepEqual(C.associes('Marie Dupont : 50\nPaul Dupont 50 %'), [{ nom: 'Marie Dupont', pct: 50 }, { nom: 'Paul Dupont', pct: 50 }]);
  assert.deepEqual(C.associes('A 300 parts; B 100 parts').map((a) => a.pct), [75, 25]);
  assert.deepEqual(C.associes('Bastien\nSophie'), [{ nom: 'Bastien', pct: null }, { nom: 'Sophie', pct: null }]);
});

test('synthèse filtrée par plusieurs biens, forfait 20 € hors SCI', () => {
  const data = {
    proprietaires: [{ id: 's', type: 'sci_ir' }, { id: 'p', type: 'perso' }],
    biens: [{ id: 'x', proprietaireId: 's' }, { id: 'y', proprietaireId: 'p' }, { id: 'z', proprietaireId: 'p' }],
    baux: [
      { id: 'a', bienId: 'x', dateDebut: '2025-01-01', loyerHC: 500 },
      { id: 'b', bienId: 'y', dateDebut: '2025-01-01', loyerHC: 400 },
      { id: 'c', bienId: 'z', dateDebut: '2025-01-01', loyerHC: 300 },
    ],
    paiements: [], charges: [], prets: [],
  };
  assert.equal(C.syntheseAnnee(data, 2025, ['x', 'y']).loyersDus, 10800);
  assert.equal(C.syntheseAnnee(data, 2025, 'x').forfaitGestion, 0);
  assert.equal(C.syntheseAnnee(data, 2025, null).forfaitGestion, 40);
});

test('régularisation selon le décompte du syndic (exercice décalé)', () => {
  const bail = { id: 'b', bienId: 'x', dateDebut: '2025-01-01', dateFin: '2026-03-31', loyerHC: 500, provisionCharges: 60 };
  const decomptes = [{ bienId: 'x', exerciceDebut: '2025-04-01', exerciceFin: '2026-03-31', chargesRecuperables: 900 }];
  const charges = [{ bienId: 'x', date: '2026-01-01', categorie: 'copro', montant: 400, partRecuperable: 300 }];
  const r = C.regularisation(bail, charges, 2026, decomptes);
  assert.equal(r.source, 'decompte');
  assert.equal(r.jours, 365);
  assert.equal(r.chargesRecuperables, 900);
  assert.equal(r.provisions, 720); // 12 mois d'avril 2025 à mars 2026
  assert.equal(r.solde, 180);
});

test('TEOM proratisée et exclue de la régularisation des charges', () => {
  const bail = { id: 'b', bienId: 'x', dateDebut: '2025-07-01', loyerHC: 500, provisionCharges: 20 };
  const charges = [
    { bienId: 'x', date: '2025-10-15', categorie: 'taxe_fonciere', montant: 900, partRecuperable: 146 },
    { bienId: 'x', date: '2025-05-01', categorie: 'charges_directes', montant: 200, partRecuperable: 200 },
  ];
  const t = C.teom(bail, charges, 2025);
  assert.equal(t.jours, 184);
  assert.equal(t.montant, C.round2((146 * 184) / 365));
  const r = C.regularisation(bail, charges, 2025, []);
  assert.equal(r.chargesRecuperablesBien, 200); // TEOM non comptée deux fois
  const data = { charges, decomptes: [], paiements: [{ bailId: 'b', nature: 'teom', regulAnnee: 2025, montant: 50, periode: '2026-02' }, { bailId: 'b', periode: '2025-08', montant: 520 }] };
  const c = C.regularisationComplete(data, bail, 2025);
  assert.equal(c.dejaTeom, 50);
  assert.equal(c.total, C.round2(r.solde + t.montant));
  assert.equal(c.reste, C.round2(c.total - 50));
  // un remboursement de TEOM n'est pas un loyer : il ne solde pas une échéance
  const s = C.situationBail(bail, [{ bailId: 'b', periode: '2025-08', montant: 520, nature: 'teom' }], '2025-08', '2025-08');
  assert.equal(s[0].paye, 0);
});

test('révisions de loyer et de provisions en cours de bail', () => {
  const bail = { id: 'b', dateDebut: '2025-01-28', loyerHC: 470, provisionCharges: 70, revisions: [{ date: '2025-10-01', loyerHC: 474.89 }, { date: '2026-05-01', provisionCharges: 75 }] };
  const e = C.echeancesBail(bail, '2025-01', '2026-05');
  const par = Object.fromEntries(e.map((x) => [x.periode, x]));
  assert.equal(par['2025-01'].loyer, C.round2((470 * 4) / 31));
  assert.equal(par['2025-09'].du, 540);
  assert.equal(par['2025-10'].du, 544.89);
  assert.equal(par['2026-04'].du, 544.89);
  assert.equal(par['2026-05'].du, 549.89);
  assert.deepEqual(C.conditionsAu(bail, '2026-06'), { loyerHC: 474.89, provisionCharges: 75 });
});

test('paiements automatiques (virement permanent le 30) et récapitulatif annuel', () => {
  const bail = { id: 'm', dateDebut: '2026-02-01', loyerHC: 520, provisionCharges: 50, jourPaiement: 30, paiementAuto: true };
  const data = { baux: [bail, { id: 'x', dateDebut: '2026-01-01', loyerHC: 400, jourPaiement: 1 }], paiements: [] };
  const a = C.paiementsAutomatiques(data, '2026-10-08');
  assert.deepEqual(a.map((p) => p.date), ['2026-02-28', '2026-03-30', '2026-04-30', '2026-05-30', '2026-06-30', '2026-07-30', '2026-08-30', '2026-09-30']);
  assert.ok(a.every((p) => p.bailId === 'm' && p.montant === 570));
  data.paiements = a;
  assert.equal(C.paiementsAutomatiques(data, '2026-10-29').length, 0);
  assert.deepEqual(C.paiementsAutomatiques(data, '2026-10-30').map((p) => p.id), ['auto-m-2026-10']);
  const r = C.recapLoyers(bail, data.paiements, '2026-01', '2026-12', '2026-10-08');
  assert.equal(r.regles.length, 8);
  assert.equal(r.totalRegle, 4560);
  assert.equal(r.loyers, 4160);
  assert.equal(r.resteDu, 0);
  assert.equal(r.regles[7].datePaiement, '2026-09-30');
  const r2 = C.recapLoyers(bail, data.paiements, '2026-01', '2026-12', '2026-11-05');
  assert.deepEqual(r2.nonRegles.map((e) => e.periode), ['2026-10']);
  assert.equal(C.dateEcheance(bail, '2028-02'), '2028-02-29');
});

test("fusion : doublons d'opérations saisies à la main, bail en cours obligatoire", () => {
  const data = C.migrer({
    biens: [{ id: 'b1', nom: 'Appt B01' }],
    baux: [{ id: 'l1', bienId: 'b1', locataire: 'Dupont', dateDebut: '2026-02-01', loyerHC: 500 }],
    paiements: [{ id: 'p1', bailId: 'l1', periode: '2026-03', montant: 500, date: '2026-03-05' }],
    charges: [{ id: 'c1', bienId: 'b1', categorie: 'copro', libelle: 'Appel T3', date: '2026-07-10', montant: 375.76 }],
  });
  const r = C.fusionnerOperations(
    data,
    {
      charges: [
        { bien: 'b1', date: '2026-07-01', categorie: 'copro', libelle: 'Appel de fonds T3 2026', montant: 375.76, source: 'gmail:a:x.pdf' },
        { bien: 'b1', date: '2026-10-01', categorie: 'copro', libelle: 'Appel de fonds T4 2026', montant: 375.76, source: 'gmail:b:x.pdf' },
      ],
      paiements: [
        { bien: 'b1', periode: '2026-03', montant: 500, source: 'gmail:c:r.pdf' },
        { bien: 'b1', periode: '2026-04', montant: 500, source: 'gmail:d:r.pdf' },
        { bien: 'b1', periode: '2025-06', montant: 500, source: 'gmail:e:r.pdf' },
      ],
    },
    () => 'n' + Math.random()
  );
  assert.equal(r.ignores, 2); // T3 (à 9 jours près) et mars déjà saisis
  assert.equal(r.ajouts.charges, 1);
  assert.equal(r.ajouts.paiements, 1);
  assert.equal(r.erreurs.length, 1); // juin 2025 : aucun bail en cours
});

test('créance soldée sans paiement : solde le mois sans compter comme revenu', () => {
  const data = C.migrer({
    biens: [{ id: 'b1', nom: 'A' }],
    baux: [{ id: 'l1', bienId: 'b1', locataire: 'X', dateDebut: '2025-05-01', dateFin: '2025-05-31', loyerHC: 600 }],
    paiements: [
      { id: 'p1', bailId: 'l1', periode: '2025-05', montant: 400, date: '2025-05-05' },
      { id: 'p2', bailId: 'l1', periode: '2025-05', montant: 200, date: '2026-10-08', nature: 'abandon' },
    ],
    charges: [],
    prets: [],
  });
  assert.equal(C.situationBail(data.baux[0], data.paiements, '2025-05', '2025-05')[0].reste, 0);
  const s = C.syntheseAnnee(data, 2025, null);
  assert.equal(s.revenusBruts, 400);
  assert.equal(s.encaisse, 400);
  assert.equal(Math.round(s.impayes * 100) / 100, 0);
});

test("prêt : échéancier de la banque (assurance variable) prioritaire sur le calcul", () => {
  const texte = `  05/11/2026               54473,85                       171,81                       142,99                        7,36                     322,16
  05/12/2026               54302,04                       172,26                       142,54                        7,36                     322,16
05/02/2027      53957,07        173,16    141,64          7,60           322,40`;
  const e = C.lireEcheancier(texte);
  assert.equal(e.length, 3);
  assert.deepEqual(e[2], { date: '2027-02-05', crdAvant: 53957.07, capital: 173.16, interets: 141.64, assurance: 7.6 });
  const p = { capital: 56000, tauxAnnuel: 3.15, dureeMois: 240, dateDebut: '2026-02-05', assuranceMensuelle: 7.36, echeancier: e };
  const t = C.amortissement(p);
  const nov = t.find((l) => l.date === '2026-11-05');
  assert.equal(nov.capital, 171.81);
  assert.equal(nov.crd, 54302.04);
  assert.equal(t.find((l) => l.date === '2027-02-05').assurance, 7.6);
  assert.equal(t.find((l) => l.date === '2026-03-05').assurance, 7.36); // échéance passée : calcul
});
