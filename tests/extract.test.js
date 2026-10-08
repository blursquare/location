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

const CRG_MULTI = `AGENCE IMMO GESTION — Compte rendu de gérance
Mandant : SCI LES CANUTS
Relevé de gérance d'octobre 2026
Lot 14 — 12 rue d'Austerlitz — Locataire : Marie MARTIN
Loyer principal                                 780,00
Provision sur charges                            90,00
Honoraires TTC                                   65,52
Lot 7 — 45 rue Garibaldi — Locataire : Lucas BERNARD
Loyer principal                                 560,00
Provision sur charges                            45,00
Honoraires TTC                                   45,50
TOTAL NET À VOUS VERSER                       1 274,98
Virement effectué le 08/11/2026`;

test('relevé de gérance multi-biens', () => {
  const r = X.extraireGeranceMulti(CRG_MULTI, [
    { id: 'x', motifs: ["rue d'austerlitz", 'martin'] },
    { id: 'y', motifs: ['rue garibaldi', 'bernard'] },
    { id: 'z', motifs: ['chemin des vignes'] },
  ]);
  assert.equal(r.length, 2);
  assert.deepEqual(r.map((l) => [l.bienId, l.loyer, l.provisions, l.honoraires, l.periode, l.date]), [
    ['x', 780, 90, 65.52, '2026-10', '2026-11-08'],
    ['y', 560, 45, 45.5, '2026-10', '2026-11-08'],
  ]);
  assert.deepEqual(X.extraireGeranceMulti(CRG_MULTI, [{ id: 'x', motifs: ['martin'] }]), []);
});

test('relevé de gérance découpé par lots (plusieurs biens et plusieurs mois)', () => {
  const texte = `RELEVÉ DE GÉRANCE
LA CHAUSSEE ST VICTOR, le 20/10/2025
Lot N°012101 / Mandat N°16 Adresse : Résidence Les Tilleuls Appt B 01 2, rue des Lilas
DUPONT Éric (01210101) depuis le 25/09/2024
Règlements Début Fin Dépenses Recettes
LOYER 01/09/2025 30/09/2025 0,00 470,00
PROVISIONS SUR CHARGES 01/09/2025 30/09/2025 0,00 70,00
LOYER 01/10/2025 31/10/2025 0,00 474,89
PROVISIONS SUR CHARGES 01/10/2025 31/10/2025 0,00 70,00
Assurances Début Dépenses Recettes
Assurance Garantie Loyers Impayés 01/09/2025 13,50 0,00
Assurance Garantie Loyers Impayés 01/10/2025 13,62 0,00
Factures liées au lot Début Fin Dépenses Recettes
délesteur-2arc 18/09/2025 513,19 0,00
Total du Lot N°012101 540,31 1 084,89
Lot N°012102 / Mandat N°367 Adresse : 12 Rue Descartes Appartement A108
MARTIN Lou (01210201) depuis le 22/09/2025
Règlements Début Fin Dépenses Recettes
LOYER 22/09/2025 30/09/2025 0,00 169,50
PROVISIONS SUR CHARGES 22/09/2025 30/09/2025 0,00 19,50
Factures liées au lot Début Fin Dépenses Recettes
Hono mise en place GLI 18/09/2025 48,00 0,00
Total du Lot N°012102 48,00 189,00
Totaux 588,31 1 273,89
Honoraires T.T.C. 91,72
A vous verser 593,86 €`;
  assert.equal(X.detecterType(texte, 'Reddition6273.pdf'), 'gerance');
  const r = X.extraire(texte, 'gerance');
  assert.equal(r.lots.length, 2);
  assert.equal(r.date, '2025-10-20');
  assert.equal(r.net, 593.86);
  const [a, b] = r.lots;
  assert.deepEqual(a.mois, [{ periode: '2025-09', loyer: 470, provisions: 70 }, { periode: '2025-10', loyer: 474.89, provisions: 70 }]);
  assert.deepEqual(a.assurances, { '2025-09': 13.5, '2025-10': 13.62 });
  assert.deepEqual(a.factures, [{ libelle: 'délesteur-2arc', date: '2025-09-18', montant: 513.19 }]);
  assert.equal(a.recettes, 1084.89); // le n° de lot n'est pas pris pour un montant
  assert.equal(a.depenses, 540.31);
  assert.deepEqual(b.factures.map((f) => f.montant), [48]); // facture « GLI » : pas une cotisation d'assurance
  assert.deepEqual(b.assurances, {});
  assert.equal(Math.round((a.honoraires + b.honoraires) * 100) / 100, 91.72);
  assert.equal(a.honoraires, 78.11); // au prorata des recettes
});

test('appel de fonds par rubriques : charges courantes, travaux votés, fonds ALUR', () => {
  const texte = `PROVISIONS
Copropriété : LES TILLEULS
Orléans, le 29/06/2026
Base de calcul Date édition Période Références Exigible le Avance trésorerie 0,00
Budget 29/06/2026 01/07/2026 - 30/09/2026 S.1624.00004 01/07/2026
Appel n°3 : CHARGES COURANTES
CHARGES COMMUNES GENERALES 5.293,45 9989 136 72,09
Total du groupe de lots 196,22
Total appel Copropriétaire 196,22
Appel n°1 : POSE VIDEO-SURVEILLANCE
POSE VIDEO-SURVEILLANCE 2.637,94 9989 136 35,91
Total appel Copropriétaire 35,91
Appel n°2 : Fonds pour travaux ALUR
CHARGES COMMUNES GENERALES 1.225,00 10000 103 12,62
Total appel Copropriétaire 12,62
Total des appels 244,75`;
  const r = X.extraireAppel(texte);
  assert.equal(r.total, 244.75);
  assert.equal(r.fondsTravaux, 12.62);
  assert.deepEqual(r.travauxVotes, { montant: 35.91, libelle: 'pose video-surveillance' });
  assert.deepEqual(r.trimestre, { n: 3, annee: 2026 });
  assert.equal(r.travaux, false);
});

test('appel de fonds : part locative, fonds ALUR en colonne, pas de date à 2 chiffres', () => {
  const texte = `Carte professionnelle délivrée par la CCI le 23/05/17
Appel de Fonds
Blois, le 23/06/2026
Période du 01/07/2026 au 30/09/2026
Postes à répartir Total Base Tantièmes Quote-part Locatif
GENERALES 28 625,25 10 000 94 269,08 145,26
FONDS TRAVAUX ALUR 1 818,00 10 000 94 17,09 0,00
Montant de l'appel de fonds 393,57 €
Locatif : 237,56 Solde antérieur 4,85`;
  const r = X.extraireAppel(texte);
  assert.equal(r.total, 393.57);
  assert.equal(r.fondsTravaux, 17.09);
  assert.equal(r.recuperable, 237.56);
  assert.equal(r.date, '2026-07-01');
});

test('documents à ne pas importer comme appels ou relevés', () => {
  assert.equal(X.detecterType('DECOMPTE DE CHARGES DEFINITIF 2025 copropriété', '2025DEC.pdf'), 'decompte');
  assert.equal(X.detecterType('Regularisation charges courantes au 31/03/2026', 'RG_CC.pdf'), 'decompte');
  assert.equal(X.detecterType('Historique des redditions', 'HistoriqueReddition_2026.pdf'), 'recap');
  assert.equal(X.detecterType('Facture n° 2025-281 honoraires', 'Fac 2025-281 - Honoraires.pdf'), 'facture');
  assert.equal(X.extraire('x', 'decompte').type, 'decompte');
});
