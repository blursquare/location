#!/usr/bin/env node
/*
 * Contrôle des opérations importées depuis Gmail par l'outil (sources « gmail:… »).
 * Sert à Claude pour vérifier, après chaque import fait dans l'application, que les PDF
 * ont été correctement lus et rangés.
 *
 * Mêmes variables d'environnement que firebase-maj.js (FIREBASE_CONFIG, FIREBASE_EMAIL, FIREBASE_MDP…).
 *
 * Commandes :
 *   liste                     documents importés non encore vérifiés, avec leurs opérations (JSON)
 *   controle [dossier-pdf]    contrôles de cohérence ; si un dossier est donné, relit chaque PDF
 *                             (fichier « <idMessage>__<nom du PDF> ») et compare avec ce qui a été importé
 *   valider [source…]         marque comme vérifiés les documents donnés (tous si aucun)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Calc = require('../assets/calc.js');
const Extract = require('../assets/extract.js');
const { client } = require('./firebase-maj.js');

const baseSource = (s) => String(s || '').split(':').slice(0, 3).join(':').split('#')[0];
const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
const egal = (a, b) => Math.abs(r2(a) - r2(b)) < 0.011;

/** Documents (une source Gmail = un PDF) dont des opérations ne sont pas encore vérifiées. */
function documentsAVerifier(d) {
  const docs = new Map();
  for (const [type, liste] of [['charge', d.charges || []], ['paiement', d.paiements || []]]) {
    for (const op of liste) {
      if (!String(op.source || '').startsWith('gmail:') || op.verifie) continue;
      const src = baseSource(op.source);
      const [, msgId, ...nom] = src.split(':');
      if (!docs.has(src)) docs.set(src, { source: src, msgId, fichier: nom.join(':'), operations: [] });
      docs.get(src).operations.push({ type, ...op });
    }
  }
  return [...docs.values()];
}

/** Contrôles de cohérence d'une opération importée, sans relire le PDF. */
function anomalies(d, op, aujourdHui = new Date().toISOString().slice(0, 10)) {
  const out = [];
  if (op.type === 'paiement') {
    const bail = (d.baux || []).find((b) => b.id === op.bailId);
    if (!bail) return ['bail introuvable'];
    const bien = (d.biens || []).find((b) => b.id === bail.bienId) || {};
    if (bail.dateDebut.slice(0, 7) > op.periode || (bail.dateFin && bail.dateFin.slice(0, 7) < op.periode)) out.push(`loyer de ${op.periode} hors de la période du bail de ${bail.locataire}`);
    const [e] = Calc.situationBail(bail, d.paiements, op.periode, op.periode);
    if (e && e.paye > e.du + 0.01) out.push(`${op.periode} : ${e.paye} € encaissés pour ${e.du} € dus (doublon ou mauvais mois ?)`);
    const autres = d.paiements.filter((p) => p.id !== op.id && p.bailId === op.bailId && p.periode === op.periode && (p.nature || 'loyer') === (op.nature || 'loyer') && egal(p.montant, op.montant));
    if (autres.length) out.push(`doublon possible : même montant déjà enregistré pour ${bail.locataire} en ${op.periode}`);
    if (bien.dateAchat && op.periode < bien.dateAchat.slice(0, 7)) out.push(`loyer antérieur à l'achat de ${bien.nom}`);
  } else {
    const bien = (d.biens || []).find((b) => b.id === op.bienId);
    if (!bien) return ['bien introuvable'];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(op.date || '')) out.push('date absente ou invalide');
    else {
      const debut = bien.dateAchat ? new Date(Date.parse(bien.dateAchat) - 120 * 864e5).toISOString().slice(0, 10) : '2000-01-01';
      const fin = new Date(Date.parse(aujourdHui) + 400 * 864e5).toISOString().slice(0, 10);
      if (op.date < debut || op.date > fin) out.push(`date ${op.date} peu plausible pour ${bien.nom}`);
    }
    if (Number(op.partRecuperable) > Number(op.montant) + 0.01) out.push('part récupérable supérieure au montant');
    if (Number(op.montant) < 0 && !/r[ée]gul|cr[ée]dit|avoir|rembours/i.test(op.libelle || '')) out.push('montant négatif inattendu');
    const autre = d.charges.find((c) => c.id !== op.id && c.bienId === op.bienId && (c.categorie || 'copro') === (op.categorie || 'copro') && egal(c.montant, op.montant) && c.date && op.date && Math.abs(Date.parse(c.date) - Date.parse(op.date)) <= 20 * 864e5);
    if (autre) out.push(`doublon possible avec « ${autre.libelle} » du ${autre.date}`);
  }
  return out;
}

/** Texte d'un PDF tel que l'outil le lit (pdf.js + Extract.lignesPdfJs). Nécessite pdfjs-dist 3.11.174. */
async function textePdf(fichier) {
  let pdfjs;
  try {
    pdfjs = require(path.join(process.env.PDFJS_DIR || 'pdfjs-dist', 'legacy/build/pdf.js'));
  } catch (e) {
    throw new Error('pdfjs-dist introuvable : npm install --no-save pdfjs-dist@3.11.174 (ou PDFJS_DIR)');
  }
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(fichier)), verbosity: 0 }).promise;
  const pages = [];
  for (let i = 1; i <= Math.min(doc.numPages, 6); i++) pages.push(Extract.lignesPdfJs((await (await doc.getPage(i)).getTextContent()).items));
  return pages.join('\n');
}

/** Compare les opérations importées d'un document avec une nouvelle lecture de son texte. */
function comparer(d, doc, texte) {
  const ecarts = [];
  const type = Extract.detecterType(texte, doc.fichier);
  if (['decompte', 'recap', 'facture'].includes(type)) {
    ecarts.push(`document de type « ${type} » : il n'aurait pas dû être importé comme opération`);
    return ecarts;
  }
  const e = Extract.extraire(texte, type === 'gerance' ? 'gerance' : 'appel', doc.fichier);
  const sansAcc = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (e.lots) {
    for (const op of doc.operations.filter((o) => o.type === 'paiement')) {
      const bail = d.baux.find((b) => b.id === op.bailId);
      const nom = sansAcc(bail ? bail.locataire : '').split(/\s+/).filter((x) => x.length >= 4).pop();
      const lot = e.lots.find((l) => nom && sansAcc(l.texte).includes(nom));
      if (!lot) {
        ecarts.push(`${bail ? bail.locataire : op.bailId} ${op.periode} : ce locataire n'apparaît pas dans le relevé (bien mal attribué ?)`);
        continue;
      }
      const mois = lot.mois.find((m) => m.periode === op.periode);
      if (!mois) ecarts.push(`${bail.locataire} : mois ${op.periode} absent du relevé`);
      else if (!egal(mois.loyer + mois.provisions, op.montant)) ecarts.push(`${bail.locataire} ${op.periode} : ${op.montant} € importés, ${r2(mois.loyer + mois.provisions)} € dans le relevé`);
    }
    const totalHono = doc.operations.filter((o) => o.type === 'charge' && o.categorie === 'gestion' && /honoraires de gestion/i.test(o.libelle)).reduce((t, o) => t + Number(o.montant), 0);
    if (e.honoraires !== null && totalHono && !egal(totalHono, e.honoraires)) ecarts.push(`honoraires : ${r2(totalHono)} € importés, ${e.honoraires} € dans le relevé`);
  } else if (e.type === 'appel') {
    const charges = doc.operations.filter((o) => o.type === 'charge');
    const total = charges.reduce((t, o) => t + Number(o.montant), 0);
    if (e.total !== null && !egal(total, e.total)) ecarts.push(`appel : ${r2(total)} € importés au total, ${e.total} € dans le document`);
    const tri = e.trimestre;
    for (const c of charges) {
      if (tri && /T[1-4] \d{4}/.test(c.libelle) && !c.libelle.includes(`T${tri.n} ${tri.annee}`)) ecarts.push(`« ${c.libelle} » : le document concerne le T${tri.n} ${tri.annee}`);
    }
  }
  return ecarts;
}

async function principal(argv) {
  const [commande, ...args] = argv;
  if (!['liste', 'controle', 'valider'].includes(commande)) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 15).join('\n').replace(/^ \* ?/gm, ''));
    return 1;
  }
  const c = client();
  await c.connexion();
  const actuel = await c.lire();
  if (!actuel || !actuel.json) throw new Error('la base est vide');
  const d = Calc.migrer(JSON.parse(actuel.json));
  const docs = documentsAVerifier(d);
  if (commande === 'liste') {
    console.log(JSON.stringify({ version: actuel.version, majPar: actuel.majPar, majLe: actuel.majLe, documents: docs }, null, 1));
    return 0;
  }
  if (commande === 'controle') {
    const dossier = args[0];
    let problemes = 0;
    console.log(`Base version ${actuel.version} (${actuel.majPar || '?'}, ${actuel.majLe || '?'}) : ${docs.length} document(s) importé(s) à vérifier.`);
    for (const doc of docs) {
      const lignes = [];
      for (const op of doc.operations) for (const a of anomalies(d, op)) lignes.push(a);
      const pdf = dossier && path.join(dossier, `${doc.msgId}__${doc.fichier.replace(/[^\w.\- ]/g, '_')}`);
      if (pdf && fs.existsSync(pdf)) for (const ecart of comparer(d, doc, await textePdf(pdf))) lignes.push(ecart);
      else if (dossier) lignes.push('PDF non relu (fichier absent du dossier)');
      const resume = doc.operations.map((o) => (o.type === 'paiement' ? `loyer ${o.periode} ${o.montant} €` : `${o.libelle} ${o.montant} €`)).join(' · ');
      console.log(`\n${lignes.length ? '⚠' : '✓'} ${doc.fichier} [${doc.msgId}]\n   ${resume}`);
      for (const l of [...new Set(lignes)]) console.log(`   - ${l}`);
      if (lignes.some((l) => !/^PDF non relu/.test(l))) problemes++;
    }
    console.log(`\n${problemes} document(s) avec anomalie.`);
    return problemes ? 2 : 0;
  }
  // valider
  const cibles = new Set(args.length ? args : docs.map((x) => x.source));
  let n = 0;
  const date = new Date().toISOString().slice(0, 10);
  for (const op of [...d.charges, ...d.paiements]) {
    if (String(op.source || '').startsWith('gmail:') && !op.verifie && cibles.has(baseSource(op.source))) {
      op.verifie = date;
      n++;
    }
  }
  if (!n) return console.log('Rien à valider.'), 0;
  const v = await c.ecrire(d, actuel);
  console.log(`${n} opération(s) marquée(s) comme vérifiées (base version ${v}).`);
  return 0;
}

if (require.main === module) {
  principal(process.argv.slice(2))
    .then((code) => process.exit(code || 0))
    .catch((e) => {
      console.error(`Erreur : ${e.message}`);
      process.exit(1);
    });
}
module.exports = { documentsAVerifier, anomalies, comparer, baseSource };
