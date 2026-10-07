# Gestion locative en copropriété

Application web autonome pour gérer des biens loués situés en copropriété : **loyers, charges, régularisation, prêts et revenus fonciers**.

Aucune installation ni serveur : ouvrez `index.html` dans un navigateur. Les données sont enregistrées **dans le navigateur** (localStorage) ; utilisez *Paramètres → Exporter* pour sauvegarder ou transférer vos données (fichier JSON).

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
- `assets/app.js` : interface (JavaScript natif, sans dépendance).
- Tests : `npm test` (Node ≥ 18).

> Les calculs fiscaux sont indicatifs ; vérifiez-les avec les règles en vigueur ou votre conseiller.
