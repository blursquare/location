const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../assets/annuaire.js');

test("normalisation d'une SCI de l'API Recherche d'entreprises", () => {
  const e = A.normaliserEntreprise({
    siren: '398599324',
    nom_complet: 'SCI LES CANUTS',
    nom_raison_sociale: 'SCI LES CANUTS',
    nature_juridique: '6540',
    date_creation: '1994-09-25',
    etat_administratif: 'A',
    siege: { numero_voie: '3', type_voie: 'RUE', libelle_voie: 'JUSTIN GODART', code_postal: '69004', libelle_commune: 'LYON', complement_adresse: 'MR COLOMBAT' },
    dirigeants: [
      { nom: 'DUPONT', prenoms: 'MARIE ANNE', qualite: 'Associé', type_dirigeant: 'personne physique' },
      { nom: 'MARTIN', prenoms: 'JEAN-PIERRE LOUIS', qualite: 'Gérant', type_dirigeant: 'personne physique' },
    ],
  });
  assert.equal(e.nom, 'SCI LES CANUTS');
  assert.equal(e.adresse, 'Mr Colombat\n3 rue Justin Godart\n69004 Lyon');
  assert.equal(e.adresseLigne, '3 rue Justin Godart, 69004 Lyon');
  assert.equal(e.gerant, 'Jean-Pierre MARTIN');
  assert.equal(e.estSCI, true);
  assert.equal(e.active, true);
});

test('dirigeant personne morale et société cessée', () => {
  const e = A.normaliserEntreprise({ siren: '1', nom_complet: 'X', etat_administratif: 'C', siege: {}, dirigeants: [{ denomination: 'HOLDING Y', qualite: 'Président de SAS', type_dirigeant: 'personne morale' }] });
  assert.equal(e.gerant, 'HOLDING Y');
  assert.equal(e.active, false);
  assert.equal(e.estSCI, false);
});

test('capitalisation des libellés', () => {
  assert.equal(A.capitaliser('SAINT GENIS LES OLLIERES'), 'Saint Genis les Ollieres');
  assert.equal(A.capitaliser("CHEMIN DE L'ETANG"), "Chemin de l'Etang");
  assert.ok(A.sirenValide('398 599 324'));
  assert.ok(!A.sirenValide('39859932'));
});

test('suggestion d’adresse : numéro conservé si seule la voie est connue', () => {
  const rue = { name: 'Chemin des Vignes', postcode: '69130', city: 'Écully', type: 'street' };
  assert.equal(A.suggestionAdresse(rue, '17 bis chemin des vignes').ligne1, '17 bis Chemin des Vignes');
  assert.equal(A.suggestionAdresse({ ...rue, name: '17 Chemin des Vignes', type: 'housenumber' }, '17 chemin').label, '17 Chemin des Vignes 69130 Écully');
  assert.equal(A.suggestionAdresse(rue, 'chemin des vignes').ligne1, 'Chemin des Vignes');
});
