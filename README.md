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

## Développement

- `assets/calc.js` : calculs purs (prêts, échéances, régularisation, synthèses), testés.
- `assets/app.js` : interface (JavaScript natif, sans dépendance).
- Tests : `npm test` (Node ≥ 18).

> Les calculs fiscaux sont indicatifs ; vérifiez-les avec les règles en vigueur ou votre conseiller.
