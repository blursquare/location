const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../assets/calc.js');
const V = require('../outils/verifier-imports.js');

const base = () =>
  C.migrer({
    biens: [{ id: 'b1', nom: 'Appt B01', dateAchat: '2025-01-28' }, { id: 'b2', nom: 'Appt C01', dateAchat: '2026-02-05' }],
    baux: [
      { id: 'l1', bienId: 'b1', locataire: 'Éric BLONDEAU', dateDebut: '2025-01-28', loyerHC: 474.89, provisionCharges: 75 },
      { id: 'l2', bienId: 'b2', locataire: 'François FROGER', dateDebut: '2026-02-13', loyerHC: 440, provisionCharges: 60 },
    ],
    paiements: [
      { id: 'p0', bailId: 'l1', periode: '2026-09', montant: 549.89, date: '2026-09-20' },
      { id: 'p1', bailId: 'l1', periode: '2026-09', montant: 549.89, date: '2026-09-18', source: 'gmail:m1:Reddition1.pdf#b1:2026-09:0' },
      { id: 'p2', bailId: 'l2', periode: '2025-06', montant: 540, date: '2025-06-19', source: 'gmail:m2:Reddition2.pdf#b2' },
      { id: 'p3', bailId: 'l2', periode: '2026-09', montant: 500, date: '2026-09-18', source: 'gmail:m3:Reddition3.pdf', verifie: '2026-10-01' },
    ],
    charges: [
      { id: 'c1', bienId: 'b1', categorie: 'copro', libelle: 'Appel de fonds T3 2026', date: '2017-05-23', montant: 375.76, partRecuperable: 237.56, source: 'gmail:m4:ADF.pdf' },
      { id: 'c2', bienId: 'b1', categorie: 'gestion', libelle: 'Honoraires de gestion 2026-09', date: '2026-09-18', montant: -10, source: 'gmail:m1:Reddition1.pdf#b1:honoraires' },
    ],
  });

test('vérification des imports Gmail : documents à vérifier et anomalies', () => {
  const d = base();
  const docs = V.documentsAVerifier(d);
  assert.deepEqual(docs.map((x) => x.source).sort(), ['gmail:m1:Reddition1.pdf', 'gmail:m2:Reddition2.pdf', 'gmail:m4:ADF.pdf']);
  const op = (id) => ({ type: id.startsWith('p') ? 'paiement' : 'charge', ...[...d.paiements, ...d.charges].find((x) => x.id === id) });
  assert.ok(V.anomalies(d, op('p1'), '2026-10-08').some((a) => /doublon/.test(a)));
  assert.ok(V.anomalies(d, op('p1'), '2026-10-08').some((a) => /encaissés pour/.test(a)));
  assert.ok(V.anomalies(d, op('p2'), '2026-10-08').some((a) => /hors de la période du bail/.test(a)));
  assert.ok(V.anomalies(d, op('c1'), '2026-10-08').some((a) => /peu plausible/.test(a)));
  assert.ok(V.anomalies(d, op('c2'), '2026-10-08').some((a) => /négatif/.test(a)));
});

test('vérification : comparaison avec une relecture du relevé', () => {
  const d = base();
  const doc = V.documentsAVerifier(d).find((x) => x.msgId === 'm2');
  const texte = `RELEVÉ DE GÉRANCE
LA CHAUSSEE ST VICTOR, le 19/06/2025
Lot N°012101 / Mandat N°16 Adresse : Résidence Terre des Rois Appt B 01
BLONDEAU Éric (01210101)
Règlements Début Fin Dépenses Recettes
LOYER 01/06/2025 30/06/2025 0,00 470,00
PROVISIONS SUR CHARGES 01/06/2025 30/06/2025 0,00 70,00
Total du Lot N°012101 0,00 540,00
Honoraires T.T.C. 38,88`;
  const e = V.comparer(d, doc, texte);
  assert.ok(e.some((x) => /n'apparaît pas dans le relevé/.test(x)), e.join(' | '));
});
