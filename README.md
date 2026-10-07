# Gestion locative

Application web autonome pour gérer des biens loués — détenus en **SCI** ou en nom propre, gérés **en direct ou par une agence**, **en copropriété ou non** : loyers, charges, régularisation, prêts et revenus fonciers.

Aucune installation ni serveur : ouvrez `index.html` dans un navigateur, ou la version en ligne (GitHub Pages).

## Mot de passe et confidentialité

- Au premier lancement, l'outil demande de **choisir un mot de passe**. Toutes les données sont **chiffrées** avec lui (AES-256-GCM, clé dérivée par PBKDF2-SHA256) avant d'être enregistrées dans le navigateur ; elles ne sont déchiffrées qu'en mémoire, le temps de la session.
- L'outil se **verrouille** via le bouton 🔒 ou après 15 minutes d'inactivité.
- Les sauvegardes exportées (*Paramètres → Exporter*) sont chiffrées avec le même mot de passe.
- **Lien d'import** : `…/location/#import=<données compressées>` ouvre l'outil, demande le mot de passe puis une confirmation, et enregistre les données (chiffrées). La partie après `#` n'est jamais envoyée au serveur, et l'outil l'efface de l'adresse dès l'ouverture. Un tel lien contient des données personnelles : ne le partagez pas.
- **Un mot de passe oublié ne peut pas être récupéré** : sans lui, les données et sauvegardes sont illisibles.
- Les aides à la saisie n'envoient que le texte recherché (début d'adresse, SIREN ou nom de société) aux services publics `data.geopf.fr` et `recherche-entreprises.api.gouv.fr` ; aucune autre donnée ne quitte le navigateur, hormis l'import Gmail (dialogue direct avec Google).
- Le site publié ne contient que le code : aucune donnée personnelle n'est envoyée sur GitHub ni ailleurs.
- Le site demande aux moteurs de recherche de **ne pas l'indexer** (balises `noindex, nofollow, noarchive`). GitHub Pages ne permet pas d'en interdire l'accès : qui connaît l'adresse voit l'écran de mot de passe, jamais vos données.

## Fonctionnalités

| Module | Contenu |
|---|---|
| **Tableau de bord** | Vue globale, par SCI ou par mode de gestion : encaissements, impayés à date, charges, échéances de prêt, cash-flow, capital restant dû, rendements brut et net, alertes (révision IRL, fin de bail, régularisation). |
| **Biens** | Propriétaire (SCI à l'IR / à l'IS, nom propre, indivision, avec associés et parts), gestion directe ou par un gestionnaire, copropriété (syndic, lots, tantièmes) ou non, prix d'achat et frais. |
| **Aides à la saisie** | Adresses proposées pendant la frappe (Base Adresse Nationale) ; fiche d'une SCI ou d'un gestionnaire remplie à partir de son **SIREN**, SIRET ou nom (API Recherche d'entreprises) : dénomination, siège, dirigeant, forme. |
| **Locataires & baux** | Loyer HC, provision sur charges, dépôt de garantie, garant, IRL de référence ; **historique du loyer** (révisions IRL, ajustement des provisions) appliqué à partir de sa date d'effet sans modifier les mois passés. |
| **Loyers** | Grille mensuelle par bail (payé / partiel / impayé), prorata automatique à l'entrée et à la sortie, encaissement groupé, **quittances**, reçus partiels et **avis d'échéance** imprimables (PDF). |
| **Charges** | Charges payées en direct (bien hors copropriété), appels de fonds du syndic (génération trimestrielle avec fonds travaux ALUR), taxe foncière, PNO, travaux… avec la **part récupérable** ; **régularisation annuelle** par locataire et décompte imprimable. |
| **Régularisation** | Régularisation annuelle des charges par locataire, à partir du décompte du syndic (exercice approuvé en AG) ou, à défaut, des appels de fonds ; charges payées en direct pour un bien hors copropriété ; **remboursement de la TEOM** (taxe d'ordures ménagères de l'avis de taxe foncière) au prorata de l'occupation ; décompte imprimable et suivi des règlements, distincts des loyers. |
| **Prêts** | Mensualité, assurance, différé, **tableau d'amortissement** annuel et mensuel, CRD, coût total, export CSV. |
| **Fiscalité** | Estimation du résultat foncier par propriétaire : 2044 en nom propre, 2072 pour une SCI à l'IR avec la quote-part de chaque associé, base de travail pour une SCI à l'IS. |

## Import automatique depuis Gmail

L'onglet **Import Gmail** récupère lui-même les PDF joints à vos e-mails : appels de fonds du syndic et relevés (comptes rendus) de gérance de l'agence.

1. **Connexion Google** (une fois) : créez un *ID client OAuth* de type « Application Web » dans la console Google Cloud, en activant la Gmail API (guide pas à pas dans l'onglet). L'accès est en **lecture seule** et le navigateur dialogue directement avec Google : vos e-mails ne passent par aucun autre serveur.
2. **Règles** : une par expéditeur, par exemple `from:(@mon-syndic.fr)` → appels de fonds → bien « T2 Croix-Rousse », 70 % récupérable ; pour le gestionnaire, une règle « relevés de gérance » liée à lui (proposée automatiquement d'après son e-mail). Un relevé qui regroupe plusieurs biens est réparti automatiquement, une ligne par bien (repérage par adresse, lot ou locataire).
3. **Chercher les nouveaux PDF** : l'outil lit chaque PDF (pdf.js), propose la date, les charges, le fonds travaux, le loyer encaissé, les honoraires… et reconnaît le bien si son adresse figure dans le document. Vous vérifiez, corrigez si besoin, puis importez. Les PDF déjà importés ou ignorés ne sont plus proposés.

Google n'accepte pas la connexion depuis un fichier ouvert directement (`file://`) : utilisez la version en ligne, ou lancez `python3 -m http.server 8000` dans le dossier puis ouvrez `http://localhost:8000` (origine à déclarer dans l'ID client).

Les PDF scannés (images sans texte) ne peuvent pas être lus : les montants se saisissent alors à la main dans l'écran de vérification.

## Importer des opérations (syndic, gérance)

*Paramètres → Importer des opérations* ajoute des charges et des encaissements **sans écraser** les données existantes. Chaque opération porte une `source` unique (ex. identifiant du mail d'origine) : un même fichier importé deux fois ne crée pas de doublon.

```json
{
  "charges": [
    { "bien": "T2 Croix-Rousse", "date": "2026-10-01", "categorie": "copro",
      "libelle": "Appel de fonds T4 2026", "montant": 420, "partRecuperable": 290,
      "source": "gmail:18f2a…" }
  ],
  "paiements": [
    { "locataire": "Marie Martin", "periode": "2026-10", "montant": 870,
      "date": "2026-10-08", "note": "Relevé de gérance octobre", "source": "gmail:18f2b…" }
  ]
}
```

- `bien` : nom du bien (ou son identifiant) ; `locataire` : nom du locataire (le bail actif sur la période est retenu).
- `categorie` : `copro`, `copro_travaux`, `taxe_fonciere`, `assurance_pno`, `gestion`, `travaux`, `amelioration`, `autre`.
- Relevé de gérance : le loyer encaissé par l'agence va dans `paiements`, les honoraires dans `charges` (catégorie `gestion`).

## Mise en ligne (GitHub Pages)

Le workflow `.github/workflows/pages.yml` teste puis publie le site à chaque push sur `main`. À activer une fois dans *Settings → Pages → Source : GitHub Actions*. Seul le code est publié ; les données restent dans le navigateur de chacun.

## Développement

- `assets/calc.js` : calculs purs (prêts, échéances, régularisation, synthèses), testés.
- `assets/annuaire.js` : recherche d'adresses et de sociétés (SIREN) dans les référentiels publics, testée.
- `assets/coffre.js` : chiffrement des données par mot de passe (Web Crypto), testé.
- `assets/extract.js` : lecture des montants dans le texte des appels de fonds et relevés de gérance, testée.
- `assets/gmail.js` : connexion Gmail (Google Identity Services) et lecture des PDF (pdf.js, chargé à la demande).
- `assets/app.js` : interface (JavaScript natif, sans dépendance).
- Tests : `npm test` (Node ≥ 18).

> Les calculs fiscaux sont indicatifs ; vérifiez-les avec les règles en vigueur ou votre conseiller.
