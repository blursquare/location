/* Interface de gestion locative — données stockées dans le navigateur (localStorage). */
(function () {
  'use strict';
  const C = window.Calc;
  const STORE_KEY = 'gestion-location-v1';
  const MOIS = ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'];
  const MODES = ['Virement', 'Prélèvement', 'Chèque', 'Espèces', 'CAF / APL', 'Autre'];

  // ---------- Données ----------
  const empty = () => ({
    version: 1,
    bailleur: { nom: '', adresse: '' },
    gmail: { clientId: '', regles: [], ignores: [] },
    biens: [],
    baux: [],
    paiements: [],
    charges: [],
    prets: [],
  });

  // Les données sont chiffrées avec le mot de passe (voir coffre.js) et ne sont
  // déchiffrées qu'en mémoire, le temps de la session.
  const VAULT_KEY = 'gestion-location-coffre-v1';
  const VERROU_MINUTES = 15;
  const lireLocal = (k) => {
    try {
      return localStorage.getItem(k);
    } catch (e) {
      return null;
    }
  };
  let db = empty();
  let cle = null;
  let enregistrements = Promise.resolve();
  let enCours = 0;
  function save() {
    if (!cle) return;
    const instantane = JSON.parse(JSON.stringify(db));
    const c = cle;
    enCours++;
    enregistrements = enregistrements
      .then(() => Coffre.chiffrer(c, instantane))
      .then((env) => {
        localStorage.setItem(VAULT_KEY, JSON.stringify(env));
        localStorage.removeItem(STORE_KEY); // anciennes données non chiffrées
      })
      .catch((e) => alert("Impossible d'enregistrer les données dans le navigateur : " + e.message))
      .finally(() => enCours--);
  }
  window.addEventListener('beforeunload', (e) => {
    if (enCours) e.preventDefault();
  });
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function upsert(coll, item) {
    const list = db[coll];
    const i = list.findIndex((x) => x.id === item.id);
    if (i >= 0) list[i] = item;
    else list.push({ ...item, id: item.id || uid() });
    save();
  }
  function remove(coll, id) {
    db[coll] = db[coll].filter((x) => x.id !== id);
    save();
  }

  // ---------- Utilitaires ----------
  const h = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const eur = (n) =>
    (Number(n) || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });
  const pct = (n) => (Number(n) || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' %';
  const dateFr = (s) => (s ? new Date(s + 'T00:00:00').toLocaleDateString('fr-FR') : '');
  const signed = (n) => `<span class="${n < 0 ? 'neg' : n > 0 ? 'pos' : ''}">${eur(n)}</span>`;
  const today = () => new Date().toISOString().slice(0, 10);
  const currentPeriod = () => today().slice(0, 7);
  const bienById = (id) => db.biens.find((b) => b.id === id);
  const bailById = (id) => db.baux.find((b) => b.id === id);
  const bienNom = (id) => (bienById(id) || {}).nom || '—';
  const catLabel = (c) => (C.CATEGORIES[c] || { label: c }).label;
  const periodeLabel = (p) => {
    const [y, m] = p.split('-').map(Number);
    return `${MOIS[m - 1]} ${y}`;
  };
  const periodeLong = (p) =>
    new Date(p + '-01T00:00:00').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const bienOptions = () => db.biens.map((b) => [b.id, b.nom]);
  const bailOptions = () => db.baux.map((b) => [b.id, `${b.locataire} — ${bienNom(b.bienId)}`]);

  let annee = new Date().getFullYear();
  let view = location.hash.slice(1) || 'dashboard';
  let filtreBien = '';

  // ---------- Formulaire modal ----------
  const modal = document.getElementById('modal');
  const modalForm = document.getElementById('modal-form');
  let modalSubmit = null;
  document.getElementById('modal-cancel').onclick = () => modal.close();
  modalForm.addEventListener('submit', (ev) => {
    if (!modalSubmit) return;
    ev.preventDefault();
    if (!modalForm.reportValidity()) return;
    const values = {};
    for (const el of modalForm.querySelectorAll('[name]')) {
      if (el.type === 'checkbox') values[el.name] = el.checked;
      else if (el.type === 'number') values[el.name] = el.value === '' ? '' : Number(el.value);
      else values[el.name] = el.value.trim();
    }
    if (modalSubmit(values) !== false) {
      modal.close();
      render();
    }
  });

  /**
   * fields: [{ name, label, type, options, required, step, full, help, min }]
   * type: text | number | date | month | select | textarea | checkbox | html
   */
  function openForm(title, fields, initial, onSubmit, okLabel = 'Enregistrer') {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-ok').textContent = okLabel;
    const body = fields
      .map((f) => {
        if (f.type === 'html') return `<div class="full">${f.html}</div>`;
        const v = initial[f.name] ?? f.default ?? '';
        const req = f.required ? 'required' : '';
        const cls = f.full || f.type === 'textarea' ? 'full' : '';
        let input;
        if (f.type === 'select') {
          const opts = (f.options || [])
            .map(([val, lab]) => `<option value="${h(val)}" ${String(val) === String(v) ? 'selected' : ''}>${h(lab)}</option>`)
            .join('');
          input = `<select name="${f.name}" ${req}>${f.placeholder ? `<option value="">${h(f.placeholder)}</option>` : ''}${opts}</select>`;
        } else if (f.type === 'textarea') {
          input = `<textarea name="${f.name}" rows="3">${h(v)}</textarea>`;
        } else if (f.type === 'checkbox') {
          return `<label class="check ${cls}"><input type="checkbox" name="${f.name}" ${v ? 'checked' : ''}> ${h(f.label)}</label>`;
        } else {
          const step = f.type === 'number' ? `step="${f.step || '0.01'}"` : '';
          const min = f.min !== undefined ? `min="${f.min}"` : '';
          input = `<input type="${f.type || 'text'}" name="${f.name}" value="${h(v)}" ${step} ${min} ${req}>`;
        }
        return `<label class="${cls}">${h(f.label)}${f.required ? ' *' : ''}${input}${f.help ? `<span class="help">${h(f.help)}</span>` : ''}</label>`;
      })
      .join('');
    document.getElementById('modal-body').innerHTML = `<div class="form-grid">${body}</div>`;
    modalSubmit = (values) => onSubmit({ ...initial, ...values });
    modal.showModal();
    return modal;
  }

  // ---------- Navigation ----------
  const nav = document.getElementById('nav');
  nav.addEventListener('click', (e) => {
    const v = e.target.dataset.view;
    if (!v) return;
    location.hash = v;
  });
  window.addEventListener('hashchange', () => {
    view = location.hash.slice(1) || 'dashboard';
    render();
  });
  const selAnnee = document.getElementById('annee');
  function fillYears() {
    const years = new Set([annee, new Date().getFullYear()]);
    for (const b of db.baux) if (b.dateDebut) years.add(Number(b.dateDebut.slice(0, 4)));
    for (const c of db.charges) if (c.date) years.add(Number(c.date.slice(0, 4)));
    for (const p of db.paiements) if (p.periode) years.add(Number(p.periode.slice(0, 4)));
    const min = Math.min(...years);
    const max = Math.max(...years, new Date().getFullYear() + 1);
    selAnnee.innerHTML = '';
    for (let y = max; y >= min; y--) selAnnee.add(new Option(y, y, false, y === annee));
  }
  selAnnee.onchange = () => {
    annee = Number(selAnnee.value);
    render();
  };

  const el = document.getElementById('view');
  // Délégation des actions : data-act="nom" data-id="..."
  const actions = {};
  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const fn = actions[t.dataset.act];
    if (fn) fn(t.dataset, t);
  });
  el.addEventListener('change', (e) => {
    const t = e.target.closest('[data-change]');
    if (t && actions[t.dataset.change]) actions[t.dataset.change](t.value, t);
  });

  function render() {
    if (!cle) return; // verrouillé : l'écran de mot de passe reste affiché
    fillYears();
    for (const b of nav.querySelectorAll('button')) b.classList.toggle('active', b.dataset.view === view);
    const fn = views[view] || views.dashboard;
    el.innerHTML = fn();
  }

  function bienFilter() {
    if (!db.biens.length) return '';
    const opts = db.biens
      .map((b) => `<option value="${b.id}" ${b.id === filtreBien ? 'selected' : ''}>${h(b.nom)}</option>`)
      .join('');
    return `<select data-change="filtreBien"><option value="">Tous les biens</option>${opts}</select>`;
  }
  actions.filtreBien = (v) => {
    filtreBien = v;
    render();
  };
  const needBien = () =>
    db.biens.length ? '' : `<div class="card empty">Commencez par <a href="#biens">ajouter un bien</a>.</div>`;

  function table(headers, rows, foot) {
    if (!rows.length) return `<div class="table-wrap"><div class="empty">Aucune donnée.</div></div>`;
    const th = headers.map((x) => (typeof x === 'string' ? `<th>${x}</th>` : `<th class="${x.cls || ''}">${x.label}</th>`)).join('');
    return `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${rows.join('')}</tbody>${
      foot ? `<tfoot>${foot}</tfoot>` : ''
    }</table></div>`;
  }

  // =====================================================================
  // Vues
  // =====================================================================
  const views = {};

  // ---------- Tableau de bord ----------
  views.dashboard = () => {
    if (!db.biens.length) {
      return `<h1>Bienvenue</h1>
      <div class="card">
        <p>Cet outil vous aide à suivre vos biens en location situés en copropriété : loyers, charges et appels de fonds du syndic, régularisation annuelle, prêts immobiliers et revenus fonciers.</p>
        <p>Vos données restent <b>dans ce navigateur</b>. Pensez à faire des sauvegardes régulières depuis <a href="#parametres">Paramètres</a>.</p>
        <div class="toolbar"><button data-act="goto" data-v="biens">Ajouter un premier bien</button>
        <button class="secondary" data-act="demo">Charger un exemple</button></div>
      </div>`;
    }
    const s = C.syntheseAnnee(db, annee, filtreBien || null);
    const kpi = (label, value, cls = '') => `<div class="card kpi"><div class="label">${label}</div><div class="value ${cls}">${value}</div></div>`;
    const lastPeriod = annee < Number(currentPeriod().slice(0, 4)) ? `${annee}-12` : currentPeriod();
    const impayes = [];
    if (annee <= Number(currentPeriod().slice(0, 4))) {
      for (const b of db.baux.filter((b) => !filtreBien || b.bienId === filtreBien)) {
        for (const e of C.situationBail(b, db.paiements, `${annee}-01`, lastPeriod)) {
          if (e.reste > 0.009) impayes.push({ b, e });
        }
      }
    }
    const totImpayes = impayes.reduce((t, { e }) => t + e.reste, 0);
    const parBien = db.biens
      .filter((b) => !filtreBien || b.id === filtreBien)
      .map((b) => {
        const x = C.syntheseAnnee(db, annee, b.id);
        return `<tr><td>${h(b.nom)}</td><td class="num">${eur(x.encaisse)}</td><td class="num">${eur(x.chargesTotal)}</td>
          <td class="num">${eur(x.pretTotal)}</td><td class="num">${signed(x.cashFlow)}</td>
          <td class="num">${pct(x.rendementBrut)}</td><td class="num">${eur(x.crdFin)}</td></tr>`;
      });
    const alertes = alertesBaux();
    return `<div class="toolbar"><h1 style="margin:0">Tableau de bord ${annee}</h1><span class="spacer"></span>${bienFilter()}</div>
      <div class="cards">
        ${kpi('Loyers + provisions encaissés', eur(s.encaisse))}
        ${kpi('Impayés à date', eur(totImpayes), totImpayes > 0 ? 'neg' : '')}
        ${kpi('Charges & taxes payées', eur(s.chargesTotal))}
        ${kpi('Échéances de prêt', eur(s.pretTotal))}
        ${kpi('Cash-flow', eur(s.cashFlow), s.cashFlow < 0 ? 'neg' : 'pos')}
        ${kpi('Capital restant dû au 31/12', eur(s.crdFin))}
        ${kpi('Rendement brut', pct(s.rendementBrut))}
        ${kpi('Rendement net de charges', pct(s.rendementNet))}
      </div>
      <h2>Par bien</h2>
      ${table(
        ['Bien', { label: 'Encaissé', cls: 'num' }, { label: 'Charges', cls: 'num' }, { label: 'Prêts', cls: 'num' }, { label: 'Cash-flow', cls: 'num' }, { label: 'Rdt brut', cls: 'num' }, { label: 'CRD 31/12', cls: 'num' }],
        parBien
      )}
      <h2>Échéances non soldées</h2>
      ${table(
        ['Locataire', 'Bien', 'Période', { label: 'Dû', cls: 'num' }, { label: 'Payé', cls: 'num' }, { label: 'Reste', cls: 'num' }, ''],
        impayes.map(
          ({ b, e }) => `<tr><td>${h(b.locataire)}</td><td>${h(bienNom(b.bienId))}</td><td>${periodeLabel(e.periode)}</td>
          <td class="num">${eur(e.du)}</td><td class="num">${eur(e.paye)}</td><td class="num neg">${eur(e.reste)}</td>
          <td><button class="link" data-act="payer" data-bail="${b.id}" data-periode="${e.periode}">Encaisser</button></td></tr>`
        )
      )}
      ${alertes.length ? `<h2>À prévoir</h2><div class="card"><ul>${alertes.map((a) => `<li>${a}</li>`).join('')}</ul></div>` : ''}`;
  };
  actions.goto = (d) => (location.hash = d.v);

  function alertesBaux() {
    const out = [];
    const now = new Date(today() + 'T00:00:00');
    for (const b of db.baux) {
      if (!b.dateDebut || (b.dateFin && b.dateFin < today())) continue;
      // Date anniversaire du bail (révision IRL) dans les 60 jours
      const d = new Date(b.dateDebut + 'T00:00:00');
      const anniv = new Date(now.getFullYear(), d.getMonth(), d.getDate());
      if (anniv < now) anniv.setFullYear(anniv.getFullYear() + 1);
      const jours = Math.round((anniv - now) / 86400000);
      if (jours <= 60 && anniv.getFullYear() > d.getFullYear()) {
        out.push(`Révision IRL possible du bail de <b>${h(b.locataire)}</b> (${h(bienNom(b.bienId))}) le ${anniv.toLocaleDateString('fr-FR')} — <a href="#baux">calculer</a>`);
      }
      if (b.dateFin) {
        const j = Math.round((new Date(b.dateFin + 'T00:00:00') - now) / 86400000);
        if (j >= 0 && j <= 90) out.push(`Fin du bail de <b>${h(b.locataire)}</b> le ${dateFr(b.dateFin)} : état des lieux et restitution du dépôt de garantie.`);
      }
    }
    const prev = annee - 1;
    if (db.baux.some((b) => C.joursOccupes(b, prev) > 0) && db.charges.some((c) => (c.date || '').startsWith(String(prev)))) {
      out.push(`Pensez à la <a href="#charges">régularisation des charges ${prev}</a> une fois les comptes approuvés en AG.`);
    }
    return out;
  }

  // ---------- Biens ----------
  const champsBien = [
    { name: 'nom', label: 'Nom du bien', required: true, help: 'Ex. : T2 rue Victor Hugo' },
    { name: 'type', label: 'Type', type: 'select', options: [['appartement', 'Appartement'], ['studio', 'Studio'], ['maison', 'Maison'], ['parking', 'Parking / box'], ['local', 'Local commercial']] },
    { name: 'adresse', label: 'Adresse', full: true, required: true },
    { name: 'lot', label: 'N° de lot(s)' },
    { name: 'surface', label: 'Surface (m²)', type: 'number' },
    { name: 'copropriete', label: 'Copropriété / résidence' },
    { name: 'syndic', label: 'Syndic' },
    { name: 'contactSyndic', label: 'Contact syndic', full: true, help: 'Gestionnaire, e-mail, téléphone, extranet…' },
    { name: 'tantiemes', label: 'Tantièmes du lot', type: 'number', step: '1' },
    { name: 'tantiemesTotal', label: 'Tantièmes totaux', type: 'number', step: '1' },
    { name: 'prixAchat', label: "Prix d'achat (€)", type: 'number' },
    { name: 'fraisAcquisition', label: 'Frais de notaire / agence (€)', type: 'number' },
    { name: 'dateAchat', label: "Date d'achat", type: 'date' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ];
  views.biens = () => {
    const rows = db.biens.map((b) => {
      const bail = db.baux.find((x) => x.bienId === b.id && (!x.dateFin || x.dateFin >= today()));
      const quote = b.tantiemes && b.tantiemesTotal ? `${b.tantiemes} / ${b.tantiemesTotal}` : '—';
      return `<tr><td><b>${h(b.nom)}</b><div class="small muted">${h(b.adresse)}</div></td>
        <td>${h(b.copropriete || '—')}<div class="small muted">${h(b.syndic || '')}</div></td>
        <td class="num">${quote}</td><td class="num">${b.surface ? h(b.surface) + ' m²' : '—'}</td>
        <td class="num">${eur((Number(b.prixAchat) || 0) + (Number(b.fraisAcquisition) || 0))}</td>
        <td>${bail ? `<span class="badge st-ok">Loué</span> ${h(bail.locataire)}` : '<span class="badge st-future">Vacant</span>'}</td>
        <td><button class="link" data-act="editBien" data-id="${b.id}">Modifier</button>
        <button class="link danger" data-act="delBien" data-id="${b.id}">Supprimer</button></td></tr>`;
    });
    return `<div class="toolbar"><h1 style="margin:0">Biens</h1><span class="spacer"></span><button data-act="editBien">+ Ajouter un bien</button></div>
      ${table(['Bien', 'Copropriété', { label: 'Tantièmes', cls: 'num' }, { label: 'Surface', cls: 'num' }, { label: 'Coût total', cls: 'num' }, 'Occupation', ''], rows)}`;
  };
  actions.editBien = (d) => {
    const b = d.id ? bienById(d.id) : { type: 'appartement' };
    openForm(d.id ? 'Modifier le bien' : 'Nouveau bien', champsBien, b, (v) => upsert('biens', v));
  };
  actions.delBien = (d) => {
    const n = db.baux.filter((b) => b.bienId === d.id).length + db.charges.filter((c) => c.bienId === d.id).length + db.prets.filter((p) => p.bienId === d.id).length;
    if (n) return alert(`Ce bien est utilisé par ${n} bail(s), charge(s) ou prêt(s). Supprimez-les d'abord.`);
    if (confirm('Supprimer ce bien ?')) {
      remove('biens', d.id);
      render();
    }
  };

  // ---------- Baux ----------
  const champsBail = () => [
    { name: 'bienId', label: 'Bien', type: 'select', options: bienOptions(), required: true },
    { name: 'typeBail', label: 'Type de bail', type: 'select', options: [['vide', 'Location vide (3 ans)'], ['meuble', 'Location meublée (1 an)'], ['etudiant', 'Meublé étudiant (9 mois)'], ['mobilite', 'Bail mobilité'], ['parking', 'Parking']] },
    { name: 'locataire', label: 'Locataire(s)', required: true, full: true },
    { name: 'email', label: 'E-mail', type: 'email' },
    { name: 'telephone', label: 'Téléphone' },
    { name: 'dateDebut', label: "Date d'entrée", type: 'date', required: true },
    { name: 'dateFin', label: 'Date de sortie', type: 'date', help: 'Laisser vide si le bail est en cours' },
    { name: 'loyerHC', label: 'Loyer hors charges (€/mois)', type: 'number', required: true, min: 0 },
    { name: 'provisionCharges', label: 'Provision sur charges (€/mois)', type: 'number', min: 0 },
    { name: 'depotGarantie', label: 'Dépôt de garantie (€)', type: 'number', min: 0 },
    { name: 'jourPaiement', label: 'Jour de paiement', type: 'number', step: '1', min: 1, default: 5 },
    { name: 'irlTrimestre', label: 'Trimestre IRL de référence', help: 'Ex. : T2 2026' },
    { name: 'irlValeur', label: 'Valeur IRL de référence', type: 'number', step: '0.01' },
    { name: 'garant', label: 'Garant / caution', full: true },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ];
  views.baux = () => {
    if (!db.biens.length) return `<h1>Locataires &amp; baux</h1>${needBien()}`;
    const rows = db.baux
      .filter((b) => !filtreBien || b.bienId === filtreBien)
      .sort((a, b) => (b.dateDebut || '').localeCompare(a.dateDebut || ''))
      .map((b) => {
        const actif = !b.dateFin || b.dateFin >= today();
        return `<tr><td><b>${h(b.locataire)}</b><div class="small muted">${h(b.email || '')} ${h(b.telephone || '')}</div></td>
          <td>${h(bienNom(b.bienId))}</td>
          <td>${dateFr(b.dateDebut)}${b.dateFin ? ' → ' + dateFr(b.dateFin) : ''}<div>${actif ? '<span class="badge st-ok">En cours</span>' : '<span class="badge st-future">Terminé</span>'}</div></td>
          <td class="num">${eur(b.loyerHC)}</td><td class="num">${eur(b.provisionCharges)}</td>
          <td class="num"><b>${eur((Number(b.loyerHC) || 0) + (Number(b.provisionCharges) || 0))}</b></td>
          <td class="num">${eur(b.depotGarantie)}</td>
          <td><button class="link" data-act="editBail" data-id="${b.id}">Modifier</button>
          <button class="link" data-act="irl" data-id="${b.id}">Révision IRL</button>
          <button class="link danger" data-act="delBail" data-id="${b.id}">Supprimer</button></td></tr>`;
      });
    return `<div class="toolbar"><h1 style="margin:0">Locataires &amp; baux</h1><span class="spacer"></span>${bienFilter()}<button data-act="editBail">+ Nouveau bail</button></div>
      ${table(['Locataire', 'Bien', 'Période', { label: 'Loyer HC', cls: 'num' }, { label: 'Provisions', cls: 'num' }, { label: 'Total CC', cls: 'num' }, { label: 'Dépôt', cls: 'num' }, ''], rows)}
      <p class="small muted">Le premier et le dernier mois sont automatiquement proratisés selon les dates d'entrée et de sortie.</p>`;
  };
  actions.editBail = (d) => {
    const b = d.id ? bailById(d.id) : { bienId: filtreBien || (db.biens[0] || {}).id, typeBail: 'vide', jourPaiement: 5 };
    openForm(d.id ? 'Modifier le bail' : 'Nouveau bail', champsBail(), b, (v) => upsert('baux', v));
  };
  actions.delBail = (d) => {
    const n = db.paiements.filter((p) => p.bailId === d.id).length;
    if (!confirm(n ? `Supprimer ce bail et ses ${n} paiement(s) enregistrés ?` : 'Supprimer ce bail ?')) return;
    db.paiements = db.paiements.filter((p) => p.bailId !== d.id);
    remove('baux', d.id);
    render();
  };
  actions.irl = (d) => {
    const b = bailById(d.id);
    openForm(
      `Révision IRL — ${b.locataire}`,
      [
        { type: 'html', html: `<p class="small muted">Nouveau loyer = loyer actuel × IRL du même trimestre de l'année / IRL de référence. Les indices sont publiés par l'INSEE.</p>` },
        { name: 'loyerHC', label: 'Loyer HC actuel (€)', type: 'number', required: true },
        { name: 'irlValeur', label: `IRL de référence ${b.irlTrimestre || ''}`, type: 'number', required: true },
        { name: 'irlTrimestre', label: 'Nouveau trimestre IRL', help: 'Ex. : T2 2026', required: true },
        { name: 'irlNouveau', label: 'Nouvel IRL', type: 'number', required: true },
      ],
      { ...b, irlTrimestre: '' },
      (v) => {
        const nouveau = C.revisionIRL(v.loyerHC, v.irlValeur, v.irlNouveau);
        if (!confirm(`Nouveau loyer HC : ${eur(nouveau)} (au lieu de ${eur(v.loyerHC)}, soit ${eur(nouveau - v.loyerHC)}/mois).\n\nAppliquer au bail ? Les échéances passées ne sont pas modifiées si vous créez plutôt un nouveau bail à la date de révision.`)) return false;
        upsert('baux', { ...b, loyerHC: nouveau, irlValeur: v.irlNouveau, irlTrimestre: v.irlTrimestre, notes: `${b.notes ? b.notes + '\n' : ''}${today()} : révision IRL ${eur(v.loyerHC)} → ${eur(nouveau)}` });
      },
      'Calculer'
    );
  };

  // ---------- Loyers ----------
  views.loyers = () => {
    if (!db.baux.length) return `<h1>Loyers</h1>${needBien() || `<div class="card empty">Ajoutez d'abord un <a href="#baux">bail</a>.</div>`}`;
    const cur = currentPeriod();
    const baux = db.baux.filter((b) => (!filtreBien || b.bienId === filtreBien) && C.joursOccupes(b, annee) > 0);
    const rows = baux.map((b) => {
      const sit = Object.fromEntries(C.situationBail(b, db.paiements, `${annee}-01`, `${annee}-12`).map((e) => [e.periode, e]));
      let total = 0;
      let paye = 0;
      const cells = MOIS.map((_, i) => {
        const p = C.periodKey(annee, i + 1);
        const e = sit[p];
        if (!e) return `<td class="cell"></td>`;
        total += e.du;
        paye += e.paye;
        const st = e.reste <= 0.009 ? 'st-ok' : e.paye > 0 ? 'st-part' : p > cur ? 'st-future' : 'st-due';
        const txt = e.reste <= 0.009 ? '✓ ' + Math.round(e.paye) : e.paye > 0 ? Math.round(e.paye) + '/' + Math.round(e.du) : Math.round(e.du);
        return `<td class="cell"><button class="${st}" data-act="cellule" data-bail="${b.id}" data-periode="${p}" title="${periodeLabel(p)} — dû ${eur(e.du)}, payé ${eur(e.paye)}">${txt}</button></td>`;
      }).join('');
      return `<tr><td><b>${h(b.locataire)}</b><div class="small muted">${h(bienNom(b.bienId))}</div></td>${cells}
        <td class="num">${eur(paye)}<div class="small muted">/ ${eur(total)}</div></td></tr>`;
    });
    const journal = db.paiements
      .filter((p) => (p.periode || '').startsWith(String(annee)))
      .filter((p) => !filtreBien || (bailById(p.bailId) || {}).bienId === filtreBien)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map((p) => {
        const b = bailById(p.bailId) || {};
        return `<tr><td>${dateFr(p.date)}</td><td>${h(b.locataire || '?')}</td><td>${periodeLabel(p.periode)}</td><td>${h(p.mode || '')}</td>
          <td class="num">${eur(p.montant)}</td><td>${h(p.note || '')}</td>
          <td><button class="link" data-act="editPaiement" data-id="${p.id}">Modifier</button>
          <button class="link danger" data-act="delPaiement" data-id="${p.id}">Supprimer</button></td></tr>`;
      });
    return `<div class="toolbar"><h1 style="margin:0">Loyers ${annee}</h1><span class="spacer"></span>${bienFilter()}
        <button class="secondary" data-act="encaisserMois">Tout encaisser pour un mois…</button><button data-act="payer">+ Paiement</button></div>
      <p class="small muted">Cliquez sur un mois pour enregistrer un paiement ou éditer une quittance.
        <span class="badge st-ok">payé</span> <span class="badge st-part">partiel</span> <span class="badge st-due">impayé</span> <span class="badge st-future">à venir</span></p>
      <div class="table-wrap grid-loyers"><table><thead><tr><th>Bail</th>${MOIS.map((m) => `<th>${m}</th>`).join('')}<th class="num">Total</th></tr></thead>
        <tbody>${rows.join('') || `<tr><td colspan="14" class="empty">Aucun bail actif en ${annee}.</td></tr>`}</tbody></table></div>
      <h2>Journal des encaissements</h2>
      ${table(['Date', 'Locataire', 'Période', 'Mode', { label: 'Montant', cls: 'num' }, 'Note', ''], journal)}`;
  };
  actions.cellule = (d) => {
    const b = bailById(d.bail);
    const e = C.situationBail(b, db.paiements, d.periode, d.periode)[0];
    const pays = db.paiements.filter((p) => p.bailId === b.id && p.periode === d.periode);
    const list = pays.length
      ? `<ul>${pays.map((p) => `<li>${dateFr(p.date)} — ${eur(p.montant)} (${h(p.mode || '')})</li>`).join('')}</ul>`
      : '<p class="muted">Aucun paiement enregistré.</p>';
    openForm(
      `${b.locataire} — ${periodeLong(d.periode)}`,
      [
        {
          type: 'html',
          html: `<p>Loyer ${eur(e.loyer)} + provisions ${eur(e.provision)} = <b>${eur(e.du)}</b>${e.prorata < 1 ? ` <span class="muted">(prorata ${e.jours} jours)</span>` : ''}<br>
          Payé : <b>${eur(e.paye)}</b> — Reste : <b class="${e.reste > 0 ? 'neg' : ''}">${eur(e.reste)}</b></p>${list}
          <div class="toolbar">${e.reste <= 0.009 ? `<button type="button" class="secondary" data-quittance="${b.id}|${d.periode}">🖨 Quittance de loyer</button>` : e.paye > 0 ? `<button type="button" class="secondary" data-quittance="${b.id}|${d.periode}">🖨 Reçu partiel</button>` : ''}
          <button type="button" class="secondary" data-avis="${b.id}|${d.periode}">🖨 Avis d'échéance</button></div>
          <h3 style="margin:12px 0 0">Enregistrer un paiement</h3>`,
        },
        { name: 'montant', label: 'Montant (€)', type: 'number', required: true },
        { name: 'date', label: 'Date de réception', type: 'date', required: true },
        { name: 'mode', label: 'Mode', type: 'select', options: MODES.map((m) => [m, m]) },
        { name: 'note', label: 'Note' },
      ],
      { bailId: b.id, periode: d.periode, montant: e.reste > 0 ? e.reste : '', date: today(), mode: 'Virement' },
      (v) => upsert('paiements', v),
      'Encaisser'
    );
  };
  // Boutons dans la modale (hors délégation de la vue)
  document.getElementById('modal-body').addEventListener('click', (e) => {
    const q = e.target.closest('[data-quittance]');
    if (q) {
      const [id, p] = q.dataset.quittance.split('|');
      imprimerQuittance(bailById(id), p);
    }
    const a = e.target.closest('[data-avis]');
    if (a) {
      const [id, p] = a.dataset.avis.split('|');
      imprimerAvis(bailById(id), p);
    }
  });
  actions.payer = (d) => {
    if (!db.baux.length) return alert("Ajoutez d'abord un bail.");
    if (d.bail && d.periode) return actions.cellule(d);
    openForm(
      'Nouveau paiement',
      [
        { name: 'bailId', label: 'Bail', type: 'select', options: bailOptions(), required: true, full: true },
        { name: 'periode', label: 'Mois concerné', type: 'month', required: true },
        { name: 'montant', label: 'Montant (€)', type: 'number', required: true },
        { name: 'date', label: 'Date de réception', type: 'date', required: true },
        { name: 'mode', label: 'Mode', type: 'select', options: MODES.map((m) => [m, m]) },
        { name: 'note', label: 'Note', full: true },
      ],
      { bailId: (db.baux.find((b) => !b.dateFin || b.dateFin >= today()) || db.baux[0]).id, periode: currentPeriod(), date: today(), mode: 'Virement' },
      (v) => upsert('paiements', v)
    );
  };
  actions.editPaiement = (d) => {
    const p = db.paiements.find((x) => x.id === d.id);
    openForm(
      'Modifier le paiement',
      [
        { name: 'bailId', label: 'Bail', type: 'select', options: bailOptions(), required: true, full: true },
        { name: 'periode', label: 'Mois concerné', type: 'month', required: true },
        { name: 'montant', label: 'Montant (€)', type: 'number', required: true },
        { name: 'date', label: 'Date de réception', type: 'date', required: true },
        { name: 'mode', label: 'Mode', type: 'select', options: MODES.map((m) => [m, m]) },
        { name: 'note', label: 'Note', full: true },
      ],
      p,
      (v) => upsert('paiements', v)
    );
  };
  actions.delPaiement = (d) => {
    if (confirm('Supprimer ce paiement ?')) {
      remove('paiements', d.id);
      render();
    }
  };
  actions.encaisserMois = () => {
    openForm(
      'Encaisser tous les loyers du mois',
      [
        { type: 'html', html: '<p class="small muted">Enregistre un paiement du solde restant pour chaque bail actif sur le mois choisi.</p>' },
        { name: 'periode', label: 'Mois', type: 'month', required: true },
        { name: 'date', label: 'Date de réception', type: 'date', required: true },
        { name: 'mode', label: 'Mode', type: 'select', options: MODES.map((m) => [m, m]) },
      ],
      { periode: currentPeriod(), date: today(), mode: 'Virement' },
      (v) => {
        let n = 0;
        for (const b of db.baux.filter((b) => !filtreBien || b.bienId === filtreBien)) {
          const e = C.situationBail(b, db.paiements, v.periode, v.periode)[0];
          if (e && e.reste > 0.009) {
            db.paiements.push({ id: uid(), bailId: b.id, periode: v.periode, montant: e.reste, date: v.date, mode: v.mode });
            n++;
          }
        }
        save();
        alert(`${n} paiement(s) enregistré(s).`);
      },
      'Encaisser'
    );
  };

  // ---------- Documents imprimables ----------
  function printDoc(title, body) {
    const w = window.open('', '_blank');
    if (!w) return alert("Autorisez l'ouverture de fenêtres pour imprimer.");
    w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${h(title)}</title>
      <style>body{font:14px/1.5 Georgia,serif;max-width:720px;margin:40px auto;padding:0 20px;color:#111}
      h1{font-size:22px;text-align:center;margin:28px 0}table{width:100%;border-collapse:collapse;margin:16px 0}
      td{padding:6px 8px;border-bottom:1px solid #ddd}td.n{text-align:right}tr.t td{font-weight:bold;border-top:2px solid #111}
      .cols{display:flex;justify-content:space-between;gap:24px}.small{font-size:12px;color:#555}
      @media print{button{display:none}}</style></head><body>${body}
      <p style="margin-top:40px"><button onclick="print()">Imprimer / PDF</button></p></body></html>`);
    w.document.close();
  }
  const enTete = (b, bien) => `<div class="cols"><div><b>Bailleur</b><br>${h(db.bailleur.nom || '(nom du bailleur — voir Paramètres)')}<br>${h(db.bailleur.adresse || '').replace(/\n/g, '<br>')}</div>
    <div><b>Locataire</b><br>${h(b.locataire)}<br>${h(bien.adresse || '')}</div></div>`;

  function imprimerQuittance(b, periode) {
    const bien = bienById(b.bienId) || {};
    const e = C.situationBail(b, db.paiements, periode, periode)[0];
    const pays = db.paiements.filter((p) => p.bailId === b.id && p.periode === periode);
    const dernier = pays.map((p) => p.date).sort().pop();
    const complet = e.reste <= 0.009;
    const [y, m] = periode.split('-').map(Number);
    const debut = e.prorata < 1 && b.dateDebut.slice(0, 7) === periode ? b.dateDebut : `${periode}-01`;
    const fin = b.dateFin && b.dateFin.slice(0, 7) === periode ? b.dateFin : `${periode}-${C.daysInMonth(y, m)}`;
    const titre = complet ? 'Quittance de loyer' : 'Reçu de paiement partiel';
    printDoc(
      `${titre} ${periode} ${b.locataire}`,
      `${enTete(b, bien)}<h1>${titre}<br><small>${periodeLong(periode)}</small></h1>
      <p>Je soussigné(e) ${h(db.bailleur.nom || '…')}, propriétaire du logement désigné ci-dessus, déclare avoir reçu de ${h(b.locataire)}
      la somme de <b>${eur(e.paye)}</b> au titre ${complet ? 'du paiement du loyer et des charges' : "d'un paiement partiel du loyer et des charges"}
      pour la période du ${dateFr(debut)} au ${dateFr(fin)}${complet ? ', et lui en donne quittance, sous réserve de tous mes droits' : ''}.</p>
      <table><tr><td>Loyer hors charges</td><td class="n">${eur(e.loyer)}</td></tr>
      <tr><td>Provision pour charges</td><td class="n">${eur(e.provision)}</td></tr>
      <tr class="t"><td>Total dû</td><td class="n">${eur(e.du)}</td></tr>
      <tr><td>Montant reçu</td><td class="n">${eur(e.paye)}</td></tr>
      ${complet ? '' : `<tr><td>Reste dû</td><td class="n">${eur(e.reste)}</td></tr>`}</table>
      <p>Fait le ${dateFr(dernier || today())}</p><p>Signature :</p><br><br>
      <p class="small">${complet ? 'Cette quittance annule tous les reçus qui auraient pu être établis précédemment en cas de paiement partiel du montant du présent terme.' : 'Ce reçu ne vaut pas quittance (art. 21 de la loi du 6 juillet 1989).'}</p>`
    );
  }
  function imprimerAvis(b, periode) {
    const bien = bienById(b.bienId) || {};
    const e = C.situationBail(b, db.paiements, periode, periode)[0];
    const [y, m] = periode.split('-').map(Number);
    const jour = Math.min(Number(b.jourPaiement) || 5, C.daysInMonth(y, m));
    printDoc(
      `Avis d'échéance ${periode} ${b.locataire}`,
      `${enTete(b, bien)}<h1>Avis d'échéance<br><small>${periodeLong(periode)}</small></h1>
      <table><tr><td>Loyer hors charges</td><td class="n">${eur(e.loyer)}</td></tr>
      <tr><td>Provision pour charges</td><td class="n">${eur(e.provision)}</td></tr>
      ${e.paye ? `<tr><td>Déjà réglé</td><td class="n">- ${eur(e.paye)}</td></tr>` : ''}
      <tr class="t"><td>Montant à régler</td><td class="n">${eur(Math.max(e.reste, 0))}</td></tr></table>
      <p>À régler au plus tard le ${dateFr(C.periodKey(y, m) + '-' + String(jour).padStart(2, '0'))}.</p>`
    );
  }

  // ---------- Charges ----------
  const champsCharge = () => [
    { name: 'bienId', label: 'Bien', type: 'select', options: bienOptions(), required: true },
    { name: 'categorie', label: 'Catégorie', type: 'select', options: Object.entries(C.CATEGORIES).map(([k, v]) => [k, v.label]), required: true },
    { name: 'libelle', label: 'Libellé', full: true, required: true, help: 'Ex. : Appel de fonds T1, régularisation exercice N-1, facture plombier…' },
    { name: 'date', label: 'Date', type: 'date', required: true },
    { name: 'montant', label: 'Montant payé (€)', type: 'number', required: true, help: 'Négatif pour un remboursement / régularisation créditrice' },
    { name: 'partRecuperable', label: 'Dont part récupérable (€)', type: 'number', help: 'Refacturable au locataire (décret 87-713) : eau, ascenseur, entretien parties communes, TEOM…' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ];
  views.charges = () => {
    if (!db.biens.length) return `<h1>Charges</h1>${needBien()}`;
    const list = db.charges
      .filter((c) => (c.date || '').startsWith(String(annee)) && (!filtreBien || c.bienId === filtreBien))
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    let tot = 0;
    let rec = 0;
    const rows = list.map((c) => {
      tot += Number(c.montant) || 0;
      rec += Number(c.partRecuperable) || 0;
      return `<tr><td>${dateFr(c.date)}</td><td>${h(bienNom(c.bienId))}</td><td>${h(catLabel(c.categorie))}</td><td>${h(c.libelle)}</td>
        <td class="num">${eur(c.montant)}</td><td class="num">${eur(c.partRecuperable)}</td>
        <td class="num">${eur((Number(c.montant) || 0) - (Number(c.partRecuperable) || 0))}</td>
        <td><button class="link" data-act="editCharge" data-id="${c.id}">Modifier</button>
        <button class="link" data-act="dupCharge" data-id="${c.id}">Dupliquer</button>
        <button class="link danger" data-act="delCharge" data-id="${c.id}">Supprimer</button></td></tr>`;
    });
    const foot = `<tr><td colspan="4">Total ${annee}</td><td class="num">${eur(tot)}</td><td class="num">${eur(rec)}</td><td class="num">${eur(tot - rec)}</td><td></td></tr>`;

    const regs = db.baux
      .filter((b) => (!filtreBien || b.bienId === filtreBien) && C.joursOccupes(b, annee) > 0)
      .map((b) => {
        const r = C.regularisation(b, db.charges, annee);
        return `<tr><td>${h(b.locataire)}<div class="small muted">${h(bienNom(b.bienId))}</div></td>
          <td class="num">${r.jours} j</td><td class="num">${eur(r.chargesRecuperables)}</td><td class="num">${eur(r.provisions)}</td>
          <td class="num">${r.solde > 0 ? `<span class="neg">${eur(r.solde)}</span><div class="small muted">à demander</div>` : `<span class="pos">${eur(-r.solde)}</span><div class="small muted">à rembourser</div>`}</td>
          <td><button class="link" data-act="decompte" data-id="${b.id}">🖨 Décompte</button>
          <button class="link" data-act="enregRegul" data-id="${b.id}">Enregistrer</button></td></tr>`;
      });

    const parCat = {};
    for (const c of list) parCat[c.categorie] = (parCat[c.categorie] || 0) + (Number(c.montant) || 0);
    return `<div class="toolbar"><h1 style="margin:0">Charges ${annee}</h1><span class="spacer"></span>${bienFilter()}
        <button class="secondary" data-act="appelsFonds">Générer les appels de fonds…</button><button data-act="editCharge">+ Charge</button></div>
      ${table(['Date', 'Bien', 'Catégorie', 'Libellé', { label: 'Montant', cls: 'num' }, { label: 'Récupérable', cls: 'num' }, { label: 'À ma charge', cls: 'num' }, ''], rows, rows.length ? foot : '')}
      ${Object.keys(parCat).length ? `<div class="cards" style="margin-top:12px">${Object.entries(parCat).map(([k, v]) => `<div class="card kpi"><div class="label">${h(catLabel(k))}</div><div class="value" style="font-size:17px">${eur(v)}</div></div>`).join('')}</div>` : ''}
      <h2>Régularisation des charges ${annee}</h2>
      <p class="small muted">Charges récupérables de l'année (proratisées à la durée d'occupation) comparées aux provisions appelées.
        À faire une fois les comptes de l'exercice approuvés en assemblée générale : saisissez la part récupérable réelle figurant sur le décompte du syndic.</p>
      ${table(['Locataire', { label: 'Occupation', cls: 'num' }, { label: 'Charges récup.', cls: 'num' }, { label: 'Provisions', cls: 'num' }, { label: 'Solde', cls: 'num' }, ''], regs)}`;
  };
  actions.editCharge = (d) => {
    const c = d.id ? db.charges.find((x) => x.id === d.id) : { bienId: filtreBien || (db.biens[0] || {}).id, categorie: 'copro', date: today() };
    openForm(d.id ? 'Modifier la charge' : 'Nouvelle charge', champsCharge(), c, (v) => upsert('charges', v));
  };
  actions.dupCharge = (d) => {
    const c = db.charges.find((x) => x.id === d.id);
    openForm('Dupliquer la charge', champsCharge(), { ...c, id: undefined, date: today() }, (v) => upsert('charges', v));
  };
  actions.delCharge = (d) => {
    if (confirm('Supprimer cette charge ?')) {
      remove('charges', d.id);
      render();
    }
  };
  actions.appelsFonds = () => {
    openForm(
      'Générer les appels de fonds du syndic',
      [
        { type: 'html', html: '<p class="small muted">Crée les appels de provisions du budget prévisionnel voté en AG (généralement 4 appels trimestriels). Vous pourrez ajuster chaque ligne ensuite.</p>' },
        { name: 'bienId', label: 'Bien', type: 'select', options: bienOptions(), required: true },
        { name: 'nb', label: "Nombre d'appels", type: 'select', options: [[4, '4 (trimestriel)'], [12, '12 (mensuel)'], [2, '2 (semestriel)'], [1, '1 (annuel)']] },
        { name: 'montant', label: 'Montant par appel (€)', type: 'number', required: true },
        { name: 'partRecuperable', label: 'Part récupérable estimée par appel (€)', type: 'number', help: "Souvent 60 à 80 % des charges courantes ; à affiner avec l'annexe du budget" },
        { name: 'fondsTravaux', label: 'Cotisation fonds travaux par appel (€)', type: 'number', help: 'Loi ALUR — non récupérable' },
        { name: 'jour', label: "Jour d'exigibilité", type: 'number', step: '1', min: 1, default: 1 },
      ],
      { bienId: filtreBien || (db.biens[0] || {}).id, nb: 4, jour: 1 },
      (v) => {
        const nb = Number(v.nb) || 4;
        const pas = 12 / nb;
        for (let i = 0; i < nb; i++) {
          const m = i * pas + 1;
          const date = `${C.periodKey(annee, m)}-${String(Math.min(v.jour || 1, 28)).padStart(2, '0')}`;
          const lib = nb === 4 ? `Appel de fonds T${i + 1}` : nb === 12 ? `Appel de fonds ${MOIS[i]}` : `Appel de fonds ${i + 1}/${nb}`;
          db.charges.push({ id: uid(), bienId: v.bienId, categorie: 'copro', libelle: `${lib} ${annee}`, date, montant: v.montant, partRecuperable: v.partRecuperable || 0 });
          if (v.fondsTravaux) db.charges.push({ id: uid(), bienId: v.bienId, categorie: 'copro_travaux', libelle: `Fonds travaux ${lib.replace('Appel de fonds ', '')} ${annee}`, date, montant: v.fondsTravaux, partRecuperable: 0 });
        }
        save();
      },
      'Générer'
    );
  };
  actions.decompte = (d) => {
    const b = bailById(d.id);
    const bien = bienById(b.bienId) || {};
    const r = C.regularisation(b, db.charges, annee);
    const lignes = db.charges
      .filter((c) => c.bienId === b.bienId && (c.date || '').startsWith(String(annee)) && Number(c.partRecuperable))
      .map((c) => `<tr><td>${dateFr(c.date)}</td><td>${h(c.libelle)}</td><td class="n">${eur(c.partRecuperable)}</td></tr>`)
      .join('');
    printDoc(
      `Régularisation des charges ${annee} ${b.locataire}`,
      `${enTete(b, bien)}<h1>Décompte de régularisation des charges<br><small>Année ${annee}</small></h1>
      <p>Lot : ${h(bien.lot || '—')} — Copropriété : ${h(bien.copropriete || '—')}${bien.tantiemes ? ` — Quote-part : ${h(bien.tantiemes)}/${h(bien.tantiemesTotal)} tantièmes` : ''}</p>
      <table><tr><td><b>Date</b></td><td><b>Charges récupérables</b></td><td class="n"><b>Montant</b></td></tr>${lignes}
      <tr class="t"><td></td><td>Total charges récupérables du lot</td><td class="n">${eur(r.chargesRecuperablesBien)}</td></tr></table>
      <table><tr><td>Période d'occupation (${r.jours} jours)</td><td class="n">${(r.prorata * 100).toFixed(1)} %</td></tr>
      <tr><td>Charges récupérables à votre charge</td><td class="n">${eur(r.chargesRecuperables)}</td></tr>
      <tr><td>Provisions versées</td><td class="n">${eur(r.provisions)}</td></tr>
      <tr class="t"><td>${r.solde >= 0 ? 'Solde restant dû par le locataire' : 'Trop-perçu remboursé au locataire'}</td><td class="n">${eur(Math.abs(r.solde))}</td></tr></table>
      <p class="small">Conformément à l'article 23 de la loi du 6 juillet 1989, les pièces justificatives sont tenues à votre disposition pendant six mois à compter de l'envoi de ce décompte.</p>
      <p>Fait le ${dateFr(today())}</p>`
    );
  };
  actions.enregRegul = (d) => {
    const b = bailById(d.id);
    const r = C.regularisation(b, db.charges, annee);
    const periode = currentPeriod();
    if (!confirm(`Enregistrer la régularisation ${annee} de ${b.locataire} (${r.solde >= 0 ? 'complément de ' : 'remboursement de '}${eur(Math.abs(r.solde))}) comme un paiement sur la période ${periodeLabel(periode)} ?\n\nÀ faire une fois la somme effectivement reçue ou remboursée.`)) return;
    db.paiements.push({ id: uid(), bailId: b.id, periode, montant: r.solde, date: today(), mode: 'Autre', note: `Régularisation charges ${annee}` });
    save();
    alert('Enregistré. Notez que ce montant apparaît en plus du loyer du mois dans la grille des loyers.');
    render();
  };

  // ---------- Prêts ----------
  const champsPret = () => [
    { name: 'bienId', label: 'Bien financé', type: 'select', options: bienOptions(), required: true },
    { name: 'libelle', label: 'Libellé', help: 'Ex. : Prêt immobilier, PTZ, prêt travaux' },
    { name: 'banque', label: 'Banque' },
    { name: 'capital', label: 'Capital emprunté (€)', type: 'number', required: true, min: 0 },
    { name: 'tauxAnnuel', label: 'Taux nominal annuel (%)', type: 'number', step: '0.001', required: true, min: 0 },
    { name: 'dureeMois', label: 'Durée (mois)', type: 'number', step: '1', required: true, min: 1 },
    { name: 'dateDebut', label: 'Date de 1re échéance', type: 'date', required: true },
    { name: 'assuranceMensuelle', label: 'Assurance emprunteur (€/mois)', type: 'number', min: 0 },
    { name: 'differeMois', label: 'Différé partiel (mois)', type: 'number', step: '1', min: 0, help: 'Intérêts seuls pendant cette période' },
    { name: 'fraisDossier', label: 'Frais de dossier / garantie (€)', type: 'number', min: 0 },
  ];
  let pretOuvert = null;
  views.prets = () => {
    if (!db.biens.length) return `<h1>Prêts</h1>${needBien()}`;
    const t = today();
    const prets = db.prets.filter((p) => !filtreBien || p.bienId === filtreBien);
    const rows = prets.map((p) => {
      const tab = C.amortissement(p);
      const m = tab.find((l) => l.capital > 0) || tab[0] || { total: 0 };
      const fin = tab.length ? tab[tab.length - 1].date : '';
      const a = C.pretAnnee(p, annee);
      const coutTotal = tab.reduce((s, l) => s + l.interets + l.assurance, 0) + (Number(p.fraisDossier) || 0);
      return `<tr><td><b>${h(p.libelle || 'Prêt')}</b><div class="small muted">${h(p.banque || '')} — ${h(bienNom(p.bienId))}</div></td>
        <td class="num">${eur(p.capital)}<div class="small muted">${pct(p.tauxAnnuel)} · ${Math.round(p.dureeMois / 12 * 10) / 10} ans</div></td>
        <td class="num">${eur(m.total)}</td><td class="num">${eur(C.crdAu(p, t))}</td>
        <td class="num">${eur(a.interets)}<div class="small muted">+ ${eur(a.assurance)} ass.</div></td>
        <td class="num">${eur(coutTotal)}</td><td>${dateFr(fin)}</td>
        <td><button class="link" data-act="voirPret" data-id="${p.id}">Tableau</button>
        <button class="link" data-act="editPret" data-id="${p.id}">Modifier</button>
        <button class="link danger" data-act="delPret" data-id="${p.id}">Supprimer</button></td></tr>`;
    });
    let detail = '';
    const po = db.prets.find((p) => p.id === pretOuvert);
    if (po) {
      const tab = C.amortissement(po);
      const parAn = {};
      for (const l of tab) {
        const y = l.date.slice(0, 4);
        const a = (parAn[y] = parAn[y] || { interets: 0, capital: 0, assurance: 0, total: 0, crd: 0 });
        a.interets += l.interets;
        a.capital += l.capital;
        a.assurance += l.assurance;
        a.total += l.total;
        a.crd = l.crd;
      }
      const lignesAn = Object.entries(parAn).map(([y, a]) => `<tr${Number(y) === annee ? ' style="font-weight:700"' : ''}><td>${y}</td><td class="num">${eur(a.total)}</td><td class="num">${eur(a.capital)}</td><td class="num">${eur(a.interets)}</td><td class="num">${eur(a.assurance)}</td><td class="num">${eur(a.crd)}</td></tr>`);
      const lignes = tab.map((l) => `<tr${l.date <= t ? ' class="muted"' : ''}><td>${l.n}</td><td>${dateFr(l.date)}</td><td class="num">${eur(l.total)}</td><td class="num">${eur(l.capital)}</td><td class="num">${eur(l.interets)}</td><td class="num">${eur(l.assurance)}</td><td class="num">${eur(l.crd)}</td></tr>`);
      detail = `<h2>Tableau d'amortissement — ${h(po.libelle || 'Prêt')} <button class="link" data-act="csvPret" data-id="${po.id}">Exporter CSV</button></h2>
        ${table(['Année', { label: 'Échéances', cls: 'num' }, { label: 'Capital', cls: 'num' }, { label: 'Intérêts', cls: 'num' }, { label: 'Assurance', cls: 'num' }, { label: 'CRD fin', cls: 'num' }], lignesAn)}
        <details><summary>Détail mensuel (${tab.length} échéances)</summary>
        ${table(['N°', 'Date', { label: 'Échéance', cls: 'num' }, { label: 'Capital', cls: 'num' }, { label: 'Intérêts', cls: 'num' }, { label: 'Assurance', cls: 'num' }, { label: 'CRD', cls: 'num' }], lignes)}</details>`;
    }
    return `<div class="toolbar"><h1 style="margin:0">Prêts</h1><span class="spacer"></span>${bienFilter()}<button data-act="editPret">+ Nouveau prêt</button></div>
      ${table(['Prêt', { label: 'Capital', cls: 'num' }, { label: 'Mensualité', cls: 'num' }, { label: "CRD aujourd'hui", cls: 'num' }, { label: `Intérêts ${annee}`, cls: 'num' }, { label: 'Coût total', cls: 'num' }, 'Fin', ''], rows)}
      ${detail}`;
  };
  actions.editPret = (d) => {
    const p = d.id ? db.prets.find((x) => x.id === d.id) : { bienId: filtreBien || (db.biens[0] || {}).id, dureeMois: 240 };
    openForm(d.id ? 'Modifier le prêt' : 'Nouveau prêt', champsPret(), p, (v) => {
      v.id = v.id || uid();
      upsert('prets', v);
      pretOuvert = v.id;
    });
  };
  actions.voirPret = (d) => {
    pretOuvert = pretOuvert === d.id ? null : d.id;
    render();
  };
  actions.delPret = (d) => {
    if (confirm('Supprimer ce prêt ?')) {
      remove('prets', d.id);
      render();
    }
  };
  actions.csvPret = (d) => {
    const p = db.prets.find((x) => x.id === d.id);
    const rows = [['N', 'Date', 'Echeance', 'Capital', 'Interets', 'Assurance', 'Total', 'CRD']];
    for (const l of C.amortissement(p)) rows.push([l.n, l.date, l.echeance, l.capital, l.interets, l.assurance, l.total, l.crd]);
    downloadCSV(`amortissement-${(p.libelle || 'pret').replace(/\W+/g, '-')}.csv`, rows);
  };

  // ---------- Fiscalité ----------
  views.fiscalite = () => {
    if (!db.biens.length) return `<h1>Fiscalité</h1>${needBien()}`;
    const biens = db.biens.filter((b) => !filtreBien || b.id === filtreBien);
    const ss = biens.map((b) => ({ b, s: C.syntheseAnnee(db, annee, b.id) }));
    const tot = C.syntheseAnnee(db, annee, filtreBien || null);
    const catTot = (bienIds, cats) =>
      db.charges
        .filter((c) => bienIds.includes(c.bienId) && (c.date || '').startsWith(String(annee)) && cats.includes(c.categorie))
        .reduce((s, c) => s + (Number(c.montant) || 0) - (Number(c.partRecuperable) || 0), 0);
    const ids = biens.map((b) => b.id);
    const l = [
      ['Loyers bruts encaissés (hors provisions)', tot.revenusBruts, '211'],
      ['Frais de gestion forfaitaires (20 € / local)', -tot.forfaitGestion, '222'],
      ["Frais d'administration et de gestion (agence…)", -catTot(ids, ['gestion']), '221'],
      ['Primes d’assurance (PNO)', -catTot(ids, ['assurance_pno']), '223'],
      ["Travaux d'entretien, réparation et amélioration", -catTot(ids, ['travaux', 'amelioration']), '224'],
      ['Charges de copropriété non récupérables', -catTot(ids, ['copro', 'copro_travaux']), '229-230'],
      ['Taxe foncière (hors TEOM récupérable)', -catTot(ids, ['taxe_fonciere']), '227'],
      ["Intérêts d'emprunt", -tot.pretInterets, '250'],
      ['Assurance emprunteur', -tot.pretAssurance, '250'],
    ];
    const rows = l.map(([lab, v, ligne]) => `<tr><td>${lab}</td><td class="muted">${ligne}</td><td class="num">${eur(v)}</td></tr>`);
    const foot = `<tr><td>Résultat foncier estimé</td><td></td><td class="num">${signed(tot.resultatFoncier)}</td></tr>`;
    const microBase = tot.revenusBruts * 0.7;
    const parBien = ss.map(({ b, s }) => `<tr><td>${h(b.nom)}</td><td class="num">${eur(s.revenusBruts)}</td><td class="num">${eur(s.deductions)}</td><td class="num">${signed(s.resultatFoncier)}</td></tr>`);
    return `<div class="toolbar"><h1 style="margin:0">Revenus fonciers ${annee}</h1><span class="spacer"></span>${bienFilter()}</div>
      <p class="small muted">Estimation indicative pour la déclaration 2044 (location nue, régime réel). Les numéros de ligne sont donnés à titre de repère.
        Les provisions pour charges et les charges récupérables s'équilibrent et sont exclues. Vérifiez avec les règles fiscales en vigueur ou votre conseiller.</p>
      ${table(['Poste', 'Ligne 2044', { label: 'Montant', cls: 'num' }], rows, foot)}
      <div class="cards" style="margin-top:12px">
        <div class="card kpi"><div class="label">Régime réel — résultat</div><div class="value">${signed(tot.resultatFoncier)}</div>
          <div class="small muted">${tot.resultatFoncier < 0 ? 'Déficit imputable sur le revenu global dans la limite de 10 700 € (hors intérêts), le reste reportable 10 ans.' : ''}</div></div>
        <div class="card kpi"><div class="label">Micro-foncier — base imposable</div><div class="value">${eur(microBase)}</div>
          <div class="small muted">Abattement 30 %, possible si revenus fonciers bruts ≤ 15 000 €.</div></div>
      </div>
      <h2>Par bien</h2>
      ${table(['Bien', { label: 'Recettes', cls: 'num' }, { label: 'Déductions', cls: 'num' }, { label: 'Résultat', cls: 'num' }], parBien)}
      <p class="small muted">En location meublée (LMNP), le régime est différent (BIC, amortissements) : ces chiffres servent alors uniquement de base de travail.</p>`;
  };

  // ---------- Import Gmail ----------
  const cfgGmail = () => (db.gmail = { clientId: '', regles: [], ignores: [], ...(db.gmail || {}) });
  let gmailDocs = [];
  let gmailJournal = [];
  let gmailEnCours = false;
  const baseSource = (s) => String(s || '').split(':').slice(0, 3).join(':');
  function sourcesConnues() {
    const s = new Set(cfgGmail().ignores);
    for (const x of [...db.charges, ...db.paiements]) if (x.source) s.add(baseSource(x.source));
    return s;
  }
  function devinerBien(texte, defaut) {
    const t = Extract && texte ? texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() : '';
    const n = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    const trouve = db.biens.find((b) => {
      const rue = n(b.adresse).split(',')[0];
      return (rue.length > 6 && t.includes(rue)) || (b.copropriete && n(b.copropriete).length > 4 && t.includes(n(b.copropriete)));
    });
    return (trouve || bienById(defaut) || db.biens[0] || {}).id || '';
  }
  function proposition(doc, regle) {
    const e = doc.extraction || {};
    const bienId = devinerBien(doc.texte, regle.bienId);
    if (e.type === 'gerance') {
      const encaisse = e.encaisse ?? ((e.loyer || 0) + (e.provisions || 0) || null);
      return { type: 'gerance', bienId, periode: e.periode || doc.dateMail.slice(0, 7), date: e.date || '', encaisse, honoraires: e.honoraires, assurance: e.assurance, net: e.net };
    }
    const pct = regle.pctRecup === '' || regle.pctRecup === undefined ? 0 : Number(regle.pctRecup);
    const montant = e.total !== null && e.total !== undefined ? Math.round((e.total - (e.fondsTravaux || 0)) * 100) / 100 : null;
    const tri = e.trimestre;
    const an = (tri && tri.annee) || Number((e.date || doc.dateMail).slice(0, 4));
    return {
      type: 'appel',
      bienId,
      date: e.date || doc.dateMail,
      libelle: tri ? `Appel de fonds T${tri.n} ${an}` : e.travaux ? `Appel de fonds travaux ${an}` : `Appel de fonds — ${doc.sujet || doc.fichier}`,
      categorie: e.travaux ? 'copro_travaux' : 'copro',
      montant,
      partRecuperable: montant !== null && !e.travaux ? Math.round(montant * pct) / 100 : 0,
      fondsTravaux: e.fondsTravaux,
    };
  }

  const champsRegle = () => [
    { name: 'nom', label: 'Nom', required: true, help: 'Ex. : Syndic Foncia, Agence Citya' },
    { name: 'type', label: 'Type de documents', type: 'select', options: [['appel', 'Appels de fonds du syndic'], ['gerance', 'Relevés de gérance (agence)'], ['auto', 'Détection automatique']] },
    { name: 'requete', label: 'Recherche Gmail', full: true, required: true, help: 'Syntaxe Gmail, ex. : from:(@foncia.fr) ou subject:("appel de fonds") — les PDF joints sont ajoutés automatiquement' },
    { name: 'bienId', label: 'Bien par défaut', type: 'select', options: bienOptions(), help: "Remplacé si l'adresse d'un autre bien figure dans le PDF" },
    { name: 'pctRecup', label: 'Part récupérable des appels (%)', type: 'number', step: '1', min: 0, help: 'Estimation, à ajuster après le décompte annuel du syndic' },
    { name: 'depuis', label: 'Chercher depuis le', type: 'date' },
  ];

  views.gmail = () => {
    const g = cfgGmail();
    if (!db.biens.length) return `<h1>Import Gmail</h1>${needBien()}`;
    const horsLigne = location.protocol === 'file:';
    const guide = `<details ${g.clientId ? '' : 'open'}><summary>Configuration (une seule fois, environ 5 minutes)</summary>
      <ol class="small">
        <li>Ouvrez <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener">console.cloud.google.com</a> avec votre compte Gmail et créez un projet (ex. « Gestion locative »).</li>
        <li><i>API et services → Bibliothèque</i> : activez <b>Gmail API</b>.</li>
        <li><i>Écran de consentement OAuth</i> (ou <i>Google Auth Platform</i>) : type <b>Externe</b>, nom de l'application et votre e-mail ; dans <i>Audience / Utilisateurs test</i>, ajoutez <b>votre adresse Gmail</b>. Laissez l'application en mode « Test ».</li>
        <li><i>Identifiants → Créer → ID client OAuth</i> : type <b>Application Web</b>, et dans <i>Origines JavaScript autorisées</i> ajoutez :<br><code>${h(horsLigne ? 'http://localhost:8000' : location.origin)}</code></li>
        <li>Copiez l'<b>ID client</b> (se termine par <code>.apps.googleusercontent.com</code>) ci-dessous.</li>
      </ol>
      <p class="small muted">L'accès est en <b>lecture seule</b>. Le navigateur dialogue directement avec Google : ni vos e-mails ni vos PDF ne passent par un autre serveur.
      Google affichera « application non validée » : c'est normal pour une application personnelle en mode Test, cliquez sur <i>Continuer</i>.</p></details>`;
    const regles = g.regles.map(
      (r) => `<tr><td><b>${h(r.nom)}</b></td><td>${{ appel: 'Appels de fonds', gerance: 'Relevés de gérance', auto: 'Automatique' }[r.type] || ''}</td>
        <td><code>${h(r.requete)}</code></td><td>${h(bienNom(r.bienId))}</td><td class="num">${r.type === 'gerance' ? '—' : pct(r.pctRecup || 0)}</td>
        <td><button class="link" data-act="editRegle" data-id="${r.id}">Modifier</button><button class="link danger" data-act="delRegle" data-id="${r.id}">Supprimer</button></td></tr>`
    );
    const connecte = window.GmailSource && GmailSource.estConnecte();
    return `<div class="toolbar"><h1 style="margin:0">Import Gmail</h1><span class="spacer"></span>
        ${connecte ? '<span class="badge st-ok">Connecté à Gmail</span><button class="secondary" data-act="gmailDeco">Se déconnecter</button>' : ''}</div>
      <p class="muted small">Récupère automatiquement les PDF joints à vos e-mails (appels de fonds du syndic, relevés de gérance de l'agence), en extrait les montants et vous les fait vérifier avant de les ajouter.</p>
      ${horsLigne ? `<div class="card" style="border-color:var(--warn)"><b>Ouvrez l'outil via une adresse web pour utiliser Gmail.</b>
        <p class="small">Google refuse les connexions depuis un fichier ouvert directement. Utilisez la version en ligne (GitHub Pages) ou lancez dans le dossier de l'outil :
        <code>python3 -m http.server 8000</code> puis ouvrez <code>http://localhost:8000</code>.</p></div>` : ''}
      <div class="card" style="margin-top:12px"><h2 style="margin-top:0">1. Connexion Google</h2>${guide}
        <div class="toolbar" style="margin-top:10px"><input id="gmail-client" placeholder="123456789-xxxx.apps.googleusercontent.com" value="${h(g.clientId)}" style="max-width:460px">
        <button class="secondary" data-act="gmailClient">Enregistrer l'ID client</button></div></div>
      <div class="card" style="margin-top:12px"><div class="toolbar"><h2 style="margin:0">2. Règles de recherche</h2><span class="spacer"></span><button class="secondary" data-act="editRegle">+ Règle</button></div>
        ${g.regles.length ? table(['Nom', 'Type', 'Recherche', 'Bien', { label: 'Récup.', cls: 'num' }, ''], regles) : '<p class="muted">Ajoutez une règle par expéditeur : par exemple une pour votre syndic, une pour votre agence.</p>'}</div>
      <div class="card" style="margin-top:12px"><div class="toolbar"><h2 style="margin:0">3. Récupérer les documents</h2><span class="spacer"></span>
        <button data-act="gmailChercher" ${!g.clientId || !g.regles.length || gmailEnCours || horsLigne ? 'disabled' : ''}>${gmailEnCours ? 'Recherche en cours…' : '🔍 Chercher les nouveaux PDF'}</button></div>
        ${gmailJournal.length ? `<div class="small muted" id="gmail-journal">${gmailJournal.map(h).join('<br>')}</div>` : ''}
        ${vueDocsGmail()}</div>`;
  };

  function vueDocsGmail() {
    if (!gmailDocs.length) return '';
    const opt = (id) => db.biens.map((b) => `<option value="${b.id}" ${b.id === id ? 'selected' : ''}>${h(b.nom)}</option>`).join('');
    const inp = (i, k, v, type = 'number') => `<input data-gd="${i}" data-k="${k}" type="${type}" ${type === 'number' ? 'step="0.01"' : ''} value="${h(v ?? '')}" style="min-width:${type === 'text' ? 180 : 90}px">`;
    const conf = { bonne: 'st-ok', partielle: 'st-part', faible: 'st-due' };
    const rows = gmailDocs.map((d, i) => {
      const p = d.prop;
      const ent = `<td><select data-gd="${i}" data-k="action"><option value="importer" ${d.action === 'importer' ? 'selected' : ''}>Importer</option><option value="plus-tard" ${d.action === 'plus-tard' ? 'selected' : ''}>Plus tard</option><option value="ignorer" ${d.action === 'ignorer' ? 'selected' : ''}>Ignorer définitivement</option></select></td>
        <td><b>${h(d.fichier)}</b><div class="small muted">${h(d.sujet)}<br>${dateFr(d.dateMail)} — ${h(d.expediteur)}</div>
        <div class="small">${d.blobUrl ? `<a href="${d.blobUrl}" target="_blank" rel="noopener">Voir le PDF</a> · ` : ''}<a href="${h(d.lienMail)}" target="_blank" rel="noopener">Voir l'e-mail</a></div>
        ${d.erreur ? `<div class="small neg">${h(d.erreur)}</div>` : ''}<span class="badge ${conf[(d.extraction || {}).confiance] || 'st-due'}">lecture ${h((d.extraction || {}).confiance || 'faible')}</span></td>
        <td><select data-gd="${i}" data-k="bienId">${opt(p.bienId)}</select></td>`;
      if (p.type === 'gerance') {
        return `<tr>${ent}<td>Relevé de gérance<br>${inp(i, 'periode', p.periode, 'month')}</td>
          <td><label class="small muted">Loyer + provisions encaissés${inp(i, 'encaisse', p.encaisse)}</label>
          <label class="small muted">Honoraires TTC${inp(i, 'honoraires', p.honoraires)}</label>
          <label class="small muted">Garantie loyers impayés${inp(i, 'assurance', p.assurance)}</label>
          ${p.net !== null && p.net !== undefined ? `<div class="small muted">Net versé lu : ${eur(p.net)}</div>` : ''}</td></tr>`;
      }
      return `<tr>${ent}<td>Appel de fonds<br>${inp(i, 'date', p.date, 'date')}<br>${inp(i, 'libelle', p.libelle, 'text')}</td>
        <td><label class="small muted">Charges${inp(i, 'montant', p.montant)}</label>
        <label class="small muted">dont récupérable${inp(i, 'partRecuperable', p.partRecuperable)}</label>
        <label class="small muted">Fonds travaux${inp(i, 'fondsTravaux', p.fondsTravaux)}</label></td></tr>`;
    });
    return `<h2>Documents à vérifier (${gmailDocs.length})</h2>
      <p class="small muted">Contrôlez les montants lus dans chaque PDF (ouvrez-le au besoin) avant d'importer.</p>
      ${table(['Action', 'Document', 'Bien', 'Type', 'Montants'], rows)}
      <div class="toolbar" style="margin-top:10px"><span class="spacer"></span><button data-act="gmailImporter">Importer la sélection</button></div>`;
  }

  // Les champs du tableau de vérification mettent à jour les propositions en mémoire.
  el.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.gd === undefined) return;
    const d = gmailDocs[Number(t.dataset.gd)];
    if (!d) return;
    if (t.dataset.k === 'action') d.action = t.value;
    else d.prop[t.dataset.k] = t.type === 'number' ? (t.value === '' ? null : Number(t.value)) : t.value;
  });

  actions.gmailClient = () => {
    cfgGmail().clientId = document.getElementById('gmail-client').value.trim();
    save();
    render();
  };
  actions.editRegle = (d) => {
    const g = cfgGmail();
    const r = d.id ? g.regles.find((x) => x.id === d.id) : { type: 'appel', bienId: filtreBien || (db.biens[0] || {}).id, pctRecup: 70 };
    openForm(d.id ? 'Modifier la règle' : 'Nouvelle règle de recherche', champsRegle(), r, (v) => {
      const i = g.regles.findIndex((x) => x.id === v.id);
      if (i >= 0) g.regles[i] = v;
      else g.regles.push({ ...v, id: uid() });
      save();
    });
  };
  actions.delRegle = (d) => {
    if (!confirm('Supprimer cette règle ?')) return;
    const g = cfgGmail();
    g.regles = g.regles.filter((r) => r.id !== d.id);
    save();
    render();
  };
  actions.gmailDeco = () => {
    GmailSource.deconnecter();
    render();
  };
  actions.gmailChercher = async () => {
    const g = cfgGmail();
    gmailEnCours = true;
    gmailJournal = ['Connexion à Google…'];
    gmailDocs = [];
    render();
    const log = (m) => {
      gmailJournal.push(m);
      const j = document.getElementById('gmail-journal');
      if (j) j.innerHTML = gmailJournal.map(h).join('<br>');
    };
    try {
      await GmailSource.connecter(g.clientId);
      const connues = sourcesConnues();
      for (const regle of g.regles) {
        const docs = await GmailSource.chercher(regle, connues, log);
        for (const d of docs) {
          connues.add(d.source);
          d.prop = proposition(d, regle);
          d.action = d.erreur || (d.extraction || {}).confiance === 'faible' ? 'plus-tard' : 'importer';
          gmailDocs.push(d);
        }
      }
      gmailDocs.sort((a, b) => a.dateMail.localeCompare(b.dateMail));
      log(gmailDocs.length ? `${gmailDocs.length} nouveau(x) document(s) à vérifier.` : 'Aucun nouveau document.');
    } catch (e) {
      log('Erreur : ' + e.message);
    }
    gmailEnCours = false;
    render();
  };
  actions.gmailImporter = () => {
    const g = cfgGmail();
    const imp = { charges: [], paiements: [] };
    let ignores = 0;
    for (const d of gmailDocs) {
      if (d.action === 'ignorer') {
        g.ignores.push(d.source);
        ignores++;
      }
      if (d.action !== 'importer') continue;
      const ops = Extract.operationsDepuis(d.prop.type, d.source, d.prop);
      imp.charges.push(...ops.charges);
      imp.paiements.push(...ops.paiements);
    }
    const r = C.fusionnerOperations(db, imp, uid);
    const msg = [`${r.ajouts.charges} charge(s) et ${r.ajouts.paiements} encaissement(s) importé(s).`, ignores ? `${ignores} document(s) ignoré(s) définitivement.` : '', r.erreurs.length ? `Non importés :\n- ${r.erreurs.join('\n- ')}` : '']
      .filter(Boolean)
      .join('\n');
    if (!confirm(msg.replace('importé(s)', 'à importer') + '\n\nConfirmer ?')) return;
    db = { ...r.data, gmail: g };
    save();
    for (const d of gmailDocs) if (d.blobUrl && d.action !== 'plus-tard') URL.revokeObjectURL(d.blobUrl);
    gmailDocs = gmailDocs.filter((d) => d.action === 'plus-tard');
    gmailJournal.push(msg);
    render();
  };

  // ---------- Paramètres ----------
  views.parametres = () => {
    const n = (k) => db[k].length;
    return `<h1>Paramètres</h1>
      <div class="card"><h2 style="margin-top:0">Bailleur</h2>
        <p class="small muted">Utilisé sur les quittances, avis d'échéance et décomptes de charges.</p>
        <p><b>${h(db.bailleur.nom || '—')}</b><br>${h(db.bailleur.adresse || '').replace(/\n/g, '<br>')}</p>
        <button class="secondary" data-act="editBailleur">Modifier</button></div>
      <div class="card" style="margin-top:12px"><h2 style="margin-top:0">Sauvegarde</h2>
        <p class="small muted">Les données sont stockées dans ce navigateur uniquement (${n('biens')} biens, ${n('baux')} baux, ${n('paiements')} paiements, ${n('charges')} charges, ${n('prets')} prêts).
        Exportez régulièrement un fichier de sauvegarde ; il permet aussi de transférer les données sur un autre appareil.
        La sauvegarde est chiffrée : il faudra le mot de passe actuel pour la réimporter.</p>
        <div class="toolbar"><button data-act="export">⬇ Exporter (JSON)</button>
        <label class="btn secondary" style="border:1px solid var(--border);background:var(--surface);color:var(--text)">⬆ Importer<input type="file" accept=".json,application/json" data-change="import" hidden></label>
        <button class="secondary" data-act="exportCSV">Exporter paiements & charges (CSV)</button></div></div>
      <div class="card" style="margin-top:12px"><h2 style="margin-top:0">Mot de passe</h2>
        <p class="small muted">Vos données sont chiffrées avec ce mot de passe (AES-256). L'outil se verrouille après ${VERROU_MINUTES} minutes d'inactivité.
        <b>Un mot de passe oublié ne peut pas être récupéré</b> : conservez-le précieusement.</p>
        <button class="secondary" data-act="changerMdp">Changer le mot de passe</button></div>
      <div class="card" style="margin-top:12px"><h2 style="margin-top:0">Importer des opérations</h2>
        <p class="small muted">Ajoute des appels de fonds du syndic, des encaissements ou des frais tirés des relevés de gérance (fichier préparé par Claude à partir de vos e-mails, par exemple),
        <b>sans remplacer</b> vos données. Les pièces déjà importées sont ignorées.</p>
        <label class="btn" style="display:inline-block">⬆ Importer des opérations (JSON)<input type="file" accept=".json,application/json" data-change="importOps" hidden></label></div>
      <div class="card" style="margin-top:12px"><h2 style="margin-top:0">Zone sensible</h2>
        <div class="toolbar"><button class="secondary" data-act="demo">Charger des données d'exemple</button>
        <button class="danger" data-act="reset">Tout effacer</button></div></div>`;
  };
  actions.editBailleur = () =>
    openForm('Bailleur', [{ name: 'nom', label: 'Nom / raison sociale (SCI…)', full: true, required: true }, { name: 'adresse', label: 'Adresse', type: 'textarea' }], db.bailleur, (v) => {
      db.bailleur = v;
      save();
    });
  actions.export = async () => {
    const env = await Coffre.chiffrer(cle, db);
    download(`gestion-locative-${today()}.json`, new Blob([JSON.stringify(env)], { type: 'application/json' }));
  };
  actions.import = (_, input) => {
    const f = input.files[0];
    if (!f) return;
    f.text().then((txt) => {
      try {
        const d = JSON.parse(txt);
        const remplacer = (donnees) => {
          if (!Array.isArray(donnees.biens)) throw new Error('fichier non reconnu');
          if (!confirm('Remplacer toutes les données actuelles par celles du fichier ?')) return;
          db = { ...empty(), ...donnees };
          save();
          render();
        };
        if (!Coffre.estEnveloppe(d)) return remplacer(d);
        openForm(
          'Sauvegarde chiffrée',
          [{ name: 'mdp', label: 'Mot de passe en vigueur lors de cette sauvegarde', type: 'password', required: true, full: true }],
          {},
          (v) => {
            Coffre.ouvrir(v.mdp, d)
              .then((o) => {
                modal.close();
                remplacer(o.donnees);
              })
              .catch((e) => alert(e.message));
            return false;
          },
          'Ouvrir'
        );
      } catch (e) {
        alert('Import impossible : ' + e.message);
      }
    });
  };
  actions.importOps = (_, input) => {
    const f = input.files[0];
    input.value = '';
    if (!f) return;
    f.text().then((txt) => {
      try {
        const imp = JSON.parse(txt);
        if (!Array.isArray(imp.charges) && !Array.isArray(imp.paiements)) throw new Error('le fichier doit contenir « charges » et/ou « paiements »');
        const r = C.fusionnerOperations(db, imp, uid);
        const msg = [
          `${r.ajouts.charges} charge(s) et ${r.ajouts.paiements} encaissement(s) à ajouter.`,
          r.ignores ? `${r.ignores} opération(s) déjà présente(s), ignorée(s).` : '',
          r.erreurs.length ? `\n${r.erreurs.length} opération(s) non importable(s) :\n- ${r.erreurs.slice(0, 10).join('\n- ')}` : '',
        ].filter(Boolean).join('\n');
        if (!r.ajouts.charges && !r.ajouts.paiements) return alert('Rien à importer.\n' + msg);
        if (!confirm(msg + '\n\nConfirmer l\'import ?')) return;
        db = r.data;
        save();
        render();
      } catch (e) {
        alert('Import impossible : ' + e.message);
      }
    });
  };
  actions.exportCSV = () => {
    const rows = [['Type', 'Date', 'Période', 'Bien', 'Locataire / Catégorie', 'Libellé', 'Montant', 'Récupérable']];
    for (const p of db.paiements) {
      const b = bailById(p.bailId) || {};
      rows.push(['Encaissement', p.date, p.periode, bienNom(b.bienId), b.locataire || '', p.note || p.mode || '', p.montant, '']);
    }
    for (const c of db.charges) rows.push(['Charge', c.date, (c.date || '').slice(0, 7), bienNom(c.bienId), catLabel(c.categorie), c.libelle, -(Number(c.montant) || 0), c.partRecuperable || 0]);
    rows.sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    downloadCSV(`mouvements-${today()}.csv`, rows);
  };
  actions.reset = () => {
    if (!confirm('Effacer définitivement toutes les données de ce navigateur ?')) return;
    if (!confirm('Vraiment ? Exportez une sauvegarde avant si besoin.')) return;
    db = empty();
    save();
    render();
  };
  actions.demo = () => {
    if ((db.biens.length || db.baux.length) && !confirm('Remplacer les données actuelles par un exemple ?')) return;
    db = demoData();
    save();
    location.hash = 'dashboard';
    render();
  };

  actions.changerMdp = () =>
    openForm(
      'Changer le mot de passe',
      [
        { name: 'ancien', label: 'Mot de passe actuel', type: 'password', required: true, full: true },
        { name: 'nouveau', label: 'Nouveau mot de passe (8 caractères minimum)', type: 'password', required: true, full: true },
        { name: 'confirmation', label: 'Confirmer le nouveau mot de passe', type: 'password', required: true, full: true },
      ],
      {},
      (v) => {
        if (v.nouveau.length < 8) return alert('Le mot de passe doit contenir au moins 8 caractères.'), false;
        if (v.nouveau !== v.confirmation) return alert('Les deux mots de passe ne correspondent pas.'), false;
        Coffre.ouvrir(v.ancien, JSON.parse(lireLocal(VAULT_KEY)))
          .then(() => Coffre.deriverCle(v.nouveau))
          .then((c) => {
            cle = c;
            save();
            modal.close();
            alert('Mot de passe modifié. Pensez à refaire une sauvegarde : les anciennes demandent l\'ancien mot de passe.');
          })
          .catch((e) => alert(e.message));
        return false;
      },
      'Modifier'
    );

  function download(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function downloadCSV(name, rows) {
    const esc = (v) => {
      const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v ?? '');
      return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    download(name, new Blob(['﻿' + rows.map((r) => r.map(esc).join(';')).join('\n')], { type: 'text/csv;charset=utf-8' }));
  }

  function demoData() {
    const y = new Date().getFullYear();
    const d = empty();
    d.bailleur = { nom: 'Jean Exemple', adresse: '1 place de la Mairie\n69000 Lyon' };
    d.biens.push({ id: 'bien1', nom: 'T2 Croix-Rousse', type: 'appartement', adresse: '12 rue d’Austerlitz, 69004 Lyon', lot: '14 + cave 32', surface: 42, copropriete: 'Résidence Les Canuts', syndic: 'Cabinet Syndic & Co', tantiemes: 186, tantiemesTotal: 10000, prixAchat: 185000, fraisAcquisition: 14500, dateAchat: `${y - 3}-03-15` });
    d.biens.push({ id: 'bien2', nom: 'Studio Part-Dieu', type: 'studio', adresse: '45 rue Garibaldi, 69003 Lyon', lot: '7', surface: 22, copropriete: 'Le Garibaldi', syndic: 'Foncia', tantiemes: 95, tantiemesTotal: 5000, prixAchat: 112000, fraisAcquisition: 9200, dateAchat: `${y - 2}-09-01` });
    d.baux.push({ id: 'bail1', bienId: 'bien1', typeBail: 'vide', locataire: 'Marie Martin', email: 'marie@example.com', dateDebut: `${y - 2}-05-01`, loyerHC: 780, provisionCharges: 90, depotGarantie: 780, jourPaiement: 5, irlTrimestre: `T1 ${y - 1}`, irlValeur: 143.46 });
    d.baux.push({ id: 'bail2', bienId: 'bien2', typeBail: 'meuble', locataire: 'Lucas Bernard', dateDebut: `${y}-02-15`, loyerHC: 560, provisionCharges: 45, depotGarantie: 1120, jourPaiement: 1 });
    d.prets.push({ id: 'pret1', bienId: 'bien1', libelle: 'Prêt immobilier', banque: 'Crédit Mutuel', capital: 170000, tauxAnnuel: 1.85, dureeMois: 240, dateDebut: `${y - 3}-05-05`, assuranceMensuelle: 28, fraisDossier: 1200 });
    d.prets.push({ id: 'pret2', bienId: 'bien2', libelle: 'Prêt immobilier', banque: 'BNP', capital: 105000, tauxAnnuel: 3.6, dureeMois: 300, dateDebut: `${y - 2}-10-10`, assuranceMensuelle: 19 });
    const cur = currentPeriod();
    for (const b of d.baux) {
      for (const e of C.echeancesBail(b, `${y - 1}-01`, cur)) {
        if (e.periode === cur && b.id === 'bail2') continue; // un impayé pour l'exemple
        d.paiements.push({ id: uid(), bailId: b.id, periode: e.periode, montant: e.du, date: `${e.periode}-0${b.jourPaiement || 5}`, mode: 'Virement' });
      }
    }
    for (const yy of [y - 1, y]) {
      for (const [bienId, m, r] of [['bien1', 420, 290], ['bien2', 210, 150]]) {
        for (let q = 0; q < 4; q++) d.charges.push({ id: uid(), bienId, categorie: 'copro', libelle: `Appel de fonds T${q + 1} ${yy}`, date: `${yy}-${String(q * 3 + 1).padStart(2, '0')}-01`, montant: m, partRecuperable: r });
      }
      d.charges.push({ id: uid(), bienId: 'bien1', categorie: 'taxe_fonciere', libelle: `Taxe foncière ${yy}`, date: `${yy}-10-15`, montant: 1140, partRecuperable: 165 });
      d.charges.push({ id: uid(), bienId: 'bien2', categorie: 'taxe_fonciere', libelle: `Taxe foncière ${yy}`, date: `${yy}-10-15`, montant: 690, partRecuperable: 95 });
      d.charges.push({ id: uid(), bienId: 'bien1', categorie: 'assurance_pno', libelle: `Assurance PNO ${yy}`, date: `${yy}-01-10`, montant: 145, partRecuperable: 0 });
    }
    d.charges.push({ id: uid(), bienId: 'bien1', categorie: 'travaux', libelle: 'Remplacement chauffe-eau', date: `${y}-03-22`, montant: 980, partRecuperable: 0 });
    return d;
  }

  // ---------- Verrouillage ----------
  function verrouiller() {
    enregistrements.then(() => location.reload());
  }
  document.getElementById('verrou').onclick = verrouiller;
  let minuteur;
  function activite() {
    clearTimeout(minuteur);
    if (cle) minuteur = setTimeout(verrouiller, VERROU_MINUTES * 60000);
  }
  for (const ev of ['mousemove', 'keydown', 'click', 'touchstart', 'scroll']) window.addEventListener(ev, activite, { passive: true });

  function ecranVerrou(message) {
    document.body.classList.add('locked');
    const env = lireLocal(VAULT_KEY);
    const anciennes = !env && lireLocal(STORE_KEY);
    const creation = !env;
    el.innerHTML = `<div class="card verrou">
      <h1>🔒 ${creation ? 'Choisissez un mot de passe' : 'Gestion locative verrouillée'}</h1>
      ${creation ? `<p class="small muted">Il protège vos données : elles sont chiffrées dans ce navigateur et illisibles sans lui.
        ${anciennes ? '<b>Vos données existantes vont être chiffrées.</b>' : ''}<br><b>Il ne peut pas être récupéré en cas d'oubli</b> — notez-le en lieu sûr.</p>` : ''}
      <form id="verrou-form" class="form-grid" autocomplete="on">
        <input type="text" name="username" value="gestion-locative" autocomplete="username" hidden>
        <label class="full">Mot de passe<input type="password" name="mdp" required autofocus autocomplete="${creation ? 'new-password' : 'current-password'}" ${creation ? 'minlength="8"' : ''}></label>
        ${creation ? '<label class="full">Confirmer le mot de passe<input type="password" name="confirmation" required autocomplete="new-password"></label>' : ''}
        <div class="full"><button type="submit">${creation ? 'Créer et ouvrir' : 'Déverrouiller'}</button></div>
        <p class="full small neg" id="verrou-msg">${h(message || '')}</p>
      </form>
      ${creation ? '' : '<p class="small muted">Mot de passe oublié ? Seule une sauvegarde accompagnée de son mot de passe permet de retrouver les données. <button class="link danger" id="verrou-reset">Tout effacer et recommencer</button></p>'}
    </div>`;
    const form = document.getElementById('verrou-form');
    form.mdp.focus();
    const reset = document.getElementById('verrou-reset');
    if (reset) {
      reset.onclick = () => {
        if (!confirm('Effacer définitivement toutes les données chiffrées de ce navigateur ?')) return;
        localStorage.removeItem(VAULT_KEY);
        ecranVerrou();
      };
    }
    form.onsubmit = async (e) => {
      e.preventDefault();
      const msg = document.getElementById('verrou-msg');
      const bouton = form.querySelector('button');
      bouton.disabled = true;
      msg.textContent = '';
      try {
        if (creation) {
          if (form.mdp.value !== form.confirmation.value) throw new Error('Les deux mots de passe ne correspondent pas.');
          cle = await Coffre.deriverCle(form.mdp.value);
          try {
            if (anciennes) db = { ...empty(), ...JSON.parse(anciennes) };
          } catch (_) {
            /* données illisibles : on repart de zéro */
          }
          save();
        } else {
          const o = await Coffre.ouvrir(form.mdp.value, JSON.parse(env));
          cle = o.cle;
          db = { ...empty(), ...o.donnees };
        }
        document.body.classList.remove('locked');
        activite();
        render();
      } catch (err) {
        msg.textContent = err.message;
        bouton.disabled = false;
        form.mdp.select();
      }
    };
  }

  if (!window.crypto || !crypto.subtle) {
    el.innerHTML = '<div class="card">Ce navigateur ne permet pas le chiffrement des données : ouvrez l\'outil via son adresse https (GitHub Pages) ou http://localhost.</div>';
  } else {
    ecranVerrou();
  }
})();