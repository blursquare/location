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
