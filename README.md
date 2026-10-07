# Gestion locative en copropriété

Application web autonome pour gérer des biens loués situés en copropriété : **loyers, charges, régularisation, prêts et revenus fonciers**.

Aucune installation ni serveur : ouvrez `index.html` dans un navigateur, ou la version en ligne (GitHub Pages).

## Mot de passe et confidentialité

- Au premier lancement, l'outil demande de **choisir un mot de passe**. Toutes les données sont **chiffrées** avec lui (AES-256-GCM, clé dérivée par PBKDF2-SHA256) avant d'être enregistrées dans le navigateur ; elles ne sont déchiffrées qu'en mémoire, le temps de la session.
- L'outil se **verrouille** via le bouton 🔒 ou après 15 minutes d'inactivité.
- Les sauvegardes exportées (*Paramètres → Exporter*) sont chiffrées avec le même mot de passe.
- **Un mot de passe oublié ne peut pas être récupéré** : sans lui, les données et sauvegardes sont illisibles.
- Le site publié ne contient que le code : aucune donnée personnelle n'est envoyée sur GitHub ni ailleurs.

## Fonctionnalités

| Module | Contenu |
|---|---|
| **Tableau de bord** | Encaissements, impayés à date, charges, échéances de prêt, cash-flow, capital restant dû, rendements brut et net, alertes (révision IRL, fin de bail, régularisation). |
| **Biens** | Adresse, lots, surface, copropriété, syndic, tantièmes, prix d'achat et frais. |
| **Locataires & baux** | Loyer HC, provision sur charges, dépôt de garantie, garant, IRL de référence ; calcul de la **révision IRL**. |
| **Loyers** | Grille mensuelle par bail (payé / partiel / impayé), prorata automatique à l'entrée et à la sortie, encaissement groupé, **quittances**, reçus partiels et **avis d'échéance** imprimables (PDF). |
| **Charges** | Appels de fonds du syndic (génération trimestrielle avec fonds travaux ALUR), taxe foncière, PNO, travaux… avec la **part récupérable** ; **régularisation annuelle** par locataire et décompte imprimable. |
| **Prêts** | Mensualité, assurance, différé, **tableau d'amortissement** annuel et mensuel, CRD, coût total, export CSV. |
| **Fiscalité** | Estimation du résultat foncier (régime réel, repères de la déclaration 2044) et comparaison avec le micro-foncier. |

## Import automatique depuis Gmail

L'onglet **Import Gmail** récupère lui-même les PDF joints à vos e-mails : appels de fonds du syndic et relevés (comptes rendus) de gérance de l'agence.

1. **Connexion Google** (une fois) : créez un *ID client OAuth* de type « Application Web » dans la console Google Cloud, en activant la Gmail API (guide pas à pas dans l'onglet). L'accès est en **lecture seule** et le navigateur dialogue directement avec Google : vos e-mails ne passent par aucun autre serveur.
2. **Règles** : une par expéditeur, par exemple `from:(@mon-syndic.fr)` → appels de fonds → bien « T2 Croix-Rousse », 70 % récupérable.
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
- `assets/coffre.js` : chiffrement des données par mot de passe (Web Crypto), testé.
- `assets/extract.js` : lecture des montants dans le texte des appels de fonds et relevés de gérance, testée.
- `assets/gmail.js` : connexion Gmail (Google Identity Services) et lecture des PDF (pdf.js, chargé à la demande).
- `assets/app.js` : interface (JavaScript natif, sans dépendance).
- Tests : `npm test` (Node ≥ 18).

> Les calculs fiscaux sont indicatifs ; vérifiez-les avec les règles en vigueur ou votre conseiller.
