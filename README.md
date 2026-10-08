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
| **Quittance annuelle & attestation** | Depuis l'onglet Baux : **quittance de loyer annuelle** (récapitulatif des mois réglés, avec dates de paiement) et **attestation de paiement des loyers** à la date de votre choix (à jour / montant restant dû, 12 dernières échéances), en aperçu, impression ou **PDF téléchargeable**. Option **paiement automatique** (virement permanent) : chaque loyer est enregistré comme réglé à son échéance. |
| **Prêts** | Mensualité, assurance, différé, **tableau d'amortissement** annuel et mensuel, CRD, coût total, export CSV. |
| **Contacts** | Syndics, gestionnaires, banques, notaires, artisans… classés par rôle, recherche, liens e-mail et téléphone, filtre par bien. |
| **Fiscalité** | Estimation du résultat foncier par propriétaire : 2044 en nom propre, 2072 pour une SCI à l'IR avec la quote-part de chaque associé, base de travail pour une SCI à l'IS. |

## Base partagée Firebase (facultatif)

Sans configuration, les données restent dans le navigateur. Avec Firebase, elles sont stockées dans **votre** base Firestore : mêmes données sur tous les appareils, mises à jour **en direct**, historique de chaque version, et possibilité pour Claude de les mettre à jour à partir de vos documents.

### Mise en place (projet `location-1a379`, une fois, ~5 minutes)

Le dépôt contient déjà la configuration du projet (`.firebaserc`, `firebase.json`, `firestore.rules`) et l'identifiant de l'application Web (`1:740693444167:web:fe84267b5c447f3f875362`).

1. **Authentification** : [console Firebase](https://console.firebase.google.com/project/location-1a379/authentication/providers) → *Authentication → Commencer → Adresse e-mail/Mot de passe → Activer* (sans « lien par e-mail »).
2. **Firestore** : *Firestore Database → Créer une base de données* → édition **Standard**, identifiant `(default)`, emplacement `europe-west9 (Paris)`, **mode production**.
3. **Règles** : *Firestore Database → Règles* : collez [`firestore.rules`](firestore.rules) puis *Publier*. Elles n'autorisent que les adresses **vérifiées** listées dans `adressesAutorisees()` (Bastien et le compte de Claude ; ajoutez celle de Sophie au besoin).
4. **Clé API** : *⚙ Paramètres du projet → Général → Vos applications* : copiez la valeur `apiKey` (« AIza… »).
5. **Dans l'outil** : *Paramètres → Synchronisation Firebase* : collez la clé API, *Enregistrer la configuration*, saisissez votre e-mail et un mot de passe, puis **Créer mon compte**. Cliquez sur le lien de l'e-mail de vérification, puis sur *J'ai validé mon adresse*. Si la base est vide, vos données y sont envoyées ; si elle existe déjà, l'outil la récupère (ou vous demande laquelle garder si les deux diffèrent).

Avec le Firebase CLI (connecté à un compte propriétaire du projet), les étapes 1 et 3 se font aussi par `npx -y firebase-tools@latest deploy --only auth,firestore:rules`.

### Sécurité

- Accès réservé aux comptes e-mail/mot de passe dont l'adresse est **vérifiée** et figure dans les règles : n'importe qui peut créer un compte avec la clé API (qui n'est pas secrète), mais sans accès aux données. La vérification empêche de se faire passer pour une adresse autorisée.
- Les règles valident chaque écriture : champs attendus uniquement, version incrémentée de 1 (deux appareils ne peuvent pas s'écraser sans que l'un soit prévenu), auteur (`majPar`) égal à l'adresse connectée, heure fixée par le serveur. Suppression interdite ; chaque version est conservée dans `gestion/principal/historique`, non modifiable.
- *Mot de passe oublié* envoie un e-mail de réinitialisation.
- Dans le navigateur, les données restent chiffrées par votre mot de passe local. Dans Firestore, elles sont protégées par l'authentification et les règles (et chiffrées au repos par Google), mais **pas chiffrées de bout en bout** : c'est ce qui permet à Claude de les mettre à jour. Pour retirer cet accès, retirez son adresse des règles ou supprimez son compte dans *Authentication*.

### Mise à jour par Claude (ligne de commande)

```bash
export FIREBASE_CONFIG=AIza… FIREBASE_EMAIL=anglument.b+claude@gmail.com FIREBASE_MDP=…
node outils/firebase-maj.js inscription          # crée le compte et envoie l'e-mail de vérification
node outils/firebase-maj.js lire                 # résumé de la base
node outils/firebase-maj.js fusionner ops.json   # ajoute charges / encaissements, sans doublon
node outils/firebase-maj.js modifier script.js   # modification ciblée (script(donnees) → donnees)
node outils/firebase-maj.js remplacer d.json --oui
node outils/firebase-maj.js historique
```

Les appareils connectés reçoivent la mise à jour immédiatement, avec un bandeau « mis à jour par … ».

## Import automatique depuis Gmail

L'onglet **Import Gmail** récupère lui-même les PDF joints à vos e-mails : appels de fonds du syndic et relevés (comptes rendus) de gérance de l'agence.

1. **Connexion Google** (une fois) : créez un *ID client OAuth* de type « Application Web » dans la console Google Cloud, en activant la Gmail API (guide pas à pas dans l'onglet). L'accès est en **lecture seule** et le navigateur dialogue directement avec Google : vos e-mails ne passent par aucun autre serveur.
2. **Règles** : une par expéditeur, par exemple `from:(@mon-syndic.fr)` → appels de fonds → bien « T2 Croix-Rousse », 70 % récupérable ; pour le gestionnaire, une règle « relevés de gérance » liée à lui (proposée automatiquement d'après son e-mail). Un relevé qui regroupe plusieurs biens est réparti automatiquement, une ligne par bien (repérage par adresse, lot ou locataire).
3. **Chercher les nouveaux PDF** : l'outil lit chaque PDF (pdf.js), propose la date, les charges, le fonds travaux, le loyer encaissé, les honoraires… et reconnaît le bien si son adresse figure dans le document. Vous vérifiez, corrigez si besoin, puis importez. Les PDF déjà importés ou ignorés ne sont plus proposés.
   - **Relevés découpés par lots** (« Lot N°… / Mandat N°… ») : une ligne par bien **et par mois** (loyer + provisions), garantie loyers impayés du mois, factures imputées au lot, honoraires du relevé répartis entre les biens au prorata des recettes.
   - **Appels par rubriques** : charges courantes, fonds travaux ALUR et **travaux votés en AG** sont distingués ; la part locative indiquée par le syndic (« Locatif : … ») est reprise comme part récupérable.
   - **Bien reconnu par score** : nom du locataire et numéro d'appartement ou de lot priment sur l'adresse ou la résidence, partagées par plusieurs biens d'une même copropriété.
   - **Doublons** : une opération déjà saisie (à la main ou par un autre import : même bien, même montant, à 20 jours près ; même bail, même mois et même montant pour un loyer) n'est pas réimportée, un même PDF envoyé dans deux e-mails n'est proposé qu'une fois, et un loyer n'est jamais imputé à un bail qui n'était pas en cours.
   - **Documents signalés sans être importés** : décomptes et régularisations annuels du syndic (à saisir dans *Régularisation*), récapitulatifs annuels de l'agence, factures jointes à un relevé.

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
- `assets/cloud.js` : synchronisation Firebase (Firestore) facultative ; `outils/firebase-maj.js` : mise à jour de la base en ligne de commande ; `firestore.rules` : règles de sécurité.
- `assets/coffre.js` : chiffrement des données par mot de passe (Web Crypto), testé.
- `assets/extract.js` : lecture des montants dans le texte des appels de fonds et relevés de gérance, testée.
- `assets/gmail.js` : connexion Gmail (Google Identity Services) et lecture des PDF (pdf.js, chargé à la demande).
- `assets/app.js` : interface (JavaScript natif, sans dépendance).
- Tests : `npm test` (Node ≥ 18).

> Les calculs fiscaux sont indicatifs ; vérifiez-les avec les règles en vigueur ou votre conseiller.
