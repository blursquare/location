const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('../assets/extract.js');

test('montants au format français', () => {
  assert.equal(X.parseMontant('1 234,56'), 1234.56);
  assert.equal(X.parseMontant('1.234,56 €'), 1234.56);
  assert.equal(X.parseMontant('1 234,56'), 1234.56);
  assert.equal(X.parseMontant('-12,00'), -12);
  assert.equal(X.parseMontant('420.00'), 420);
  assert.deepEqual(X.montantsDe('Échéance 01/10/2026 Quote-part 1,86 % Montant 420,00 €'), [420]);
});

const APPEL = `CABINET SYNDIC & CO
Syndic de copropriété — 4 quai Saint-Vincent 69001 Lyon
Résidence Les Canuts — 12 rue d'Austerlitz 69004 Lyon
Copropriétaire : M. ANGLUMENT   Lot(s) : 14, 32   Tantièmes : 186 / 10000
APPEL DE FONDS — 4ème trimestre 2026
Date d'exigibilité : 01/10/2026
Libellé                               Base          Quote-part      Montant
Budget prévisionnel 2026         90 322,58 €     186/10000        420,00 €
Fonds travaux (art. 14-2)         2 150,54 €     186/10000         40,00 €
Total de l'appel                                                   460,00 €
Solde antérieur                                                      0,00 €
Total à payer avant le 01/10/2026                                  460,00 €`;

test("appel de fonds : total, fonds travaux, échéance, trimestre", () => {
  assert.equal(X.detecterType(APPEL, 'appel_T4.pdf'), 'appel');
  const r = X.extraireAppel(APPEL);
  assert.equal(r.total, 460);
  assert.equal(r.fondsTravaux, 40);
  assert.equal(r.date, '2026-10-01');
  assert.deepEqual(r.trimestre, { n: 4, annee: 2026 });
  assert.equal(r.confiance, 'bonne');
});

const CRG = `AGENCE IMMO GESTION — Compte rendu de gérance
Mandant : M. ANGLUMENT
Relevé de gérance d'octobre 2026
Période du 01/10/2026 au 31/10/2026
Lot : T2 Croix-Rousse — Locataire : Marie MARTIN
Loyer principal                                 780,00
Provision sur charges                            90,00
Total encaissements                             870,00
Honoraires de gestion 7 % HT                     54,60
TVA 20 %                                         10,92
Honoraires TTC                                   65,52
Assurance garantie loyers impayés                21,75
Net à vous verser                               782,73
Virement effectué le 08/11/2026`;

test('relevé de gérance : loyer, provisions, honoraires, net, période', () => {
  assert.equal(X.detecterType(CRG, 'CRG-2026-10.pdf'), 'gerance');
  const r = X.extraireGerance(CRG);
  assert.equal(r.loyer, 780);
  assert.equal(r.provisions, 90);
  assert.equal(r.encaisse, 870);
  assert.equal(r.honoraires, 65.52);
  assert.equal(r.assurance, 21.75);
  assert.equal(r.net, 782.73);
  assert.equal(r.periode, '2026-10');
  assert.equal(r.date, '2026-11-08');
  assert.equal(r.confiance, 'bonne');
});

test('période mensuelle sous plusieurs formes', () => {
  assert.equal(X.periodeMensuelle('Gérance de mars 2026'), '2026-03');
  assert.equal(X.periodeMensuelle('Relevé du mois d’août 2025'.replace('’', "'")), '2025-08');
  assert.equal(X.periodeMensuelle('Période 02/2026'), '2026-02');
});

test('reconstitution des lignes pdf.js', () => {
  const items = [
    { str: '420,00 €', transform: [1, 0, 0, 1, 400, 700] },
    { str: 'Total', transform: [1, 0, 0, 1, 50, 701] },
    { str: 'Titre', transform: [1, 0, 0, 1, 50, 760] },
  ];
  assert.equal(X.lignesPdfJs(items), 'Titre\nTotal 420,00 €');
});

test('opérations générées depuis un document vérifié', () => {
  const a = X.operationsDepuis('appel', 'gmail:1:a.pdf', { bienId: 'x', date: '2026-10-01', libelle: 'Appel T4 2026', montant: 420, partRecuperable: 290, fondsTravaux: 40 });
  assert.equal(a.charges.length, 2);
  assert.equal(a.charges[1].categorie, 'copro_travaux');
  assert.equal(a.charges[1].source, 'gmail:1:a.pdf:fonds-travaux');
  const g = X.operationsDepuis('gerance', 'gmail:2:c.pdf', { bienId: 'x', periode: '2026-02', encaisse: 870, honoraires: 65.52, assurance: 0 });
  assert.equal(g.paiements[0].date, '2026-02-28');
  assert.equal(g.paiements[0].montant, 870);
  assert.deepEqual(g.charges.map((c) => c.categorie), ['gestion']);
});
