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
    proprietaires: [],
    gestionnaires: [],
    biens: [],
    baux: [],
    paiements: [],
    charges: [],
    decomptes: [],
    contacts: [],
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
  function save(options) {
    if (!cle) return;
    if (!(options && options.local)) planifierEnvoi();
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
  const proprio = (bien) => db.proprietaires.find((p) => p.id === (bien || {}).proprietaireId) || { nom: db.bailleur.nom, adresse: db.bailleur.adresse, type: 'perso' };
  const gestionnaire = (bien) => (bien && bien.gestionMode === 'agence' && db.gestionnaires.find((g) => g.id === bien.gestionnaireId)) || null;
  const catLabel = (c) => (C.CATEGORIES[c] || { label: c }).label;
  const periodeLabel = (p) => {
    const [y, m] = p.split('-').map(Number);
    return `${MOIS[m - 1]} ${y}`;
  };
  const periodeLong = (p) =>
    new Date(p + '-01T00:00:00').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const bienOptions = () => db.biens.map((b) => [b.id, b.nom]);
  const bailOptions = () => db.baux.map((b) => [b.id, `${b.locataire} — ${bienNom(b.bienId)}`]);

  // Certains navigateurs intégrés aux applications (liens ouverts depuis une messagerie…) refusent
  // les fenêtres de confirmation sans les afficher : on le détecte pour prévenir l'utilisateur.
  let dialoguesBloques = false;
  const confirmNatif = window.confirm.bind(window);
  window.confirm = (message) => {
    const t = performance.now();
    const r = confirmNatif(message);
    if (!r && performance.now() - t < 40 && !dialoguesBloques) {
      dialoguesBloques = true;
      setTimeout(() => render(), 0);
    }
    return r;
  };

  // Lien d'import (#import=…) : mis de côté puis retiré de l'adresse immédiatement.
  let importEnAttente = null;
  if (location.hash.startsWith('#import=')) {
    importEnAttente = location.hash.slice('#import='.length);
    history.replaceState(null, '', location.pathname + location.search);
  }
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

  // ---------- Aides à la saisie : adresses (Base Adresse Nationale) et sociétés (SIREN) ----------
  function brancherAdresse(champ) {
    const mode = champ.dataset.adresse;
    const label = champ.closest('label');
    label.classList.add('ac');
    const liste = document.createElement('div');
    liste.className = 'ac-liste';
    liste.hidden = true;
    label.appendChild(liste);
    let minuteur;
    let seq = 0;
    let items = [];
    let actif = -1;
    let dernierChoix = null;
    const afficher = () => {
      liste.innerHTML = items.map((a, i) => `<div class="ac-item ${i === actif ? 'actif' : ''}" data-i="${i}">${h(a.label)}</div>`).join('');
      liste.hidden = !items.length;
    };
    const choisir = (a) => {
      dernierChoix = mode === 'bloc' ? `${a.ligne1}\n${a.ligne2}` : `${a.ligne1}, ${a.ligne2}`;
      champ.value = dernierChoix;
      items = [];
      liste.hidden = true;
    };
    liste.addEventListener('mousedown', (e) => {
      const it = e.target.closest('.ac-item');
      if (!it) return;
      e.preventDefault();
      choisir(items[Number(it.dataset.i)]);
    });
    champ.addEventListener('input', () => {
      clearTimeout(minuteur);
      if (champ.value === dernierChoix) return;
      const q = champ.value.replace(/\n/g, ' ');
      minuteur = setTimeout(async () => {
        const n = ++seq;
        try {
          const r = await Annuaire.rechercherAdresses(q);
          if (n !== seq) return;
          items = r;
          actif = -1;
          afficher();
        } catch (err) {
          liste.innerHTML = `<div class="ac-msg">Suggestions indisponibles : ${h(err.message)}</div>`;
          liste.hidden = false;
        }
      }, 250);
    });
    champ.addEventListener('keydown', (e) => {
      if (liste.hidden || !items.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        actif = (actif + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        afficher();
      } else if (e.key === 'Enter' && actif >= 0) {
        e.preventDefault();
        choisir(items[actif]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        liste.hidden = true;
      }
    });
    champ.addEventListener('blur', () => setTimeout(() => (liste.hidden = true), 150));
  }

  function brancherEntreprise(bloc) {
    const q = bloc.querySelector('.ent-q');
    const res = bloc.querySelector('.ent-res');
    let trouvees = [];
    const remplir = (e) => {
      const set = (nom, val) => {
        const c = modalForm.querySelector(`[name="${nom}"]`);
        if (c && val) c.value = val;
      };
      set('nom', e.nom);
      set('siren', e.siren);
      set('adresse', e.adresse);
      set('gerant', e.gerant);
      const type = modalForm.querySelector('[name="type"]');
      if (type && e.estSCI && !/^sci/.test(type.value)) type.value = 'sci_ir';
      majVisibilite();
      res.innerHTML = `<p class="pos">Fiche complétée avec ${h(e.nom)}. ${e.gerant && !e.gerantCertain ? `Le registre ne précise pas qui est gérant : vérifiez « ${h(e.gerant)} » (dirigeants : ${e.dirigeants.map((d) => h(d.nom)).join(', ')}). ` : ''}${e.estSCI ? "Vérifiez le régime fiscal (IR ou IS) : il n'est pas public. " : ''}Les associés et leurs parts ne figurent pas au registre public : complétez-les.</p>`;
    };
    const chercher = async () => {
      const texte = q.value.trim();
      if (texte.length < 3) return;
      res.innerHTML = '<p class="muted">Recherche…</p>';
      try {
        trouvees = await Annuaire.rechercherEntreprises(texte);
        if (!trouvees.length) return (res.innerHTML = '<p class="muted">Aucune société trouvée.</p>');
        if (trouvees.length === 1 && Annuaire.sirenValide(texte.replace(/\s/g, '').slice(0, 9))) return remplir(trouvees[0]);
        res.innerHTML = trouvees
          .map(
            (e, i) => `<div class="ent-item"><div><b>${h(e.nom)}</b> ${e.active ? '' : '<span class="badge st-due">cessée</span>'}<br>
              <span class="muted">SIREN ${h(e.siren)} · ${h(e.adresseLigne)}${e.gerant ? ` · ${h(e.gerant)}` : ''}${e.dateCreation ? ` · créée le ${dateFr(e.dateCreation)}` : ''}</span></div>
              <button type="button" class="secondary" data-ent="${i}">Utiliser</button></div>`
          )
          .join('');
      } catch (err) {
        res.innerHTML = `<p class="neg">Recherche impossible : ${h(err.message)}</p>`;
      }
    };
    bloc.querySelector('.ent-go').onclick = chercher;
    q.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        chercher();
      }
    });
    q.addEventListener('input', () => {
      const c = q.value.replace(/\s/g, '');
      if (/^\d{9}$|^\d{14}$/.test(c)) chercher();
    });
    res.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ent]');
      if (b) remplir(trouvees[Number(b.dataset.ent)]);
    });
    // Un SIREN saisi directement dans son champ déclenche aussi la recherche si la fiche est vide.
    const siren = modalForm.querySelector('[name="siren"]');
    const nom = modalForm.querySelector('[name="nom"]');
    if (siren) {
      siren.addEventListener('change', () => {
        if (Annuaire.sirenValide(siren.value) && nom && !nom.value.trim()) {
          q.value = siren.value;
          chercher();
        }
      });
    }
  }

  function brancherAides() {
    if (!window.Annuaire) return;
    for (const c of modalForm.querySelectorAll('[data-adresse]')) brancherAdresse(c);
    for (const b of modalForm.querySelectorAll('.entreprise')) brancherEntreprise(b);
  }

  // Champs conditionnels : data-show-if="champ" data-show-val="valeur"
  function majVisibilite() {
    for (const lab of modalForm.querySelectorAll('[data-show-if]')) {
      const ctl = modalForm.querySelector(`[name="${lab.dataset.showIf}"]`);
      const val = ctl ? (ctl.type === 'checkbox' ? String(ctl.checked) : ctl.value) : '';
      lab.style.display = val === lab.dataset.showVal ? '' : 'none';
    }
  }
  modalForm.addEventListener('change', majVisibilite);

  /**
   * fields: [{ name, label, type, options, required, step, full, help, min, showIf: [champ, valeur] }]
   * type: text | number | date | month | select | textarea | checkbox | html
   */
  function openForm(title, fields, initial, onSubmit, okLabel = 'Enregistrer') {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-ok').textContent = okLabel;
    const body = fields
      .map((f) => {
        if (f.type === 'html') return `<div class="full">${f.html}</div>`;
        if (f.type === 'entreprise') {
          return `<div class="full entreprise"><label>Retrouver la société dans le registre public (SIREN, SIRET ou nom)
            <span class="ent-barre"><input type="search" class="ent-q" placeholder="ex. 398 599 324 ou SCI Les Canuts" autocomplete="off"><button type="button" class="secondary ent-go">Rechercher</button></span></label>
            <div class="ent-res small"></div></div>`;
        }
        const aide = f.adresse ? `data-adresse="${f.adresse}" autocomplete="off"` : '';
        const si = f.showIf ? `data-show-if="${f.showIf[0]}" data-show-val="${h(String(f.showIf[1]))}"` : '';
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
          input = `<textarea name="${f.name}" rows="3" ${aide}>${h(v)}</textarea>`;
        } else if (f.type === 'checkbox') {
          return `<label class="check ${cls}" ${si}><input type="checkbox" name="${f.name}" ${v ? 'checked' : ''}> ${h(f.label)}</label>`;
        } else {
          const step = f.type === 'number' ? `step="${f.step || '0.01'}"` : '';
          const min = f.min !== undefined ? `min="${f.min}"` : '';
          input = `<input type="${f.type || 'text'}" name="${f.name}" value="${h(v)}" ${step} ${min} ${req} ${aide}>`;
        }
        return `<label class="${cls}" ${si}>${h(f.label)}${f.required ? ' *' : ''}${input}${f.help ? `<span class="help">${h(f.help)}</span>` : ''}</label>`;
      })
      .join('');
    document.getElementById('modal-body').innerHTML = `<div class="form-grid">${body}</div>`;
    majVisibilite();
    brancherAides();
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
    if (location.hash.startsWith('#import=')) {
      const code = location.hash.slice('#import='.length);
      history.replaceState(null, '', location.pathname + location.search);
      if (cle) recevoirImport(code).then(render);
      else importEnAttente = code;
      return;
    }
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
    const avert = dialoguesBloques
      ? '<div class="card bandeau st-due" style="margin-bottom:12px">Ce navigateur bloque les fenêtres de confirmation : certaines actions (suppressions, imports de fichiers) ne peuvent pas aboutir. Ouvrez l\'outil dans Safari ou Chrome (menu « Ouvrir dans le navigateur »).</div>'
      : '';
    el.innerHTML = avert + htmlChoixCloud() + htmlBandeau() + fn();
  }

  // Filtre global : un bien, tous les biens d'un propriétaire (p:id) ou d'un mode de gestion (g:agence / g:direct)
  const idsFiltre = () => {
    if (!filtreBien) return null;
    if (filtreBien.startsWith('p:')) return db.biens.filter((b) => b.proprietaireId === filtreBien.slice(2)).map((b) => b.id);
    if (filtreBien.startsWith('g:')) return db.biens.filter((b) => (b.gestionMode || 'direct') === filtreBien.slice(2)).map((b) => b.id);
    return [filtreBien];
  };
  const dans = (bienId) => {
    const ids = idsFiltre();
    return !ids || ids.includes(bienId);
  };
  const bienDefaut = () => {
    const ids = idsFiltre();
    return (ids && ids[0]) || (db.biens[0] || {}).id;
  };
  function bienFilter() {
    if (!db.biens.length) return '';
    const o = (v, lab) => `<option value="${h(v)}" ${v === filtreBien ? 'selected' : ''}>${h(lab)}</option>`;
    const props = db.proprietaires.length > 1 ? `<optgroup label="Propriétaire">${db.proprietaires.map((p) => o('p:' + p.id, p.nom)).join('')}</optgroup>` : '';
    const gest = db.biens.some((b) => b.gestionMode === 'agence') ? `<optgroup label="Gestion">${o('g:agence', 'Biens gérés par agence')}${o('g:direct', 'Biens gérés en direct')}</optgroup>` : '';
    return `<select data-change="filtreBien">${o('', 'Tous les biens')}${props}${gest}<optgroup label="Bien">${db.biens.map((b) => o(b.id, b.nom)).join('')}</optgroup></select>`;
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
        <p>Cet outil vous aide à suivre vos biens en location, détenus en SCI ou en nom propre, gérés en direct ou par une agence, en copropriété ou non : loyers, charges et appels de fonds, régularisation annuelle, prêts immobiliers et revenus fonciers.</p>
        <p>Pour commencer : déclarez vos <b>SCI</b> et votre <b>gestionnaire</b>, puis vos <b>biens</b> (onglet Biens).</p>
        <p>Vos données restent <b>dans ce navigateur</b>. Pensez à faire des sauvegardes régulières depuis <a href="#parametres">Paramètres</a>.</p>
        <div class="toolbar"><button data-act="goto" data-v="biens">Ajouter un premier bien</button>
        <button class="secondary" data-act="demo">Charger un exemple</button></div>
      </div>`;
    }
    const s = C.syntheseAnnee(db, annee, idsFiltre());
    const kpi = (label, value, cls = '') => `<div class="card kpi"><div class="label">${label}</div><div class="value ${cls}">${value}</div></div>`;
    const lastPeriod = annee < Number(currentPeriod().slice(0, 4)) ? `${annee}-12` : currentPeriod();
    const impayes = [];
    if (annee <= Number(currentPeriod().slice(0, 4))) {
      for (const b of db.baux.filter((b) => dans(b.bienId))) {
        for (const e of C.situationBail(b, db.paiements, `${annee}-01`, lastPeriod)) {
          if (e.reste > 0.009 && C.dateEcheance(b, e.periode) <= today()) impayes.push({ b, e });
        }
      }
    }
    const totImpayes = impayes.reduce((t, { e }) => t + e.reste, 0);
    const parBien = db.biens
      .filter((b) => dans(b.id))
      .map((b) => {
        const x = C.syntheseAnnee(db, annee, b.id);
        const g = gestionnaire(b);
        return `<tr><td>${h(b.nom)}<div class="small muted">${h(proprio(b).nom || '')} · ${g ? h(g.nom) : 'gestion directe'}${b.enCopropriete ? '' : ' · hors copro'}</div></td><td class="num">${eur(x.encaisse)}</td><td class="num">${eur(x.chargesTotal)}</td>
          <td class="num">${eur(x.pretTotal)}</td><td class="num">${signed(x.cashFlow)}</td>
          <td class="num">${pct(x.rendementBrut)}</td><td class="num">${eur(x.crdFin)}</td></tr>`;
      });
    const parProprio =
      db.proprietaires.length > 1
        ? db.proprietaires
            .map((p) => {
              const ids = db.biens.filter((b) => b.proprietaireId === p.id && dans(b.id)).map((b) => b.id);
              if (!ids.length) return '';
              const x = C.syntheseAnnee(db, annee, ids);
              return `<tr><td><b>${h(p.nom)}</b><div class="small muted">${h(typeProprio(p))} · ${ids.length} bien(s)</div></td><td class="num">${eur(x.encaisse)}</td><td class="num">${eur(x.chargesTotal)}</td>
                <td class="num">${eur(x.pretTotal)}</td><td class="num">${signed(x.cashFlow)}</td><td class="num">${signed(x.resultatFoncier)}</td><td class="num">${eur(x.crdFin)}</td></tr>`;
            })
            .filter(Boolean)
        : [];
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
      ${parProprio.length ? `<h2>Par propriétaire</h2>${table(['Propriétaire', { label: 'Encaissé', cls: 'num' }, { label: 'Charges', cls: 'num' }, { label: 'Prêts', cls: 'num' }, { label: 'Cash-flow', cls: 'num' }, { label: 'Résultat fiscal est.', cls: 'num' }, { label: 'CRD 31/12', cls: 'num' }], parProprio)}` : ''}
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
      out.push(`Pensez à la <a href="#regularisation">régularisation des charges et de la TEOM ${prev}</a> une fois les comptes approuvés en AG (sélectionnez l'année ${prev}).`);
    }
    return out;
  }

  // ---------- Biens, propriétaires, gestionnaires ----------
  const champsBien = () => [
    { name: 'nom', label: 'Nom du bien', required: true, help: 'Ex. : T2 rue Victor Hugo' },
    { name: 'type', label: 'Type', type: 'select', options: [['appartement', 'Appartement'], ['studio', 'Studio'], ['maison', 'Maison'], ['parking', 'Parking / box'], ['local', 'Local commercial']] },
    { name: 'adresse', label: 'Adresse', full: true, required: true, adresse: 'ligne', help: 'Tapez le début de l’adresse puis choisissez une suggestion' },
    { name: 'proprietaireId', label: 'Propriétaire', type: 'select', options: db.proprietaires.map((p) => [p.id, p.nom]), placeholder: db.proprietaires.length ? '' : '— ajoutez d’abord une SCI ou un propriétaire —' },
    { name: 'surface', label: 'Surface (m²)', type: 'number' },
    { name: 'gestionMode', label: 'Gestion locative', type: 'select', options: [['direct', 'En direct (sans agence)'], ['agence', 'Confiée à un gestionnaire / agence']] },
    { name: 'gestionnaireId', label: 'Gestionnaire', type: 'select', options: db.gestionnaires.map((g) => [g.id, g.nom]), placeholder: '—', showIf: ['gestionMode', 'agence'] },
    { name: 'enCopropriete', label: 'Bien situé en copropriété (syndic, appels de fonds)', type: 'checkbox', full: true },
    { name: 'lot', label: 'N° de lot(s)', showIf: ['enCopropriete', true] },
    { name: 'copropriete', label: 'Copropriété / résidence', showIf: ['enCopropriete', true] },
    { name: 'syndic', label: 'Syndic', showIf: ['enCopropriete', true] },
    { name: 'contactSyndic', label: 'Contact syndic', help: 'Gestionnaire, e-mail, extranet…', showIf: ['enCopropriete', true] },
    { name: 'tantiemes', label: 'Tantièmes du lot', type: 'number', step: '1', showIf: ['enCopropriete', true] },
    { name: 'tantiemesTotal', label: 'Tantièmes totaux', type: 'number', step: '1', showIf: ['enCopropriete', true] },
    { name: 'prixAchat', label: "Prix d'achat (€)", type: 'number' },
    { name: 'fraisAcquisition', label: 'Frais de notaire / agence (€)', type: 'number' },
    { name: 'dateAchat', label: "Date d'achat", type: 'date' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ];
  const champsProprio = [
    { type: 'entreprise' },
    { name: 'nom', label: 'Dénomination', required: true, help: 'Ex. : SCI Les Canuts' },
    { name: 'type', label: 'Forme', type: 'select', options: Object.entries(C.TYPES_PROPRIETAIRE).map(([k, v]) => [k, v.label]) },
    { name: 'gerant', label: 'Gérant / représentant', help: 'Signataire des quittances' },
    { name: 'siren', label: 'SIREN' },
    { name: 'adresse', label: 'Adresse (siège)', type: 'textarea', adresse: 'bloc' },
    { name: 'associes', label: 'Associés et parts', type: 'textarea', help: 'Une ligne par associé, ex. « Marie Dupont : 50 » — sert à répartir le résultat fiscal' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ];
  const champsGestionnaire = [
    { type: 'entreprise' },
    { name: 'nom', label: 'Nom du gestionnaire / agence', required: true },
    { name: 'siren', label: 'SIREN' },
    { name: 'adresse', label: 'Adresse', type: 'textarea', adresse: 'bloc' },
    { name: 'contact', label: 'Interlocuteur' },
    { name: 'email', label: 'E-mail', type: 'email', help: 'Sert à proposer une règle d’import Gmail' },
    { name: 'telephone', label: 'Téléphone' },
    { name: 'honorairesPct', label: 'Honoraires de gestion (% TTC des encaissements)', type: 'number', step: '0.01' },
    { name: 'notes', label: 'Notes (mandat, n° de compte…)', type: 'textarea' },
  ];
  const typeProprio = (p) => (C.TYPES_PROPRIETAIRE[p.type] || { label: '' }).label;
  views.biens = () => {
    const rows = db.biens.map((b) => {
      const bail = db.baux.find((x) => x.bienId === b.id && (!x.dateFin || x.dateFin >= today()));
      const g = gestionnaire(b);
      const copro = b.enCopropriete
        ? `${h(b.copropriete || 'Copropriété')}<div class="small muted">${h(b.syndic || '')}${b.tantiemes && b.tantiemesTotal ? ` · ${h(b.tantiemes)}/${h(b.tantiemesTotal)}` : ''}</div>`
        : '<span class="muted">Hors copropriété</span>';
      return `<tr><td><b>${h(b.nom)}</b><div class="small muted">${h(b.adresse)}</div></td>
        <td>${h(proprio(b).nom || '—')}</td>
        <td>${b.gestionMode === 'agence' ? `<span class="badge st-part">Agence</span> ${h(g ? g.nom : '?')}` : '<span class="badge st-future">Direct</span>'}</td>
        <td>${copro}</td>
        <td class="num">${eur((Number(b.prixAchat) || 0) + (Number(b.fraisAcquisition) || 0))}</td>
        <td>${bail ? `<span class="badge st-ok">Loué</span> ${h(bail.locataire)}` : '<span class="badge st-future">Vacant</span>'}</td>
        <td><button class="link" data-act="editBien" data-id="${b.id}">Modifier</button>
        <button class="link danger" data-act="delBien" data-id="${b.id}">Supprimer</button></td></tr>`;
    });
    const props = db.proprietaires.map((p) => {
      const nb = db.biens.filter((b) => b.proprietaireId === p.id).length;
      const ass = C.associes(p.associes);
      return `<tr><td><b>${h(p.nom)}</b><div class="small muted">${h(p.siren ? 'SIREN ' + p.siren : '')}</div></td><td>${h(typeProprio(p))}</td>
        <td>${h(p.gerant || '—')}</td><td class="small">${ass.map((a) => `${h(a.nom)}${a.pct === null ? '' : ' ' + pct(a.pct)}`).join('<br>') || '—'}</td><td class="num">${nb}</td>
        <td><button class="link" data-act="editProprio" data-id="${p.id}">Modifier</button><button class="link danger" data-act="delProprio" data-id="${p.id}">Supprimer</button></td></tr>`;
    });
    const gests = db.gestionnaires.map((g) => {
      const nb = db.biens.filter((b) => b.gestionMode === 'agence' && b.gestionnaireId === g.id).length;
      return `<tr><td><b>${h(g.nom)}</b><div class="small muted">${h(g.contact || '')}</div></td><td class="small">${h(g.email || '')}<br>${h(g.telephone || '')}</td>
        <td class="num">${g.honorairesPct ? pct(g.honorairesPct) : '—'}</td><td class="num">${nb}</td>
        <td><button class="link" data-act="editGest" data-id="${g.id}">Modifier</button><button class="link danger" data-act="delGest" data-id="${g.id}">Supprimer</button></td></tr>`;
    });
    return `<div class="toolbar"><h1 style="margin:0">Biens</h1><span class="spacer"></span><button data-act="editBien">+ Ajouter un bien</button></div>
      ${table(['Bien', 'Propriétaire', 'Gestion', 'Copropriété', { label: 'Coût total', cls: 'num' }, 'Occupation', ''], rows)}
      <div class="toolbar" style="margin-top:24px"><h2 style="margin:0">Propriétaires (SCI…)</h2><span class="spacer"></span><button class="secondary" data-act="editProprio">+ Propriétaire</button></div>
      ${table(['Dénomination', 'Forme', 'Gérant', 'Associés', { label: 'Biens', cls: 'num' }, ''], props)}
      <div class="toolbar" style="margin-top:24px"><h2 style="margin:0">Gestionnaires</h2><span class="spacer"></span><button class="secondary" data-act="editGest">+ Gestionnaire</button></div>
      ${table(['Gestionnaire', 'Contact', { label: 'Honoraires', cls: 'num' }, { label: 'Biens', cls: 'num' }, ''], gests)}`;
  };
  actions.editBien = (d) => {
    const b = d.id ? bienById(d.id) : { type: 'appartement', enCopropriete: true, gestionMode: 'direct', proprietaireId: (db.proprietaires[0] || {}).id, gestionnaireId: (db.gestionnaires[0] || {}).id };
    openForm(d.id ? 'Modifier le bien' : 'Nouveau bien', champsBien(), b, (v) => upsert('biens', v));
  };
  actions.delBien = (d) => {
    const n = db.baux.filter((b) => b.bienId === d.id).length + db.charges.filter((c) => c.bienId === d.id).length + db.prets.filter((p) => p.bienId === d.id).length;
    if (n) return alert(`Ce bien est utilisé par ${n} bail(s), charge(s) ou prêt(s). Supprimez-les d'abord.`);
    if (confirm('Supprimer ce bien ?')) {
      remove('biens', d.id);
      render();
    }
  };
  actions.editProprio = (d) => {
    const p = d.id ? db.proprietaires.find((x) => x.id === d.id) : { type: 'sci_ir' };
    openForm(d.id ? 'Modifier le propriétaire' : 'Nouveau propriétaire', champsProprio, p, (v) => upsert('proprietaires', v));
  };
  actions.delProprio = (d) => {
    if (db.biens.some((b) => b.proprietaireId === d.id)) return alert('Des biens appartiennent à ce propriétaire : changez-les de propriétaire d’abord.');
    if (confirm('Supprimer ce propriétaire ?')) {
      remove('proprietaires', d.id);
      render();
    }
  };
  actions.editGest = (d) => {
    const g = d.id ? db.gestionnaires.find((x) => x.id === d.id) : {};
    openForm(d.id ? 'Modifier le gestionnaire' : 'Nouveau gestionnaire', champsGestionnaire, g, (v) => upsert('gestionnaires', v));
  };
  actions.delGest = (d) => {
    if (db.biens.some((b) => b.gestionMode === 'agence' && b.gestionnaireId === d.id)) return alert('Des biens sont confiés à ce gestionnaire : modifiez-les d’abord.');
    if (confirm('Supprimer ce gestionnaire ?')) {
      remove('gestionnaires', d.id);
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
    { name: 'jourPaiement', label: 'Jour de paiement', type: 'number', step: '1', min: 1, default: 5, help: 'Le 30 : fin de mois (le 28 ou 29 en février)' },
    { name: 'paiementAuto', label: 'Paiement automatique (virement permanent) : chaque loyer est enregistré comme réglé à son échéance', type: 'checkbox', full: true },
    { name: 'paiementAutoMode', label: 'Mode de paiement', type: 'select', options: MODES.map((m) => [m, m]), showIf: ['paiementAuto', true] },
    { name: 'irlTrimestre', label: 'Trimestre IRL de référence', help: 'Ex. : T2 2026' },
    { name: 'irlValeur', label: 'Valeur IRL de référence', type: 'number', step: '0.01' },
    { name: 'garant', label: 'Garant / caution', full: true },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ];
  views.baux = () => {
    if (!db.biens.length) return `<h1>Locataires &amp; baux</h1>${needBien()}`;
    const rows = db.baux
      .filter((b) => dans(b.bienId))
      .sort((a, b) => (b.dateDebut || '').localeCompare(a.dateDebut || ''))
      .map((b) => {
        const actif = !b.dateFin || b.dateFin >= today();
        const cond = C.conditionsAu(b, actif ? currentPeriod() : (b.dateFin || currentPeriod()).slice(0, 7));
        return `<tr><td><b>${h(b.locataire)}</b><div class="small muted">${h(b.email || '')} ${h(b.telephone || '')}</div></td>
          <td>${h(bienNom(b.bienId))}</td>
          <td>${dateFr(b.dateDebut)}${b.dateFin ? ' → ' + dateFr(b.dateFin) : ''}<div>${actif ? '<span class="badge st-ok">En cours</span>' : '<span class="badge st-future">Terminé</span>'}</div></td>
          <td class="num">${eur(cond.loyerHC)}${(b.revisions || []).length ? `<div class="small muted">${b.revisions.length} révision(s)</div>` : ''}</td><td class="num">${eur(cond.provisionCharges)}</td>
          <td class="num"><b>${eur(cond.loyerHC + cond.provisionCharges)}</b></td>
          <td class="num">${eur(b.depotGarantie)}</td>
          <td><button class="link" data-act="editBail" data-id="${b.id}">Modifier</button>
          <button class="link" data-act="irl" data-id="${b.id}">Révision IRL</button>
          <button class="link" data-act="revisions" data-id="${b.id}">Historique du loyer</button>
          <button class="link" data-act="quittanceAnnuelle" data-id="${b.id}">Quittance annuelle</button>
          <button class="link" data-act="attestationPaiement" data-id="${b.id}">Attestation de paiement</button>
          <button class="link danger" data-act="delBail" data-id="${b.id}">Supprimer</button></td></tr>`;
      });
    return `<div class="toolbar"><h1 style="margin:0">Locataires &amp; baux</h1><span class="spacer"></span>${bienFilter()}<button data-act="editBail">+ Nouveau bail</button></div>
      ${table(['Locataire', 'Bien', 'Période', { label: 'Loyer HC', cls: 'num' }, { label: 'Provisions', cls: 'num' }, { label: 'Total CC', cls: 'num' }, { label: 'Dépôt', cls: 'num' }, ''], rows)}
      <p class="small muted">Le premier et le dernier mois sont automatiquement proratisés selon les dates d'entrée et de sortie.</p>`;
  };
  actions.editBail = (d) => {
    const b = d.id ? bailById(d.id) : { bienId: bienDefaut(), typeBail: 'vide', jourPaiement: 5 };
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
    const cond = C.conditionsAu(b, currentPeriod());
    const d0 = b.dateDebut ? new Date(b.dateDebut + 'T00:00:00') : new Date();
    let anniv = new Date(new Date().getFullYear(), d0.getMonth(), d0.getDate());
    if (anniv < new Date(Date.now() - 30 * 86400000)) anniv = new Date(anniv.getFullYear() + 1, anniv.getMonth(), anniv.getDate());
    openForm(
      `Révision IRL — ${b.locataire}`,
      [
        { type: 'html', html: `<p class="small muted">Nouveau loyer = loyer actuel × IRL du même trimestre de l'année / IRL de référence. Les indices sont publiés par l'INSEE. La révision s'ajoute à l'historique du bail : les échéances antérieures à la date d'effet ne changent pas.</p>` },
        { name: 'loyerHC', label: 'Loyer HC actuel (€)', type: 'number', required: true },
        { name: 'irlValeur', label: `IRL de référence ${b.irlTrimestre || ''}`, type: 'number', required: true },
        { name: 'irlTrimestre', label: 'Nouveau trimestre IRL', help: 'Ex. : T2 2026', required: true },
        { name: 'irlNouveau', label: 'Nouvel IRL', type: 'number', required: true },
        { name: 'date', label: "Date d'effet", type: 'date', required: true },
      ],
      { ...b, loyerHC: cond.loyerHC, irlTrimestre: '', date: anniv.toISOString().slice(0, 10) },
      (v) => {
        const nouveau = C.revisionIRL(v.loyerHC, v.irlValeur, v.irlNouveau);
        if (!confirm(`Nouveau loyer HC : ${eur(nouveau)} (au lieu de ${eur(v.loyerHC)}, soit ${eur(nouveau - v.loyerHC)}/mois) à compter du ${dateFr(v.date)}.\n\nAjouter cette révision au bail ?`)) return false;
        const revisions = [...(b.revisions || []), { date: v.date, loyerHC: nouveau, motif: `IRL ${v.irlTrimestre} (${v.irlValeur} → ${v.irlNouveau})` }];
        upsert('baux', { ...b, revisions, irlValeur: v.irlNouveau, irlTrimestre: v.irlTrimestre });
      },
      'Calculer'
    );
  };
  actions.revisions = (d) => {
    const b = bailById(d.id);
    const revs = [...(b.revisions || [])].sort((x, y) => x.date.localeCompare(y.date));
    const liste = revs.length
      ? `<table><tr><th>Effet</th><th class="num">Loyer HC</th><th class="num">Provisions</th><th>Motif</th><th></th></tr>${revs
          .map(
            (r) => `<tr><td>${dateFr(r.date)}</td><td class="num">${r.loyerHC !== undefined && r.loyerHC !== '' ? eur(r.loyerHC) : '—'}</td><td class="num">${r.provisionCharges !== undefined && r.provisionCharges !== '' ? eur(r.provisionCharges) : '—'}</td>
              <td class="small">${h(r.motif || '')}</td><td><button type="button" class="link danger" data-suppr-rev="${b.id}|${r.date}">Supprimer</button></td></tr>`
          )
          .join('')}</table>`
      : '<p class="muted">Aucune révision : le loyer initial s’applique sur toute la durée du bail.</p>';
    openForm(
      `Historique du loyer — ${b.locataire}`,
      [
        { type: 'html', html: `<p class="small">Au départ (${dateFr(b.dateDebut)}) : loyer ${eur(b.loyerHC)}, provisions ${eur(b.provisionCharges)}.</p>${liste}<h3 style="margin:12px 0 0">Ajouter une révision</h3>` },
        { name: 'date', label: "Date d'effet", type: 'date', required: true },
        { name: 'motif', label: 'Motif', help: 'Ex. : révision IRL, ajustement des provisions après régularisation' },
        { name: 'loyerHC', label: 'Nouveau loyer HC (€)', type: 'number', help: 'Laisser vide si inchangé' },
        { name: 'provisionCharges', label: 'Nouvelles provisions (€)', type: 'number', help: 'Laisser vide si inchangé' },
      ],
      { date: today() },
      (v) => {
        if (v.loyerHC === '' && v.provisionCharges === '') return alert('Indiquez un nouveau loyer ou de nouvelles provisions.'), false;
        const r = { date: v.date, motif: v.motif };
        if (v.loyerHC !== '') r.loyerHC = v.loyerHC;
        if (v.provisionCharges !== '') r.provisionCharges = v.provisionCharges;
        upsert('baux', { ...b, revisions: [...(b.revisions || []).filter((x) => x.date !== v.date), r] });
      },
      'Ajouter'
    );
  };

  // ---------- Loyers ----------
  views.loyers = () => {
    if (!db.baux.length) return `<h1>Loyers</h1>${needBien() || `<div class="card empty">Ajoutez d'abord un <a href="#baux">bail</a>.</div>`}`;
    const cur = currentPeriod();
    const baux = db.baux.filter((b) => (dans(b.bienId)) && C.joursOccupes(b, annee) > 0);
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
      const agence = gestionnaire(bienById(b.bienId));
      return `<tr><td><b>${h(b.locataire)}</b><div class="small muted">${h(bienNom(b.bienId))}</div>${agence ? `<span class="badge st-part" title="Loyers encaissés par le gestionnaire : saisis depuis ses relevés">via ${h(agence.nom)}</span>` : ''}</td>${cells}
        <td class="num">${eur(paye)}<div class="small muted">/ ${eur(total)}</div></td></tr>`;
    });
    const journal = db.paiements
      .filter((p) => (p.periode || '').startsWith(String(annee)))
      .filter((p) => dans((bailById(p.bailId) || {}).bienId))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map((p) => {
        const b = bailById(p.bailId) || {};
        const nature = p.nature === 'regularisation' ? `<span class="badge st-part">Régul. charges ${h(p.regulAnnee || '')}</span> ` : p.nature === 'teom' ? `<span class="badge st-part">TEOM ${h(p.regulAnnee || '')}</span> ` : p.nature === 'divers' ? '<span class="badge st-future">Divers</span> ' : '';
        return `<tr><td>${dateFr(p.date)}</td><td>${h(b.locataire || '?')}</td><td>${nature}${periodeLabel(p.periode)}</td><td>${h(p.mode || '')}</td>
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
      ? `<ul>${pays.map((p) => `<li>${dateFr(p.date)} — ${eur(p.montant)} (${h(p.mode || '')})${p.nature === 'regularisation' ? ' — régularisation des charges' : p.nature === 'teom' ? ' — TEOM' : ''}</li>`).join('')}</ul>`
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
    const sr = e.target.closest('[data-suppr-rev]');
    if (sr) {
      const [id, date] = sr.dataset.supprRev.split('|');
      const b = bailById(id);
      if (!confirm(`Supprimer la révision du ${dateFr(date)} ?`)) return;
      upsert('baux', { ...b, revisions: (b.revisions || []).filter((r) => r.date !== date) });
      modal.close();
      actions.revisions({ id });
      render();
      return;
    }
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
        { name: 'inclureAgence', label: 'Inclure les biens gérés par agence (normalement saisis depuis ses relevés)', type: 'checkbox', full: true },
        { name: 'date', label: 'Date de réception', type: 'date', required: true },
        { name: 'mode', label: 'Mode', type: 'select', options: MODES.map((m) => [m, m]) },
      ],
      { periode: currentPeriod(), date: today(), mode: 'Virement' },
      (v) => {
        let n = 0;
        for (const b of db.baux.filter((b) => dans(b.bienId) && (v.inclureAgence || (bienById(b.bienId) || {}).gestionMode !== 'agence'))) {
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

  /** Baux en virement permanent : enregistre les loyers échus non encore saisis. */
  function appliquerPaiementsAuto() {
    const ajouts = C.paiementsAutomatiques(db, today());
    if (!ajouts.length) return;
    db.paiements.push(...ajouts);
    save();
  }

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
  const enTete = (b, bien) => {
    const p = proprio(bien);
    const g = gestionnaire(bien);
    return `<div class="cols"><div><b>Bailleur</b><br>${h(p.nom || '(propriétaire — voir Biens)')}${p.siren ? `<br><span class="small">SIREN ${h(p.siren)}</span>` : ''}<br>${h(p.adresse || '').replace(/\n/g, '<br>')}
      ${g ? `<br><span class="small">Mandataire de gestion : ${h(g.nom)}</span>` : ''}</div>
      <div><b>Locataire</b><br>${h(b.locataire)}<br>${h(bien.adresse || '')}</div></div>`;
  };
  const signataire = (bien) => {
    const p = proprio(bien);
    return /^sci/.test(p.type || '') ? `${p.nom || '…'}, représentée par ${p.gerant || 'son gérant'},` : p.nom || '…';
  };

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
      <p>${/^sci/.test(proprio(bien).type || '') ? 'La' : 'Je soussigné(e)'} ${h(signataire(bien))} propriétaire du logement désigné ci-dessus, ${/^sci/.test(proprio(bien).type || '') ? 'déclare' : 'déclare'} avoir reçu de ${h(b.locataire)}
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

  // ---------- Quittance annuelle et attestation de paiement (aperçu, impression, PDF) ----------
  /*
   * Document structuré : { titre, sousTitre, bailleur: [lignes], locataire: [lignes], paragraphes: [],
   *   tableau: { colonnes: [{ label, num }], lignes: [[…]], total: […] }, suite: [], fait, signature: [lignes], mentions: [] }
   * rendu en HTML (aperçu et impression) ou en PDF (téléchargement).
   */
  function docHtml(d) {
    const lignes = (l) => l.map((x, i) => (i ? `<br><span class="small">${h(x)}</span>` : `<b>${h(x)}</b>`)).join('');
    const t = d.tableau;
    return `<div class="cols"><div>${lignes(d.bailleur)}</div><div>${lignes(d.locataire)}</div></div>
      <h1>${h(d.titre)}${d.sousTitre ? `<br><small>${h(d.sousTitre)}</small>` : ''}</h1>
      ${d.paragraphes.map((x) => `<p>${h(x)}</p>`).join('')}
      ${t ? `<table><tr>${t.colonnes.map((c) => `<td class="${c.num ? 'n' : ''}"><b>${h(c.label)}</b></td>`).join('')}</tr>
        ${t.lignes.map((l) => `<tr>${l.map((x, i) => `<td class="${t.colonnes[i].num ? 'n' : ''}">${h(x)}</td>`).join('')}</tr>`).join('')}
        ${t.total ? `<tr class="t">${t.total.map((x, i) => `<td class="${t.colonnes[i].num ? 'n' : ''}">${h(x)}</td>`).join('')}</tr>` : ''}</table>` : ''}
      ${(d.suite || []).map((x) => `<p>${h(x)}</p>`).join('')}
      <p>${h(d.fait)}</p><p>${d.signature.map(h).join('<br>')}</p><br><br>
      ${(d.mentions || []).map((x) => `<p class="small">${h(x)}</p>`).join('')}`;
  }
  const DOC_CSS = `.doc{font:14px/1.5 Georgia,serif;color:#111;background:#fff;padding:16px;border-radius:8px}
    .doc h1{font-size:20px;text-align:center;margin:20px 0}.doc table{width:100%;border-collapse:collapse;margin:12px 0}
    .doc td{padding:4px 6px;border-bottom:1px solid #ddd}.doc td.n{text-align:right}.doc tr.t td{font-weight:bold;border-top:2px solid #111}
    .doc .cols{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}.doc .small{font-size:12px;color:#555}`;

  let jsPdfCharge = null;
  function chargerJsPdf() {
    if (window.jspdf) return Promise.resolve(window.jspdf);
    jsPdfCharge =
      jsPdfCharge ||
      new Promise((ok, ko) => {
        const sc = document.createElement('script');
        sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        sc.onload = () => ok(window.jspdf);
        sc.onerror = () => ((jsPdfCharge = null), ko(new Error('création du PDF impossible (connexion internet ?)')));
        document.head.appendChild(sc);
      });
    return jsPdfCharge;
  }
  // Polices standard du PDF : espaces insécables remplacées, apostrophes et tirets typographiques conservés.
  const pdfTexte = (x) => String(x == null ? '' : x).replace(/[   ]/g, ' ');

  async function docPdf(d) {
    const { jsPDF } = await chargerJsPdf();
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    const G = 20;
    const L = 170;
    let y = 22;
    const saut = (hauteur) => {
      if (y + hauteur > 280) {
        pdf.addPage();
        y = 22;
      }
    };
    const bloc = (texte, taille = 10.5, style = 'normal', interligne = 1.45) => {
      pdf.setFont('helvetica', style);
      pdf.setFontSize(taille);
      for (const l of pdf.splitTextToSize(pdfTexte(texte), L)) {
        saut(taille * 0.3528 * interligne);
        pdf.text(l, G, y);
        y += taille * 0.3528 * interligne;
      }
    };
    // En-tête : bailleur à gauche, locataire à droite
    const colonne = (lignes, x, largeur) => {
      let yy = 22;
      lignes.forEach((l, i) => {
        pdf.setFont('helvetica', i ? 'normal' : 'bold');
        pdf.setFontSize(i ? 9 : 10.5);
        for (const s of pdf.splitTextToSize(pdfTexte(l), largeur)) {
          pdf.text(s, x, yy);
          yy += i ? 4.2 : 5;
        }
      });
      return yy;
    };
    y = Math.max(colonne(d.bailleur, G, 80), colonne(d.locataire, G + 95, 75)) + 10;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(16);
    pdf.text(pdfTexte(d.titre), 105, y, { align: 'center' });
    y += 7;
    if (d.sousTitre) {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(11);
      pdf.text(pdfTexte(d.sousTitre), 105, y, { align: 'center' });
      y += 6;
    }
    y += 6;
    for (const p of d.paragraphes) bloc(p), (y += 2.5);
    const t = d.tableau;
    if (t) {
      const n = t.colonnes.length;
      const larg = [L - (n - 1) * 27, ...Array(n - 1).fill(27)];
      const ligne = (cells, gras) => {
        saut(7);
        pdf.setFont('helvetica', gras ? 'bold' : 'normal');
        pdf.setFontSize(9.5);
        let x = G;
        cells.forEach((c, i) => {
          const txt = pdfTexte(c);
          if (t.colonnes[i].num) pdf.text(txt, x + larg[i] - 1.5, y, { align: 'right' });
          else pdf.text(pdf.splitTextToSize(txt, larg[i] - 2)[0] || '', x + 1.5, y);
          x += larg[i];
        });
        y += 2.2;
        pdf.setDrawColor(gras ? 40 : 205);
        pdf.setLineWidth(gras ? 0.4 : 0.2);
        pdf.line(G, y, G + L, y);
        y += 4.6;
      };
      y += 1;
      ligne(t.colonnes.map((c) => c.label), true);
      for (const l of t.lignes) ligne(l, false);
      if (t.total) ligne(t.total, true);
      y += 3;
    }
    for (const p of d.suite || []) bloc(p), (y += 2.5);
    y += 3;
    bloc(d.fait);
    y += 2;
    for (const s of d.signature) bloc(s);
    y += 22;
    for (const m of d.mentions || []) bloc(m, 8.5, 'italic', 1.35), (y += 1);
    pdf.setProperties({ title: pdfTexte(`${d.titre} ${d.sousTitre || ''}`), creator: 'Gestion locative' });
    return pdf;
  }

  /** Aperçu dans l'outil, avec téléchargement du PDF et impression (sans fenêtre surgissante). */
  function ouvrirDocument(d, nomFichier) {
    openForm(
      d.titre,
      [{ type: 'html', html: `<style>${DOC_CSS}</style><div class="doc">${docHtml(d)}</div><p class="small muted" id="doc-msg"></p>
        <div class="toolbar"><button type="button" class="secondary" id="doc-imprimer">🖨 Imprimer</button></div>` }],
      {},
      () => {
        const msg = document.getElementById('doc-msg');
        msg.textContent = 'Création du PDF…';
        docPdf(d)
          .then((pdf) => {
            pdf.save(nomFichier);
            msg.textContent = `PDF téléchargé : ${nomFichier}`;
          })
          .catch((e) => (msg.textContent = e.message));
        return false;
      },
      '⬇ Télécharger le PDF'
    );
    document.getElementById('doc-imprimer').onclick = () => printDoc(nomFichier.replace(/\.pdf$/, ''), docHtml(d));
  }

  const nomFichierDoc = (prefixe, b, suffixe) => `${prefixe}-${String(b.locataire).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '')}-${suffixe}.pdf`;
  function partiesDoc(b) {
    const bien = bienById(b.bienId) || {};
    const p = proprio(bien);
    const g = gestionnaire(bien);
    const sci = /^sci/.test(p.type || '');
    const gerant = p.gerant || 'son gérant';
    return {
      bien,
      bailleur: [`Bailleur : ${p.nom || '(propriétaire — voir Biens)'}`, ...(p.siren ? [`SIREN ${p.siren}`] : []), ...String(p.adresse || '').split('\n').filter(Boolean), ...(g ? [`Mandataire de gestion : ${g.nom}`] : [])],
      locataire: [`Locataire : ${b.locataire}`, ...String(bien.adresse || '').split(/\n|, (?=\d{5} )/).filter(Boolean)],
      declarant: sci ? `La société ${p.nom}, représentée par ${gerant} en qualité de gérant, propriétaire` : `Je soussigné(e), ${p.nom || '…'}, propriétaire`,
      signature: sci ? [`Pour ${p.nom}`, `${gerant}, en qualité de gérant`] : [p.nom || ''],
    };
  }
  const finDuMois = (periode) => {
    const [y, m] = periode.split('-').map(Number);
    return `${periode}-${String(C.daysInMonth(y, m)).padStart(2, '0')}`;
  };
  const debutDuMois = (b, e) => (b.dateDebut.slice(0, 7) === e.periode ? b.dateDebut : `${e.periode}-01`);
  const colonnesLoyer = [{ label: 'Mois' }, { label: 'Loyer HC', num: true }, { label: 'Charges', num: true }, { label: 'Total', num: true }, { label: 'Payé le', num: true }];

  function quittanceAnnuelle(b, annee) {
    const x = partiesDoc(b);
    const r = C.recapLoyers(b, db.paiements, `${annee}-01`, `${annee}-12`, today());
    if (!r.regles.length) return alert(`Aucun loyer réglé en ${annee} pour ${b.locataire}.`);
    const premier = r.regles[0];
    const dernier = r.regles[r.regles.length - 1];
    const finBail = b.dateFin && b.dateFin.slice(0, 7) === dernier.periode ? b.dateFin : finDuMois(dernier.periode);
    const anneeComplete = dernier.periode === `${annee}-12` || (b.dateFin && b.dateFin.slice(0, 7) === dernier.periode);
    const d = {
      titre: 'Quittance de loyer annuelle',
      sousTitre: `Année ${annee}`,
      bailleur: x.bailleur,
      locataire: x.locataire,
      paragraphes: [
        `${x.declarant} du logement désigné ci-dessus, déclare avoir reçu de ${b.locataire} la somme de ${eur(r.totalRegle)} (${eur(r.loyers)} de loyer et ${eur(r.provisions)} de provisions sur charges) au titre du paiement des loyers et charges pour la période du ${dateFr(debutDuMois(b, premier))} au ${dateFr(finBail)}, détaillée ci-dessous, et lui en donne quittance, sous réserve de tous ses droits.`,
      ],
      tableau: {
        colonnes: colonnesLoyer,
        lignes: r.regles.map((e) => [periodeLong(e.periode), eur(e.loyer), eur(e.provision), eur(e.paye), dateFr(e.datePaiement)]),
        total: ['Total', eur(r.loyers), eur(r.provisions), eur(r.totalRegle), ''],
      },
      suite: [
        ...(r.nonRegles.length ? [`Échéances non réglées à ce jour, non couvertes par la présente quittance : ${r.nonRegles.map((e) => `${periodeLong(e.periode)} (${eur(e.reste)})`).join(', ')}.`] : []),
        ...(anneeComplete ? [] : [`Quittance établie pour les échéances réglées au ${dateFr(today())}.`]),
      ],
      fait: `Fait le ${dateFr(today())}`,
      signature: x.signature,
      mentions: ['Cette quittance récapitulative remplace les quittances et reçus mensuels des mêmes termes. Délivrée gratuitement (article 21 de la loi n° 89-462 du 6 juillet 1989).'],
    };
    ouvrirDocument(d, nomFichierDoc('quittance-annuelle', b, annee));
  }

  const TYPES_BAIL = { vide: 'location vide', meuble: 'location meublée', etudiant: 'location meublée étudiante', mobilite: 'bail mobilité', parking: 'location de parking' };
  function attestationPaiement(b, date) {
    const x = partiesDoc(b);
    const fin = b.dateFin && b.dateFin < date ? b.dateFin : date;
    const r = C.recapLoyers(b, db.paiements, b.dateDebut.slice(0, 7), fin.slice(0, 7), date);
    const cond = C.conditionsAu(b, fin.slice(0, 7));
    const dernier = r.regles[r.regles.length - 1];
    const aJour = r.resteDu <= 0.009;
    const recents = r.mois.slice(-12);
    const d = {
      titre: 'Attestation de paiement des loyers',
      sousTitre: `Situation au ${dateFr(date)}`,
      bailleur: x.bailleur,
      locataire: x.locataire,
      paragraphes: [
        `${x.declarant} du logement désigné ci-dessus, atteste que ${b.locataire} ${b.dateFin && b.dateFin < date ? `a occupé ce logement en qualité de locataire du ${dateFr(b.dateDebut)} au ${dateFr(b.dateFin)}` : `occupe ce logement en qualité de locataire depuis le ${dateFr(b.dateDebut)}`}, en vertu d'un bail d'habitation (${TYPES_BAIL[b.typeBail] || 'location'}).`,
        `Le loyer mensuel s'élève à ${eur(cond.loyerHC)} hors charges, plus ${eur(cond.provisionCharges)} de provision sur charges, soit ${eur(cond.loyerHC + cond.provisionCharges)} charges comprises${b.jourPaiement ? `, payable le ${b.jourPaiement} de chaque mois` : ''}.`,
        aJour
          ? `À cette date, ${b.locataire} est à jour du paiement de ses loyers et charges : toutes les échéances depuis l'entrée dans les lieux ont été intégralement réglées${dernier ? `, la dernière (${periodeLong(dernier.periode)}) le ${dateFr(dernier.datePaiement)}` : ''}. Aucun impayé n'est à signaler.`
          : `À cette date, ${b.locataire} reste redevable de ${eur(r.resteDu)} au titre des échéances suivantes : ${r.nonRegles.map((e) => `${periodeLong(e.periode)} (${eur(e.reste)})`).join(', ')}.`,
      ],
      tableau: {
        colonnes: [{ label: 'Mois' }, { label: 'Montant dû', num: true }, { label: 'Montant réglé', num: true }, { label: 'Payé le', num: true }],
        lignes: recents.map((e) => [periodeLong(e.periode), eur(e.du), eur(e.paye), e.regle ? dateFr(e.datePaiement) : 'non réglé']),
      },
      suite: [`${recents.length < r.mois.length ? 'Détail des 12 dernières échéances. ' : ''}Attestation établie à la demande du locataire, pour servir et valoir ce que de droit.`],
      fait: `Fait le ${dateFr(today())}`,
      signature: x.signature,
    };
    ouvrirDocument(d, nomFichierDoc('attestation-paiement-loyers', b, date));
  }
  actions.quittanceAnnuelle = ({ id }) => {
    const b = bailById(id);
    const debut = Number(b.dateDebut.slice(0, 4));
    const fin = Math.min(Number((b.dateFin || today()).slice(0, 4)), Number(today().slice(0, 4)));
    const annees = [];
    for (let a = fin; a >= debut; a--) annees.push([String(a), String(a)]);
    openForm(`Quittance annuelle — ${b.locataire}`, [{ name: 'annee', label: 'Année', type: 'select', options: annees }], { annee: String(fin) }, (v) => {
      setTimeout(() => quittanceAnnuelle(b, v.annee));
    }, 'Afficher');
  };
  actions.attestationPaiement = ({ id }) => {
    const b = bailById(id);
    openForm(`Attestation de paiement — ${b.locataire}`, [{ type: 'html', html: '<p class="small muted">Atteste de la situation des paiements à la date choisie (à jour, ou montant restant dû), avec le détail des 12 dernières échéances.</p>' }, { name: 'date', label: 'Situation au', type: 'date', required: true }], { date: today() }, (v) => {
      setTimeout(() => attestationPaiement(b, v.date));
    }, 'Afficher');
  };

  // ---------- Charges ----------
  const champsCharge = () => [
    { name: 'bienId', label: 'Bien', type: 'select', options: bienOptions(), required: true },
    { name: 'categorie', label: 'Catégorie', type: 'select', options: Object.entries(C.CATEGORIES).map(([k, v]) => [k, v.label]), required: true },
    { name: 'libelle', label: 'Libellé', full: true, required: true, help: 'Ex. : Appel de fonds T1, régularisation exercice N-1, facture plombier…' },
    { name: 'date', label: 'Date', type: 'date', required: true },
    { name: 'montant', label: 'Montant payé (€)', type: 'number', required: true, help: 'Négatif pour un remboursement / régularisation créditrice' },
    { name: 'partRecuperable', label: 'Dont part récupérable (€)', type: 'number', help: 'Refacturable au locataire (décret 87-713) : eau, ascenseur, entretien des parties communes… Pour une taxe foncière : le montant de la TEOM.' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ];
  views.charges = () => {
    if (!db.biens.length) return `<h1>Charges</h1>${needBien()}`;
    const list = db.charges
      .filter((c) => (c.date || '').startsWith(String(annee)) && (dans(c.bienId)))
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

    const parCat = {};
    for (const c of list) parCat[c.categorie] = (parCat[c.categorie] || 0) + (Number(c.montant) || 0);
    return `<div class="toolbar"><h1 style="margin:0">Charges ${annee}</h1><span class="spacer"></span>${bienFilter()}
        ${db.biens.some((b) => b.enCopropriete) ? '<button class="secondary" data-act="appelsFonds">Générer les appels de fonds…</button>' : ''}<button data-act="editCharge">+ Charge</button></div>
      ${table(['Date', 'Bien', 'Catégorie', 'Libellé', { label: 'Montant', cls: 'num' }, { label: 'Récupérable', cls: 'num' }, { label: 'À ma charge', cls: 'num' }, ''], rows, rows.length ? foot : '')}
      ${Object.keys(parCat).length ? `<div class="cards" style="margin-top:12px">${Object.entries(parCat).map(([k, v]) => `<div class="card kpi"><div class="label">${h(catLabel(k))}</div><div class="value" style="font-size:17px">${eur(v)}</div></div>`).join('')}</div>` : ''}
      <p class="small muted" style="margin-top:12px">La régularisation des charges et le remboursement de la TEOM se font dans l'onglet <a href="#regularisation">Régularisation</a>.</p>`;
  };
  actions.editCharge = (d) => {
    const bienId = bienDefaut();
    const c = d.id ? db.charges.find((x) => x.id === d.id) : { bienId, categorie: (bienById(bienId) || {}).enCopropriete === false ? 'charges_directes' : 'copro', date: today() };
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
    const copros = db.biens.filter((b) => b.enCopropriete);
    if (!copros.length) return alert('Aucun bien en copropriété.');
    const defaut = (copros.find((b) => dans(b.id)) || copros[0]).id;
    openForm(
      'Générer les appels de fonds du syndic',
      [
        { type: 'html', html: '<p class="small muted">Crée les appels de provisions du budget prévisionnel voté en AG (généralement 4 appels trimestriels). Vous pourrez ajuster chaque ligne ensuite.</p>' },
        { name: 'bienId', label: 'Bien en copropriété', type: 'select', options: db.biens.filter((b) => b.enCopropriete).map((b) => [b.id, b.nom]), required: true },
        { name: 'nb', label: "Nombre d'appels", type: 'select', options: [[4, '4 (trimestriel)'], [12, '12 (mensuel)'], [2, '2 (semestriel)'], [1, '1 (annuel)']] },
        { name: 'montant', label: 'Montant par appel (€)', type: 'number', required: true },
        { name: 'partRecuperable', label: 'Part récupérable estimée par appel (€)', type: 'number', help: "Souvent 60 à 80 % des charges courantes ; à affiner avec l'annexe du budget" },
        { name: 'fondsTravaux', label: 'Cotisation fonds travaux par appel (€)', type: 'number', help: 'Loi ALUR — non récupérable' },
        { name: 'jour', label: "Jour d'exigibilité", type: 'number', step: '1', min: 1, default: 1 },
      ],
      { bienId: defaut, nb: 4, jour: 1 },
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
  // ---------- Régularisation des charges et TEOM ----------
  const champsDecompte = () => [
    { type: 'html', html: '<p class="small muted">Reportez le <b>décompte individuel de charges</b> envoyé par le syndic après l’approbation des comptes en AG : il indique les charges réelles du lot et la part récupérable sur le locataire.</p>' },
    { name: 'bienId', label: 'Bien en copropriété', type: 'select', options: db.biens.filter((b) => b.enCopropriete).map((b) => [b.id, b.nom]), required: true, full: true },
    { name: 'exerciceDebut', label: "Début de l'exercice", type: 'date', required: true },
    { name: 'exerciceFin', label: "Fin de l'exercice", type: 'date', required: true },
    { name: 'chargesTotales', label: 'Charges réelles du lot (€)', type: 'number' },
    { name: 'chargesRecuperables', label: 'Dont charges récupérables (€)', type: 'number', required: true },
    { name: 'dateApprobation', label: 'Date de l’AG / du décompte', type: 'date' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ];
  const statutRegul = (r) => {
    if (Math.abs(r.total) < 0.01) return '<span class="badge st-future">Rien à régulariser</span>';
    if (Math.abs(r.reste) < 0.01) return '<span class="badge st-ok">Réglée</span>';
    if (r.dejaCharges || r.dejaTeom) return `<span class="badge st-part">Partielle</span>`;
    return `<span class="badge st-due">${r.total > 0 ? 'À demander' : 'À rembourser'}</span>`;
  };
  const sensMontant = (n) =>
    n > 0.005 ? `<span class="neg">${eur(n)}</span><div class="small muted">dû par le locataire</div>` : n < -0.005 ? `<span class="pos">${eur(-n)}</span><div class="small muted">à lui rembourser</div>` : eur(0);

  views.regularisation = () => {
    if (!db.baux.length) return `<h1>Régularisation</h1>${needBien() || `<div class="card empty">Ajoutez d'abord un <a href="#baux">bail</a>.</div>`}`;
    const baux = db.baux.filter((b) => dans(b.bienId) && C.joursOccupes(b, annee) > 0);
    let totCharges = 0;
    let totTeom = 0;
    let totReste = 0;
    const rows = baux.map((b) => {
      const r = C.regularisationComplete(db, b, annee);
      const bien = bienById(b.bienId) || {};
      totCharges += r.charges.solde;
      totTeom += r.teom.montant;
      totReste += r.reste;
      const src =
        r.charges.source === 'decompte'
          ? '<span class="badge st-ok" title="Charges réelles approuvées">décompte syndic</span>'
          : bien.enCopropriete
            ? '<span class="badge st-part" title="Aucun décompte du syndic saisi pour cet exercice : estimation à partir des appels de fonds">estimation (appels)</span>'
            : '<span class="badge st-future">charges payées en direct</span>';
      const agence = gestionnaire(bien);
      return `<tr><td><b>${h(b.locataire)}</b><div class="small muted">${h(bien.nom || '')}${agence ? ` · géré par ${h(agence.nom)}` : ''}</div></td>
        <td>${src}<div class="small muted">${r.charges.jours} j · récup. ${eur(r.charges.chargesRecuperables)} − prov. ${eur(r.charges.provisions)}</div></td>
        <td class="num">${sensMontant(r.charges.solde)}</td>
        <td class="num">${r.teom.avisSaisi ? eur(r.teom.montant) : '<span class="small muted">avis de taxe foncière non saisi</span>'}<div class="small muted">${r.teom.avisSaisi ? `${eur(r.teom.teomBien)} × ${r.teom.jours} j` : ''}</div></td>
        <td class="num"><b>${sensMontant(r.total)}</b>${r.dejaCharges || r.dejaTeom ? `<div class="small muted">déjà réglé ${eur(r.dejaCharges + r.dejaTeom)}</div>` : ''}</td>
        <td>${statutRegul(r)}</td>
        <td><button class="link" data-act="decompte" data-id="${b.id}">🖨 Décompte</button>
        ${Math.abs(r.reste) >= 0.01 ? `<button class="link" data-act="enregRegul" data-id="${b.id}">Enregistrer le règlement</button>` : ''}</td></tr>`;
    });
    const foot = rows.length
      ? `<tr><td colspan="2">Total ${annee}</td><td class="num">${eur(totCharges)}</td><td class="num">${eur(totTeom)}</td><td class="num">${eur(totCharges + totTeom)}</td><td colspan="2">reste ${eur(totReste)}</td></tr>`
      : '';
    const decs = db.decomptes
      .filter((x) => dans(x.bienId))
      .sort((a, b) => (b.exerciceFin || '').localeCompare(a.exerciceFin || ''))
      .map(
        (x) => `<tr><td>${h(bienNom(x.bienId))}</td><td>${dateFr(x.exerciceDebut)} → ${dateFr(x.exerciceFin)}</td><td class="num">${x.chargesTotales !== '' && x.chargesTotales !== undefined ? eur(x.chargesTotales) : '—'}</td>
          <td class="num">${eur(x.chargesRecuperables)}</td><td>${dateFr(x.dateApprobation)}</td>
          <td><button class="link" data-act="editDecompte" data-id="${x.id}">Modifier</button><button class="link danger" data-act="delDecompte" data-id="${x.id}">Supprimer</button></td></tr>`
      );
    const sansAvis = baux.filter((b) => !C.teom(b, db.charges, annee).avisSaisi).map((b) => bienNom(b.bienId));
    return `<div class="toolbar"><h1 style="margin:0">Régularisation ${annee}</h1><span class="spacer"></span>${bienFilter()}
        ${db.biens.some((b) => b.enCopropriete) ? '<button class="secondary" data-act="editDecompte">+ Décompte du syndic</button>' : ''}
        <button class="secondary" data-act="avisTF">+ Avis de taxe foncière</button></div>
      <p class="small muted">Pour chaque locataire : régularisation des <b>charges récupérables</b> (réelles − provisions versées, au prorata de l'occupation) et remboursement de la
        <b>taxe d'enlèvement des ordures ménagères</b> de l'année (au prorata de l'occupation). Les charges d'un exercice se régularisent une fois les comptes approuvés en AG.</p>
      ${table(['Locataire', 'Base des charges', { label: 'Solde charges', cls: 'num' }, { label: 'TEOM', cls: 'num' }, { label: 'Total', cls: 'num' }, 'Statut', ''], rows, foot)}
      ${sansAvis.length ? `<p class="small muted">⚠ Avis de taxe foncière ${annee} non saisi pour : ${[...new Set(sansAvis)].map(h).join(', ')}. Saisissez-le avec le montant de la TEOM qui y figure.</p>` : ''}
      <h2>Décomptes annuels du syndic</h2>
      ${table(['Bien', 'Exercice', { label: 'Charges du lot', cls: 'num' }, { label: 'Récupérables', cls: 'num' }, 'AG / décompte', ''], decs)}
      <p class="small muted">Un décompte est utilisé pour la régularisation de l'année où se termine son exercice. Sans décompte, l'outil estime à partir des parts récupérables des appels de fonds.</p>`;
  };

  actions.editDecompte = (d) => {
    const x = d.id ? db.decomptes.find((y) => y.id === d.id) : { bienId: (db.biens.find((b) => b.enCopropriete && dans(b.id)) || {}).id, exerciceDebut: `${annee}-01-01`, exerciceFin: `${annee}-12-31` };
    openForm(d.id ? 'Modifier le décompte du syndic' : 'Décompte annuel du syndic', champsDecompte(), x, (v) => {
      if (v.exerciceFin < v.exerciceDebut) return alert("La fin de l'exercice précède son début."), false;
      upsert('decomptes', v);
    });
  };
  actions.delDecompte = (d) => {
    if (confirm('Supprimer ce décompte ?')) {
      remove('decomptes', d.id);
      render();
    }
  };
  actions.avisTF = () => {
    openForm(
      'Avis de taxe foncière',
      [
        { type: 'html', html: "<p class=\"small muted\">Saisissez le montant total de l'avis et la ligne « taxe d'enlèvement des ordures ménagères ». Seule la TEOM (hors frais de gestion de l'État) est récupérable sur le locataire.</p>" },
        { name: 'bienId', label: 'Bien', type: 'select', options: bienOptions(), required: true, full: true },
        { name: 'date', label: "Date de l'avis / échéance", type: 'date', required: true },
        { name: 'montant', label: "Montant total de l'avis (€)", type: 'number', required: true },
        { name: 'partRecuperable', label: 'Dont TEOM (€)', type: 'number', required: true },
      ],
      { bienId: bienDefaut(), date: `${annee}-10-15` },
      (v) => {
        const an = v.date.slice(0, 4);
        const existe = db.charges.find((c) => c.bienId === v.bienId && c.categorie === 'taxe_fonciere' && (c.date || '').startsWith(an));
        if (existe && !confirm(`Un avis de taxe foncière ${an} existe déjà pour ce bien (${eur(existe.montant)}). Le remplacer ?`)) return false;
        upsert('charges', { ...(existe || {}), bienId: v.bienId, categorie: 'taxe_fonciere', libelle: `Taxe foncière ${an}`, date: v.date, montant: v.montant, partRecuperable: v.partRecuperable });
      }
    );
  };
  actions.decompte = (d) => {
    const b = bailById(d.id);
    const bien = bienById(b.bienId) || {};
    const r = C.regularisationComplete(db, b, annee);
    const c = r.charges;
    const lignes = c.lignes.map((l) => `<tr><td>${dateFr(l.date)}</td><td>${h(l.libelle)}</td><td class="n">${eur(l.montant)}</td></tr>`).join('');
    const periodeCharges = c.source === 'decompte' ? `exercice du ${dateFr(c.debut)} au ${dateFr(c.fin)}` : `année ${annee}`;
    printDoc(
      `Régularisation ${annee} ${b.locataire}`,
      `${enTete(b, bien)}<h1>Régularisation des charges locatives<br><small>${h(periodeCharges)}${r.teom.avisSaisi ? ` — TEOM ${annee}` : ''}</small></h1>
      ${bien.enCopropriete ? `<p>Lot : ${h(bien.lot || '—')} — Copropriété : ${h(bien.copropriete || '—')}${bien.tantiemes ? ` — Quote-part : ${h(bien.tantiemes)}/${h(bien.tantiemesTotal)} tantièmes` : ''}</p>` : ''}
      <h3>1. Charges récupérables</h3>
      <table><tr><td><b>Date</b></td><td><b>Détail</b></td><td class="n"><b>Montant</b></td></tr>${lignes || '<tr><td colspan="3">Aucune charge récupérable</td></tr>'}
      <tr class="t"><td></td><td>Total des charges récupérables du logement</td><td class="n">${eur(c.chargesRecuperablesBien)}</td></tr></table>
      <table><tr><td>Votre occupation sur la période (${c.jours} jours)</td><td class="n">${(c.prorata * 100).toFixed(1)} %</td></tr>
      <tr><td>Charges récupérables à votre charge</td><td class="n">${eur(c.chargesRecuperables)}</td></tr>
      <tr><td>Provisions pour charges appelées sur la période</td><td class="n">- ${eur(c.provisions)}</td></tr>
      <tr class="t"><td>${c.solde >= 0 ? 'Complément de charges dû' : 'Trop-perçu de provisions en votre faveur'}</td><td class="n">${eur(Math.abs(c.solde))}</td></tr></table>
      ${r.teom.avisSaisi ? `<h3>2. Taxe d'enlèvement des ordures ménagères ${annee}</h3>
      <table><tr><td>TEOM figurant sur l'avis de taxe foncière ${annee}</td><td class="n">${eur(r.teom.teomBien)}</td></tr>
      <tr><td>Votre occupation en ${annee} (${r.teom.jours} jours)</td><td class="n">${(r.teom.prorata * 100).toFixed(1)} %</td></tr>
      <tr class="t"><td>TEOM à votre charge</td><td class="n">${eur(r.teom.montant)}</td></tr></table>` : ''}
      <table>${r.teom.avisSaisi ? `<tr><td>Régularisation des charges</td><td class="n">${eur(c.solde)}</td></tr><tr><td>TEOM</td><td class="n">${eur(r.teom.montant)}</td></tr>` : ''}
      ${r.dejaCharges || r.dejaTeom ? `<tr><td>Déjà réglé</td><td class="n">- ${eur(r.dejaCharges + r.dejaTeom)}</td></tr>` : ''}
      <tr class="t"><td>${r.reste >= 0 ? 'Montant total à régler' : 'Montant total qui vous sera remboursé'}</td><td class="n">${eur(Math.abs(r.reste))}</td></tr></table>
      <p class="small">Conformément à l'article 23 de la loi du 6 juillet 1989, le décompte par nature de charges et les pièces justificatives (décompte du syndic, avis de taxe foncière, factures)
      sont tenus à votre disposition pendant six mois à compter de l'envoi du présent décompte. Les frais de gestion de la fiscalité directe locale ne sont pas récupérables.</p>
      <p>Fait le ${dateFr(today())}</p>`
    );
  };
  actions.enregRegul = (d) => {
    const b = bailById(d.id);
    const r = C.regularisationComplete(db, b, annee);
    const resteCharges = C.round2(r.charges.solde - r.dejaCharges);
    const resteTeom = C.round2(r.teom.montant - r.dejaTeom);
    openForm(
      `Règlement de la régularisation ${annee} — ${b.locataire}`,
      [
        { type: 'html', html: '<p class="small muted">Montants positifs : reçus du locataire. Négatifs : remboursés au locataire (ou déduits d’un loyer). Ils sont suivis à part des loyers.</p>' },
        { name: 'charges', label: 'Régularisation des charges (€)', type: 'number' },
        { name: 'teom', label: 'Remboursement de TEOM (€)', type: 'number' },
        { name: 'date', label: 'Date du règlement', type: 'date', required: true },
        { name: 'mode', label: 'Mode', type: 'select', options: MODES.map((m) => [m, m]) },
      ],
      { charges: resteCharges || '', teom: resteTeom || '', date: today(), mode: 'Virement' },
      (v) => {
        const base = { bailId: b.id, periode: v.date.slice(0, 7), date: v.date, mode: v.mode, regulAnnee: annee };
        if (Number(v.charges)) db.paiements.push({ ...base, id: uid(), nature: 'regularisation', montant: Number(v.charges), note: `Régularisation des charges ${annee}` });
        if (Number(v.teom)) db.paiements.push({ ...base, id: uid(), nature: 'teom', montant: Number(v.teom), note: `TEOM ${annee}` });
        save();
      },
      'Enregistrer'
    );
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
    const prets = db.prets.filter((p) => dans(p.bienId));
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
    const p = d.id ? db.prets.find((x) => x.id === d.id) : { bienId: bienDefaut(), dureeMois: 240 };
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

  // ---------- Contacts ----------
  const ROLES_CONTACT = {
    syndic: 'Syndic de copropriété',
    gestionnaire: 'Gestion locative',
    locataire: 'Locataire',
    banque: 'Banque / prêt',
    notaire: 'Notaire',
    assurance: 'Assurance',
    promoteur: 'Promoteur / SAV',
    artisan: 'Artisan / entreprise',
    administration: 'Administration',
    agence: 'Agence immobilière',
    autre: 'Autre',
  };
  const champsContact = () => [
    { name: 'nom', label: 'Nom', required: true, help: 'Personne ou service (ex. : Mathieu MOULIN, Service syndic)' },
    { name: 'organisme', label: 'Organisme', help: 'Ex. : Pichet ADB, Crédit Mutuel' },
    { name: 'role', label: 'Rôle', type: 'select', options: Object.entries(ROLES_CONTACT) },
    { name: 'fonction', label: 'Fonction', help: 'Ex. : gestionnaire de copropriété' },
    { name: 'email', label: 'E-mail', type: 'email' },
    { name: 'telephone', label: 'Téléphone' },
    { name: 'adresse', label: 'Adresse', type: 'textarea', adresse: 'bloc' },
    { name: 'biens', label: 'Biens concernés', full: true, help: 'Noms des biens, séparés par des virgules (ex. : Terre des Rois B01, Terre des Rois C01)' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ];
  let rechercheContact = '';
  views.contacts = () => {
    const n = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const q = n(rechercheContact);
    const liste = (db.contacts || [])
      .filter((c) => !q || n([c.nom, c.organisme, c.fonction, c.email, c.telephone, c.biens, c.notes, ROLES_CONTACT[c.role]].join(' ')).includes(q))
      .filter((c) => !filtreBien || !c.biens || idsFiltre().some((id) => n(c.biens).includes(n(bienNom(id)))))
      .sort((a, b) => (a.organisme || a.nom).localeCompare(b.organisme || b.nom, 'fr') || a.nom.localeCompare(b.nom, 'fr'));
    const groupes = {};
    for (const c of liste) (groupes[c.role || 'autre'] = groupes[c.role || 'autre'] || []).push(c);
    const tel = (t) => (t ? `<a href="tel:${h(String(t).replace(/[^\d+]/g, ''))}">${h(t)}</a>` : '');
    const sections = Object.keys(ROLES_CONTACT)
      .filter((r) => groupes[r])
      .map(
        (r) => `<h2>${h(ROLES_CONTACT[r])} (${groupes[r].length})</h2>${table(
          ['Contact', 'Coordonnées', 'Biens', ''],
          groupes[r].map(
            (c) => `<tr><td><b>${h(c.nom)}</b>${c.organisme ? `<div>${h(c.organisme)}</div>` : ''}${c.fonction ? `<div class="small muted">${h(c.fonction)}</div>` : ''}</td>
              <td class="small">${c.email ? `<a href="mailto:${h(c.email)}">${h(c.email)}</a><br>` : ''}${tel(c.telephone)}${c.adresse ? `<div class="muted">${h(c.adresse).replace(/\n/g, '<br>')}</div>` : ''}</td>
              <td class="small">${h(c.biens || '—')}${c.notes ? `<div class="muted">${h(c.notes)}</div>` : ''}</td>
              <td><button class="link" data-act="editContact" data-id="${c.id}">Modifier</button><button class="link danger" data-act="delContact" data-id="${c.id}">Supprimer</button></td></tr>`
          )
        )}`
      )
      .join('');
    return `<div class="toolbar"><h1 style="margin:0">Contacts</h1><span class="spacer"></span>${bienFilter()}<button data-act="editContact">+ Contact</button></div>
      <input type="search" id="recherche-contact" placeholder="Rechercher un nom, un organisme, un e-mail…" value="${h(rechercheContact)}" style="margin-bottom:8px">
      ${sections || '<div class="card empty">Aucun contact.</div>'}`;
  };
  el.addEventListener('input', (e) => {
    if (e.target.id !== 'recherche-contact') return;
    rechercheContact = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const champ = document.getElementById('recherche-contact');
    champ.focus();
    champ.setSelectionRange(pos, pos);
  });
  actions.editContact = (d) => {
    const c = d.id ? db.contacts.find((x) => x.id === d.id) : { role: 'syndic' };
    openForm(d.id ? 'Modifier le contact' : 'Nouveau contact', champsContact(), c, (v) => upsert('contacts', v));
  };
  actions.delContact = (d) => {
    if (confirm('Supprimer ce contact ?')) {
      remove('contacts', d.id);
      render();
    }
  };

  // ---------- Fiscalité ----------
  // Une section par propriétaire : nom propre (2044), SCI à l'IR (2072, puis quote-part de chaque associé), SCI à l'IS.
  views.fiscalite = () => {
    if (!db.biens.length) return `<h1>Fiscalité</h1>${needBien()}`;
    const biens = db.biens.filter((b) => dans(b.id));
    const catTot = (bienIds, cats) =>
      db.charges
        .filter((c) => bienIds.includes(c.bienId) && (c.date || '').startsWith(String(annee)) && cats.includes(c.categorie))
        .reduce((s, c) => s + (Number(c.montant) || 0) - (Number(c.partRecuperable) || 0), 0);
    const groupes = [];
    for (const p of db.proprietaires) {
      const bs = biens.filter((b) => b.proprietaireId === p.id);
      if (bs.length) groupes.push({ p, bs });
    }
    const orphelins = biens.filter((b) => !db.proprietaires.some((p) => p.id === b.proprietaireId));
    if (orphelins.length) groupes.push({ p: { nom: 'Propriétaire non renseigné', type: 'perso' }, bs: orphelins });

    const sections = groupes.map(({ p, bs }) => {
      const ids = bs.map((b) => b.id);
      const tot = C.syntheseAnnee(db, annee, ids);
      const perso = !/^sci/.test(p.type);
      const l = [
        ['Loyers bruts encaissés (hors provisions)', tot.revenusBruts, '211'],
        perso ? ['Frais de gestion forfaitaires (20 € / local)', -tot.forfaitGestion, '222'] : null,
        ["Frais d'administration et de gestion (agence…)", -catTot(ids, ['gestion']), '221'],
        ['Primes d’assurance (PNO, loyers impayés)', -catTot(ids, ['assurance_pno']), '223'],
        ["Travaux d'entretien, réparation et amélioration", -catTot(ids, ['travaux', 'amelioration']), '224'],
        ['Charges non récupérables (copropriété, charges payées en direct)', -catTot(ids, ['copro', 'copro_travaux', 'charges_directes']), '229-230'],
        ['Taxe foncière (hors TEOM récupérable)', -catTot(ids, ['taxe_fonciere']), '227'],
        ["Intérêts d'emprunt", -tot.pretInterets, '250'],
        ['Assurance emprunteur', -tot.pretAssurance, '250'],
      ].filter(Boolean);
      const rows = l.map(([lab, v, ligne]) => `<tr><td>${lab}</td>${perso ? `<td class="muted">${ligne}</td>` : ''}<td class="num">${eur(v)}</td></tr>`);
      const foot = `<tr><td>Résultat foncier estimé</td>${perso ? '<td></td>' : ''}<td class="num">${signed(tot.resultatFoncier)}</td></tr>`;
      const ass = C.associes(p.associes);
      const decl = (C.TYPES_PROPRIETAIRE[p.type] || C.TYPES_PROPRIETAIRE.perso).declaration;
      let note = '';
      if (p.type === 'sci_is') {
        note = `<div class="card" style="border-color:var(--warn);margin-top:8px"><b>SCI à l'IS</b> : le résultat imposable se calcule en comptabilité commerciale (amortissement du bien, des frais d'acquisition…). Le tableau ci-dessous n'est qu'une base de travail pour votre expert-comptable.</div>`;
      } else if (p.type === 'sci_ir' || p.type === 'indivision') {
        note = ass.length && ass.every((a) => a.pct !== null)
          ? `<div class="small" style="margin-top:8px"><b>Quote-part de chaque ${p.type === 'indivision' ? 'indivisaire' : 'associé'}</b> (à reporter sur sa 2044) : ${ass.map((a) => `${h(a.nom)} ${pct(a.pct)} → ${signed(C.round2((tot.resultatFoncier * a.pct) / 100))}`).join(' · ')}</div>`
          : `<p class="small muted">Renseignez les parts de chaque associé (onglet Biens, ex. « Sophie GOSSART : 50 ») pour obtenir la quote-part de chacun.</p>`;
      } else {
        note = `<div class="small muted" style="margin-top:8px">Micro-foncier (si recettes foncières totales du foyer ≤ 15 000 €) : base imposable ${eur(tot.revenusBruts * 0.7)} après abattement de 30 %.</div>`;
      }
      return `<div class="card" style="margin-top:12px"><h2 style="margin-top:0">${h(p.nom)}</h2>
        <p class="small muted">${h(typeProprio(p) || '')} — déclaration ${h(decl)} — ${bs.map((b) => h(b.nom)).join(', ')}</p>
        ${table(perso ? ['Poste', 'Ligne 2044', { label: 'Montant', cls: 'num' }] : ['Poste', { label: 'Montant', cls: 'num' }], rows, foot)}
        ${note}
        ${tot.resultatFoncier < 0 && p.type !== 'sci_is' ? '<p class="small muted">Déficit foncier : imputable sur le revenu global dans la limite de 10 700 € par an (hors intérêts d’emprunt), le surplus est reportable 10 ans sur les revenus fonciers.</p>' : ''}</div>`;
    });
    return `<div class="toolbar"><h1 style="margin:0">Revenus fonciers ${annee}</h1><span class="spacer"></span>${bienFilter()}</div>
      <p class="small muted">Estimation indicative (location nue, régime réel), par propriétaire. Les provisions pour charges et les charges récupérables s'équilibrent et sont exclues.
        Vérifiez avec les règles fiscales en vigueur ou votre conseiller. En location meublée (LMNP), le régime est différent (BIC, amortissements).</p>
      ${sections.join('')}`;
  };

  // ---------- Import Gmail ----------
  const cfgGmail = () => (db.gmail = { clientId: '', regles: [], ignores: [], ...(db.gmail || {}) });
  let gmailDocs = [];
  let gmailJournal = [];
  let gmailEnCours = false;
  // Une même pièce peut donner plusieurs lignes (relevé d'agence couvrant plusieurs biens) : source « …#bienId ».
  const baseSource = (s) => String(s || '').split(':').slice(0, 3).join(':').split('#')[0];
  function sourcesConnues() {
    const s = new Set(cfgGmail().ignores);
    for (const x of [...db.charges, ...db.paiements]) if (x.source) s.add(baseSource(x.source));
    return s;
  }
  const sansAcc = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  /** Indices permettant de reconnaître un bien dans un PDF : rue, résidence, lot, nom du locataire. */
  function reperesBien(b) {
    const motifs = [sansAcc(b.adresse).split(',')[0], b.copropriete, b.nom];
    if (b.lot) motifs.push(`lot ${String(b.lot).split(/[ ,+]/)[0]}`);
    for (const bail of db.baux.filter((x) => x.bienId === b.id)) {
      const noms = sansAcc(bail.locataire).split(/\s+/).filter((m) => m.length >= 4);
      if (noms.length) motifs.push(noms[noms.length - 1]);
    }
    return { id: b.id, motifs: motifs.filter((m) => m && sansAcc(m).length >= 5) };
  }
  function devinerBien(texte, defaut, candidats) {
    const t = sansAcc(texte);
    const trouve = (candidats || db.biens).find((b) => reperesBien(b).motifs.some((m) => t.includes(sansAcc(m))));
    return (trouve || bienById(defaut) || (candidats || db.biens)[0] || {}).id || '';
  }
  function lignesProposees(doc, regle) {
    const e = doc.extraction || {};
    if (e.type === 'gerance') {
      const candidats = db.biens.filter((b) => b.gestionMode === 'agence' && (!regle.gestionnaireId || b.gestionnaireId === regle.gestionnaireId));
      const ligne = (x, bienId) => ({
        type: 'gerance',
        bienId,
        periode: x.periode || doc.dateMail.slice(0, 7),
        date: x.date || '',
        encaisse: x.encaisse ?? ((x.loyer || 0) + (x.provisions || 0) || null),
        honoraires: x.honoraires,
        assurance: x.assurance,
        net: x.net,
      });
      const multi = doc.texte ? Extract.extraireGeranceMulti(doc.texte, (candidats.length ? candidats : db.biens).map(reperesBien)) : [];
      if (multi.length) return multi.map((x) => ligne(x, x.bienId));
      return [ligne(e, devinerBien(doc.texte, regle.bienId, candidats.length ? candidats : null))];
    }
    const copros = db.biens.filter((b) => b.enCopropriete);
    const bienId = devinerBien(doc.texte, regle.bienId, copros.length ? copros : null);
    const pctR = regle.pctRecup === '' || regle.pctRecup === undefined ? 0 : Number(regle.pctRecup);
    const montant = e.total !== null && e.total !== undefined ? Math.round((e.total - (e.fondsTravaux || 0)) * 100) / 100 : null;
    const tri = e.trimestre;
    const an = (tri && tri.annee) || Number((e.date || doc.dateMail).slice(0, 4));
    return [
      {
        type: 'appel',
        bienId,
        date: e.date || doc.dateMail,
        libelle: tri ? `Appel de fonds T${tri.n} ${an}` : e.travaux ? `Appel de fonds travaux ${an}` : `Appel de fonds — ${doc.sujet || doc.fichier}`,
        categorie: e.travaux ? 'copro_travaux' : 'copro',
        montant,
        partRecuperable: montant !== null && !e.travaux ? Math.round(montant * pctR) / 100 : 0,
        fondsTravaux: e.fondsTravaux,
      },
    ];
  }

  const champsRegle = () => [
    { name: 'nom', label: 'Nom', required: true, help: 'Ex. : Syndic Foncia, Agence Citya' },
    { name: 'type', label: 'Type de documents', type: 'select', options: [['appel', 'Appels de fonds du syndic'], ['gerance', 'Relevés de gérance (agence)'], ['auto', 'Détection automatique']] },
    { name: 'requete', label: 'Recherche Gmail', full: true, required: true, help: 'Syntaxe Gmail, ex. : from:(@foncia.fr) ou subject:("appel de fonds") — les PDF joints sont ajoutés automatiquement' },
    { name: 'gestionnaireId', label: 'Gestionnaire', type: 'select', options: db.gestionnaires.map((g) => [g.id, g.nom]), placeholder: '—', showIf: ['type', 'gerance'], help: 'Les biens qu’il gère sont repérés dans ses relevés, même regroupés dans un seul PDF' },
    { name: 'bienId', label: 'Bien par défaut', type: 'select', options: bienOptions(), help: "Remplacé si l'adresse, le lot ou le locataire d'un autre bien figure dans le PDF" },
    { name: 'pctRecup', label: 'Part récupérable des appels (%)', type: 'number', step: '1', min: 0, help: 'Estimation, à ajuster après le décompte annuel du syndic', showIf: ['type', 'appel'] },
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
        <td><code>${h(r.requete)}</code></td><td>${r.type === 'gerance' && r.gestionnaireId ? h((db.gestionnaires.find((g) => g.id === r.gestionnaireId) || {}).nom || '') + ' (ses biens)' : h(bienNom(r.bienId))}</td><td class="num">${r.type === 'gerance' ? '—' : pct(r.pctRecup || 0)}</td>
        <td><button class="link" data-act="editRegle" data-id="${r.id}">Modifier</button><button class="link danger" data-act="delRegle" data-id="${r.id}">Supprimer</button></td></tr>`
    );
    const suggestions = db.gestionnaires
      .filter((x) => x.email && !g.regles.some((r) => r.gestionnaireId === x.id))
      .map((x) => `<button class="secondary" data-act="regleGest" data-id="${x.id}">+ Règle pour ${h(x.nom)}</button>`)
      .join(' ');
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
        ${g.regles.length ? table(['Nom', 'Type', 'Recherche', 'Bien', { label: 'Récup.', cls: 'num' }, ''], regles) : '<p class="muted">Ajoutez une règle par expéditeur : une par syndic, une pour votre gestionnaire.</p>'}
        ${suggestions ? `<div class="toolbar" style="margin-top:8px">${suggestions}</div>` : ''}</div>
      <div class="card" style="margin-top:12px"><div class="toolbar"><h2 style="margin:0">3. Récupérer les documents</h2><span class="spacer"></span>
        <button data-act="gmailChercher" ${!g.clientId || !g.regles.length || gmailEnCours || horsLigne ? 'disabled' : ''}>${gmailEnCours ? 'Recherche en cours…' : '🔍 Chercher les nouveaux PDF'}</button></div>
        ${gmailJournal.length ? `<div class="small muted" id="gmail-journal">${gmailJournal.map(h).join('<br>')}</div>` : ''}
        ${vueDocsGmail()}</div>`;
  };

  function vueDocsGmail() {
    if (!gmailDocs.length) return '';
    const opt = (id, biens) => biens.map((b) => `<option value="${b.id}" ${b.id === id ? 'selected' : ''}>${h(b.nom)}</option>`).join('');
    const inp = (i, j, k, v, type = 'number') =>
      `<input data-gd="${i}" data-l="${j}" data-k="${k}" type="${type}" ${type === 'number' ? 'step="0.01"' : ''} value="${h(v ?? '')}" style="min-width:${type === 'text' ? 180 : 90}px">`;
    const conf = { bonne: 'st-ok', partielle: 'st-part', faible: 'st-due' };
    const rows = gmailDocs.flatMap((d, i) => {
      const n = d.lignes.length;
      const ent = `<td rowspan="${n}"><select data-gd="${i}" data-k="action"><option value="importer" ${d.action === 'importer' ? 'selected' : ''}>Importer</option><option value="plus-tard" ${d.action === 'plus-tard' ? 'selected' : ''}>Plus tard</option><option value="ignorer" ${d.action === 'ignorer' ? 'selected' : ''}>Ignorer définitivement</option></select></td>
        <td rowspan="${n}"><b>${h(d.fichier)}</b><div class="small muted">${h(d.sujet)}<br>${dateFr(d.dateMail)} — ${h(d.expediteur)}</div>
        <div class="small">${d.blobUrl ? `<a href="${d.blobUrl}" target="_blank" rel="noopener">Voir le PDF</a> · ` : ''}<a href="${h(d.lienMail)}" target="_blank" rel="noopener">Voir l'e-mail</a></div>
        ${d.erreur ? `<div class="small neg">${h(d.erreur)}</div>` : ''}<span class="badge ${conf[(d.extraction || {}).confiance] || 'st-due'}">lecture ${h((d.extraction || {}).confiance || 'faible')}</span>
        ${d.lignes[0].type === 'gerance' ? `<div><button class="link" data-act="gmailAjoutLigne" data-i="${i}">+ répartir sur un autre bien</button></div>` : ''}</td>`;
      return d.lignes.map((p, j) => {
        const tete = j === 0 ? ent : '';
        if (p.type === 'gerance') {
          return `<tr>${tete}<td><select data-gd="${i}" data-l="${j}" data-k="bienId">${opt(p.bienId, db.biens)}</select></td>
            <td>Relevé de gérance<br>${inp(i, j, 'periode', p.periode, 'month')}</td>
            <td><label class="small muted">Loyer + provisions encaissés${inp(i, j, 'encaisse', p.encaisse)}</label>
            <label class="small muted">Honoraires TTC${inp(i, j, 'honoraires', p.honoraires)}</label>
            <label class="small muted">Garantie loyers impayés${inp(i, j, 'assurance', p.assurance)}</label>
            ${p.net !== null && p.net !== undefined && n === 1 ? `<div class="small muted">Net versé lu : ${eur(p.net)}</div>` : ''}</td></tr>`;
        }
        return `<tr>${tete}<td><select data-gd="${i}" data-l="${j}" data-k="bienId">${opt(p.bienId, db.biens.filter((b) => b.enCopropriete || b.id === p.bienId))}</select></td>
          <td>Appel de fonds<br>${inp(i, j, 'date', p.date, 'date')}<br>${inp(i, j, 'libelle', p.libelle, 'text')}</td>
          <td><label class="small muted">Charges${inp(i, j, 'montant', p.montant)}</label>
          <label class="small muted">dont récupérable${inp(i, j, 'partRecuperable', p.partRecuperable)}</label>
          <label class="small muted">Fonds travaux${inp(i, j, 'fondsTravaux', p.fondsTravaux)}</label></td></tr>`;
      });
    });
    return `<h2>Documents à vérifier (${gmailDocs.length})</h2>
      <p class="small muted">Contrôlez les montants lus dans chaque PDF (ouvrez-le au besoin) avant d'importer. Un relevé d'agence regroupant plusieurs biens est réparti automatiquement, une ligne par bien.</p>
      ${table(['Action', 'Document', 'Bien', 'Type', 'Montants'], rows)}
      <div class="toolbar" style="margin-top:10px"><span class="spacer"></span><button data-act="gmailImporter">Importer la sélection</button></div>`;
  }

  // Les champs du tableau de vérification mettent à jour les propositions en mémoire.
  el.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.gd === undefined) return;
    const d = gmailDocs[Number(t.dataset.gd)];
    if (!d) return;
    if (t.dataset.k === 'action') return (d.action = t.value);
    const ligne = d.lignes[Number(t.dataset.l) || 0];
    ligne[t.dataset.k] = t.type === 'number' ? (t.value === '' ? null : Number(t.value)) : t.value;
  });
  actions.gmailAjoutLigne = (dd) => {
    const d = gmailDocs[Number(dd.i)];
    const pris = new Set(d.lignes.map((l) => l.bienId));
    const libre = db.biens.find((b) => b.gestionMode === 'agence' && !pris.has(b.id)) || db.biens.find((b) => !pris.has(b.id)) || db.biens[0];
    d.lignes.push({ ...d.lignes[0], bienId: libre.id, encaisse: null, honoraires: null, assurance: null, net: null });
    render();
  };

  actions.gmailClient = () => {
    cfgGmail().clientId = document.getElementById('gmail-client').value.trim();
    save();
    render();
  };
  actions.editRegle = (d) => {
    const g = cfgGmail();
    const r = d.id ? g.regles.find((x) => x.id === d.id) : { type: 'appel', bienId: bienDefaut(), pctRecup: 70, gestionnaireId: (db.gestionnaires[0] || {}).id };
    openForm(d.id ? 'Modifier la règle' : 'Nouvelle règle de recherche', champsRegle(), r, (v) => {
      const i = g.regles.findIndex((x) => x.id === v.id);
      if (i >= 0) g.regles[i] = v;
      else g.regles.push({ ...v, id: uid() });
      save();
    });
  };
  actions.regleGest = (d) => {
    const x = db.gestionnaires.find((y) => y.id === d.id);
    const domaine = (x.email.split('@')[1] || x.email).trim();
    cfgGmail().regles.push({ id: uid(), nom: x.nom, type: 'gerance', requete: `from:(@${domaine})`, gestionnaireId: x.id, bienId: (db.biens.find((b) => b.gestionnaireId === x.id) || {}).id || '' });
    save();
    render();
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
          d.lignes = lignesProposees(d, regle);
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
      for (const l of d.lignes) {
        const ops = Extract.operationsDepuis(l.type, d.lignes.length > 1 ? `${d.source}#${l.bienId}` : d.source, l);
        imp.charges.push(...ops.charges);
        imp.paiements.push(...ops.paiements);
      }
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
      <div class="card"><h2 style="margin-top:0">Propriétaires et gestionnaires</h2>
        <p class="small muted">Les SCI (ou le propriétaire en nom propre) apparaissent comme bailleur sur les quittances, avis d'échéance et décomptes. Ils se gèrent dans l'onglet <a href="#biens">Biens</a>,
        avec les gestionnaires : ${db.proprietaires.length} propriétaire(s), ${db.gestionnaires.length} gestionnaire(s).</p></div>
      <div class="card" style="margin-top:12px"><h2 style="margin-top:0">Sauvegarde</h2>
        <p class="small muted">Les données sont stockées dans ce navigateur${cloud.cfg ? ', et synchronisées avec Firebase quand vous êtes connecté' : ' uniquement'} (${n('biens')} biens, ${n('baux')} baux, ${n('paiements')} paiements, ${n('charges')} charges, ${n('prets')} prêts).
        Exportez régulièrement un fichier de sauvegarde ; il permet aussi de transférer les données sur un autre appareil.
        La sauvegarde est chiffrée : il faudra le mot de passe actuel pour la réimporter.</p>
        <div class="toolbar"><button data-act="export">⬇ Exporter (JSON)</button>
        <label class="btn secondary" style="border:1px solid var(--border);background:var(--surface);color:var(--text)">⬆ Importer<input type="file" accept=".json,application/json" data-change="import" hidden></label>
        <button class="secondary" data-act="exportCSV">Exporter paiements & charges (CSV)</button></div></div>
      ${htmlCarteCloud()}
      <div class="card" style="margin-top:12px"><h2 style="margin-top:0">Mot de passe</h2>
        <p class="small muted">Vos données sont chiffrées avec ce mot de passe (AES-256). L'outil se verrouille après ${VERROU_MINUTES} minutes d'inactivité.
        <b>Un mot de passe oublié ne peut pas être récupéré</b> : conservez-le précieusement.</p>
        <button class="secondary" data-act="changerMdp">Changer le mot de passe</button></div>
      <div class="card" style="margin-top:12px"><h2 style="margin-top:0">Coller un lien d'import</h2>
        <p class="small muted">Si un lien d'import ne s'ouvre pas correctement (lien coupé, navigateur d'une application), collez-le ici en entier.</p>
        <textarea id="coller-import" rows="3" placeholder="https://…/location/#import=…"></textarea>
        <div class="toolbar" style="margin-top:8px"><button data-act="collerImport">Importer</button></div></div>
      <div class="card" style="margin-top:12px"><h2 style="margin-top:0">Importer des opérations</h2>
        <p class="small muted">Ajoute des appels de fonds du syndic, des encaissements ou des frais tirés des relevés de gérance (fichier préparé par Claude à partir de vos e-mails, par exemple),
        <b>sans remplacer</b> vos données. Les pièces déjà importées sont ignorées.</p>
        <label class="btn" style="display:inline-block">⬆ Importer des opérations (JSON)<input type="file" accept=".json,application/json" data-change="importOps" hidden></label></div>
      <div class="card" style="margin-top:12px"><h2 style="margin-top:0">Zone sensible</h2>
        <div class="toolbar"><button class="secondary" data-act="demo">Charger des données d'exemple</button>
        <button class="danger" data-act="reset">Tout effacer</button></div></div>`;
  };
  actions.export = async () => {
    const env = await Coffre.chiffrer(cle, db);
    download(`gestion-locative-${today()}.json`, new Blob([JSON.stringify(env)], { type: 'application/json' }));
  };
  // Import d'une sauvegarde : même parcours que le lien d'import (bandeau dans la page, sans fenêtre système).
  function proposerDonnees(d, origine) {
    if (!d || !Array.isArray(d.biens)) {
      bandeauImport = { type: 'erreur', texte: `Import impossible : ${origine} non reconnu (il doit contenir une liste « biens »).` };
    } else if (!db.biens.length) {
      appliquerImport(d);
    } else {
      bandeauImport = {
        type: 'proposition',
        donnees: d,
        texte: `${origine} : ${resumeDonnees(d)}. Ces données remplaceront vos données actuelles (${db.biens.length} bien(s), ${db.paiements.length} encaissement(s)).`,
      };
    }
    render();
    window.scrollTo(0, 0);
  }
  actions.import = (_, input) => {
    const f = input.files[0];
    input.value = '';
    if (!f) return;
    f.text().then((txt) => {
      let d;
      try {
        d = JSON.parse(txt);
      } catch (e) {
        bandeauImport = { type: 'erreur', texte: `Import impossible : « ${f.name} » n'est pas un fichier JSON valide.` };
        render();
        return;
      }
      if (!Coffre.estEnveloppe(d)) return proposerDonnees(d, `Fichier « ${f.name} »`);
      openForm(
        'Sauvegarde chiffrée',
        [{ type: 'html', html: '<p class="small muted" id="msg-sauvegarde"></p>' }, { name: 'mdp', label: 'Mot de passe en vigueur lors de cette sauvegarde', type: 'password', required: true, full: true }],
        {},
        (v) => {
          Coffre.ouvrir(v.mdp, d)
            .then((o) => {
              modal.close();
              proposerDonnees(o.donnees, `Sauvegarde « ${f.name} »`);
            })
            .catch((e) => {
              const m = document.getElementById('msg-sauvegarde');
              if (m) m.textContent = e.message;
            });
          return false;
        },
        'Ouvrir'
      );
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
    db = C.migrer(demoData());
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
    d.proprietaires.push({ id: 'sciA', nom: 'SCI Les Canuts', type: 'sci_ir', gerant: 'Jean Exemple', siren: '901 234 567', adresse: '1 place de la Mairie\n69000 Lyon', associes: 'Jean Exemple : 50\nMarie Exemple : 50' });
    d.proprietaires.push({ id: 'sciB', nom: 'SCI Garibaldi', type: 'sci_ir', gerant: 'Marie Exemple', siren: '902 345 678', adresse: '1 place de la Mairie\n69000 Lyon', associes: 'Jean Exemple : 60\nMarie Exemple : 40' });
    d.gestionnaires.push({ id: 'agence1', nom: 'Agence Immo Gestion', contact: 'Mme Durand', email: 'gestion@agence-exemple.fr', honorairesPct: 7.2 });
    const agence = { gestionMode: 'agence', gestionnaireId: 'agence1' };
    d.biens.push({ id: 'bien1', nom: 'T2 Croix-Rousse', type: 'appartement', proprietaireId: 'sciA', ...agence, enCopropriete: true, adresse: '12 rue d’Austerlitz, 69004 Lyon', lot: '14 + cave 32', surface: 42, copropriete: 'Résidence Les Canuts', syndic: 'Cabinet Syndic & Co', tantiemes: 186, tantiemesTotal: 10000, prixAchat: 185000, fraisAcquisition: 14500, dateAchat: `${y - 3}-03-15` });
    d.biens.push({ id: 'bien2', nom: 'Studio Part-Dieu', type: 'studio', proprietaireId: 'sciA', ...agence, enCopropriete: true, adresse: '45 rue Garibaldi, 69003 Lyon', lot: '7', surface: 22, copropriete: 'Le Garibaldi', syndic: 'Foncia', tantiemes: 95, tantiemesTotal: 5000, prixAchat: 112000, fraisAcquisition: 9200, dateAchat: `${y - 2}-09-01` });
    d.biens.push({ id: 'bien3', nom: 'T3 Villeurbanne', type: 'appartement', proprietaireId: 'sciB', ...agence, enCopropriete: true, adresse: '8 cours Émile Zola, 69100 Villeurbanne', lot: '22', surface: 61, copropriete: 'Le Zola', syndic: 'Citya', tantiemes: 240, tantiemesTotal: 10000, prixAchat: 198000, fraisAcquisition: 15200, dateAchat: `${y - 4}-06-20` });
    d.biens.push({ id: 'bien4', nom: 'T1 Monplaisir', type: 'appartement', proprietaireId: 'sciB', gestionMode: 'direct', enCopropriete: true, adresse: '3 rue Saint-Maurice, 69008 Lyon', lot: '5', surface: 28, copropriete: 'Les Tilleuls', syndic: 'Syndic bénévole', tantiemes: 120, tantiemesTotal: 4000, prixAchat: 98000, fraisAcquisition: 8100, dateAchat: `${y - 5}-01-10` });
    d.biens.push({ id: 'bien5', nom: 'Maison Écully', type: 'maison', proprietaireId: 'sciB', gestionMode: 'direct', enCopropriete: false, adresse: '17 chemin des Vignes, 69130 Écully', surface: 95, prixAchat: 320000, fraisAcquisition: 24000, dateAchat: `${y - 6}-09-01` });
    d.baux.push({ id: 'bail1', bienId: 'bien1', typeBail: 'vide', locataire: 'Marie Martin', email: 'marie@example.com', dateDebut: `${y - 2}-05-01`, loyerHC: 780, provisionCharges: 90, depotGarantie: 780, jourPaiement: 5, irlTrimestre: `T1 ${y - 1}`, irlValeur: 143.46 });
    d.baux.push({ id: 'bail2', bienId: 'bien2', typeBail: 'meuble', locataire: 'Lucas Bernard', dateDebut: `${y}-02-15`, loyerHC: 560, provisionCharges: 45, depotGarantie: 1120, jourPaiement: 1 });
    d.baux.push({ id: 'bail3', bienId: 'bien3', typeBail: 'vide', locataire: 'Sophie Laurent', dateDebut: `${y - 3}-09-01`, loyerHC: 950, provisionCharges: 120, depotGarantie: 950, jourPaiement: 5 });
    d.baux.push({ id: 'bail4', bienId: 'bien4', typeBail: 'meuble', locataire: 'Hugo Petit', dateDebut: `${y - 1}-09-01`, loyerHC: 520, provisionCharges: 40, depotGarantie: 1040, jourPaiement: 5 });
    d.baux.push({ id: 'bail5', bienId: 'bien5', typeBail: 'vide', locataire: 'Famille Moreau', dateDebut: `${y - 2}-07-01`, loyerHC: 1650, provisionCharges: 30, depotGarantie: 1650, jourPaiement: 3 });
    d.prets.push({ id: 'pret1', bienId: 'bien1', libelle: 'Prêt immobilier', banque: 'Crédit Mutuel', capital: 170000, tauxAnnuel: 1.85, dureeMois: 240, dateDebut: `${y - 3}-05-05`, assuranceMensuelle: 28, fraisDossier: 1200 });
    d.prets.push({ id: 'pret2', bienId: 'bien2', libelle: 'Prêt immobilier', banque: 'BNP', capital: 105000, tauxAnnuel: 3.6, dureeMois: 300, dateDebut: `${y - 2}-10-10`, assuranceMensuelle: 19 });
    d.prets.push({ id: 'pret3', bienId: 'bien5', libelle: 'Prêt SCI Garibaldi', banque: 'Caisse d’Épargne', capital: 280000, tauxAnnuel: 1.4, dureeMois: 240, dateDebut: `${y - 6}-10-05`, assuranceMensuelle: 45 });
    const cur = currentPeriod();
    for (const b of d.baux) {
      const parAgence = ['bien1', 'bien2', 'bien3'].includes(b.bienId);
      for (const e of C.echeancesBail(b, `${y - 1}-01`, cur)) {
        if (e.periode === cur && (b.id === 'bail2' || parAgence)) continue; // relevé du mois pas encore reçu / un impayé
        d.paiements.push({ id: uid(), bailId: b.id, periode: e.periode, montant: e.du, date: `${e.periode}-0${b.jourPaiement || 5}`, mode: parAgence ? 'Agence' : 'Virement', note: parAgence ? 'Relevé de gérance' : '' });
        if (parAgence) d.charges.push({ id: uid(), bienId: b.bienId, categorie: 'gestion', libelle: `Honoraires de gestion ${e.periode}`, date: `${e.periode}-28`, montant: C.round2(e.du * 0.072), partRecuperable: 0 });
      }
    }
    for (const yy of [y - 1, y]) {
      for (const [bienId, m, r] of [['bien1', 420, 290], ['bien2', 210, 150], ['bien3', 560, 400], ['bien4', 180, 120]]) {
        for (let q = 0; q < 4; q++) d.charges.push({ id: uid(), bienId, categorie: 'copro', libelle: `Appel de fonds T${q + 1} ${yy}`, date: `${yy}-${String(q * 3 + 1).padStart(2, '0')}-01`, montant: m, partRecuperable: r });
      }
      for (const [bienId, tf, teom] of [['bien1', 1140, 165], ['bien2', 690, 95], ['bien3', 1320, 190], ['bien4', 610, 85], ['bien5', 2150, 260]]) {
        d.charges.push({ id: uid(), bienId, categorie: 'taxe_fonciere', libelle: `Taxe foncière ${yy}`, date: `${yy}-10-15`, montant: tf, partRecuperable: teom });
      }
      for (const bienId of ['bien1', 'bien2', 'bien3', 'bien4', 'bien5']) d.charges.push({ id: uid(), bienId, categorie: 'assurance_pno', libelle: `Assurance PNO ${yy}`, date: `${yy}-01-10`, montant: bienId === 'bien5' ? 390 : 145, partRecuperable: 0 });
      d.charges.push({ id: uid(), bienId: 'bien5', categorie: 'charges_directes', libelle: `Entretien chaudière ${yy}`, date: `${yy}-09-20`, montant: 180, partRecuperable: 180 });
      d.charges.push({ id: uid(), bienId: 'bien5', categorie: 'charges_directes', libelle: `Entretien jardin / fosse ${yy}`, date: `${yy}-05-12`, montant: 260, partRecuperable: 160 });
    }
    d.charges.push({ id: uid(), bienId: 'bien1', categorie: 'travaux', libelle: 'Remplacement chauffe-eau', date: `${y}-03-22`, montant: 980, partRecuperable: 0 });
    return d;
  }


  // ---------- Synchronisation Firebase (facultative) ----------
  // La configuration (publique par nature) est gardée à part, en clair, pour être retrouvée
  // même après une réinitialisation des données locales.
  const CLOUD_KEY = 'gestion-location-cloud';
  const lireCloudCfg = () => {
    try {
      return JSON.parse(lireLocal(CLOUD_KEY) || 'null');
    } catch (e) {
      return null;
    }
  };
  const cloud = { cfg: lireCloudCfg(), pret: false, utilisateur: null, version: null, arret: null, statut: '', erreur: '', minuteur: null, choix: null };
  const cloudBase = () => (cloud.cfg && cloud.cfg.base) || 'principal';

  function etatCloud() {
    const e = document.getElementById('cloud-etat');
    if (!e) return;
    if (!cloud.cfg) return (e.hidden = true);
    e.hidden = false;
    const s = !cloud.utilisateur ? ['☁️ hors ligne', 'Non connecté à Firebase (Paramètres)'] : !cloud.utilisateur.emailVerified ? ['☁️ ✉', 'Adresse e-mail à vérifier (Paramètres)'] : cloud.erreur ? ['☁️ ⚠', cloud.erreur] : cloud.statut === 'envoi' ? ['☁️ …', 'Enregistrement en cours'] : cloud.version === null ? ['☁️ …', 'Synchronisation'] : ['☁️ ✓', `Synchronisé (version ${cloud.version})`];
    e.textContent = s[0];
    e.title = s[1];
  }

  async function demarrerCloud() {
    if (!cloud.cfg || !window.Cloud) return;
    try {
      await Cloud.init(cloud.cfg.config);
      cloud.pret = true;
      Cloud.surUtilisateur((u) => {
        cloud.utilisateur = u;
        cloud.version = null;
        if (cloud.arret) cloud.arret();
        // Seules les adresses vérifiées ont accès à la base (voir firestore.rules).
        cloud.arret = u && u.emailVerified ? Cloud.ecouter(cloudBase(), recevoirDistant, (err) => ((cloud.erreur = err.message), etatCloud(), render())) : null;
        etatCloud();
        render();
      });
    } catch (e) {
      cloud.erreur = e.message;
    }
    etatCloud();
  }

  function adopterDistant(distant, notifier) {
    db = C.migrer({ ...empty(), ...JSON.parse(distant.json) });
    cloud.version = distant.version;
    save({ local: true });
    setTimeout(appliquerPaiementsAuto);
    if (notifier) {
      const quand = distant.majLe ? distant.majLe.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '';
      bandeauImport = { type: 'ok', texte: `Données mises à jour depuis Firebase${distant.majPar ? ` par ${distant.majPar}` : ''}${quand ? ` le ${quand}` : ''}.` };
    }
  }

  function recevoirDistant(distant) {
    cloud.erreur = '';
    if (!distant) {
      // Base encore vide : on l'initialise avec les données de ce navigateur.
      cloud.version = 0;
      if (db.biens.length) envoyerCloud();
    } else if (distant.json === JSON.stringify(db)) {
      cloud.version = distant.version;
    } else if (cloud.version === null) {
      if (!db.biens.length) adopterDistant(distant, true);
      else cloud.choix = distant; // les deux contiennent des données différentes : l'utilisateur choisit
    } else if (distant.version > cloud.version) {
      adopterDistant(distant, true);
    }
    etatCloud();
    if (cle) render();
  }

  function planifierEnvoi() {
    if (!cloud.utilisateur || !cloud.utilisateur.emailVerified || cloud.version === null) return;
    clearTimeout(cloud.minuteur);
    cloud.minuteur = setTimeout(() => envoyerCloud(), 700);
  }

  async function envoyerCloud(forcer) {
    if (!cloud.utilisateur || !cloud.utilisateur.emailVerified) return;
    cloud.statut = 'envoi';
    etatCloud();
    try {
      cloud.version = await Cloud.ecrire(cloudBase(), db, forcer ? null : cloud.version);
      cloud.erreur = '';
    } catch (e) {
      if (e.conflit) {
        adopterDistant(e.conflit, false);
        bandeauImport = { type: 'erreur', texte: `La base a été modifiée ailleurs${e.conflit.majPar ? ` (par ${e.conflit.majPar})` : ''} pendant votre saisie : elle a été rechargée. Refaites votre dernière modification si elle n'apparaît pas.` };
        render();
      } else {
        cloud.erreur = `Enregistrement Firebase impossible : ${e.message}. Nouvel essai à la prochaine modification.`;
      }
    }
    cloud.statut = '';
    etatCloud();
  }
  window.addEventListener('online', () => planifierEnvoi());

  function htmlChoixCloud() {
    if (!cloud.choix) return '';
    let d = null;
    try {
      d = JSON.parse(cloud.choix.json);
    } catch (e) {
      /* contenu illisible */
    }
    return `<div class="card bandeau st-part" style="margin-bottom:12px"><p style="margin:0 0 8px"><b>La base Firebase et ce navigateur contiennent des données différentes.</b><br>
      Firebase : ${d ? h(resumeDonnees(d)) : '?'}${cloud.choix.majPar ? ` — modifiée par ${h(cloud.choix.majPar)}` : ''}${cloud.choix.majLe ? ` le ${cloud.choix.majLe.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}` : ''}.<br>
      Ce navigateur : ${h(resumeDonnees(db))}.</p>
      <div class="toolbar" style="margin:0"><button data-act="cloudGarderDistant">Utiliser la base Firebase</button>
      <button class="secondary" data-act="cloudGarderLocal">Envoyer les données de ce navigateur vers Firebase</button></div></div>`;
  }
  actions.cloudGarderDistant = () => {
    const d = cloud.choix;
    cloud.choix = null;
    adopterDistant(d, false);
    render();
  };
  actions.cloudGarderLocal = async () => {
    cloud.choix = null;
    await envoyerCloud(true);
    render();
  };

  function htmlCarteCloud() {
    const c = cloud.cfg;
    const u = cloud.utilisateur;
    const etat = !c
      ? '<p class="small muted">Non configurée : les données restent uniquement dans ce navigateur.</p>'
      : `<p class="small">Projet <b>${h(c.config.projectId)}</b>, base « ${h(cloudBase())} » — ${u ? `connecté en tant que <b>${h(u.email)}</b>${cloud.version !== null ? `, version ${cloud.version}` : ''}` : 'non connecté'}.</p>${cloud.erreur ? `<p class="small neg">${h(cloud.erreur)}</p>` : ''}`;
    const connexion = c && !u
      ? `<div class="form-grid" style="margin-top:8px"><label>E-mail<input id="fb-email" type="email" autocomplete="username"></label>
         <label>Mot de passe Firebase<input id="fb-mdp" type="password" autocomplete="current-password"></label></div>
         <p class="small muted">Première fois ? Saisissez votre e-mail et choisissez un mot de passe (8 caractères au moins), puis « Créer mon compte » : un e-mail de vérification vous sera envoyé. Seules les adresses autorisées dans les règles de sécurité accèdent aux données.</p>
         <p class="small neg" id="fb-msg"></p><div class="toolbar"><button data-act="cloudConnexion">Se connecter</button><button class="secondary" data-act="cloudCreerCompte">Créer mon compte</button><button class="link" data-act="cloudMdpOublie">Mot de passe oublié</button></div>`
      : '';
    const verification = c && u && !u.emailVerified
      ? `<div class="bandeau st-part" style="padding:8px;border-radius:8px"><p class="small" style="margin:0 0 6px">Un e-mail de vérification a été envoyé à <b>${h(u.email)}</b>. Cliquez sur le lien qu’il contient (pensez aux indésirables), puis revenez ici.</p>
         <p class="small neg" id="fb-msg"></p><div class="toolbar" style="margin:0"><button data-act="cloudVerifie">J’ai validé mon adresse</button><button class="secondary" data-act="cloudRenvoyer">Renvoyer l’e-mail</button></div></div>`
      : '';
    const actionsU = u
      ? `<div class="toolbar">${u.emailVerified ? '<button class="secondary" data-act="cloudEnvoyer">Enregistrer maintenant</button>' : ''}<button class="secondary" data-act="cloudDeconnexion">Se déconnecter</button></div>`
      : '';
    return `<div class="card" style="margin-top:12px"><h2 style="margin-top:0">Synchronisation Firebase</h2>
      <p class="small muted">Retrouvez les mêmes données sur tous vos appareils, et laissez Claude les mettre à jour à partir de vos documents.
      Les données sont stockées dans votre base Firestore, accessibles uniquement aux comptes autorisés par vos règles de sécurité.</p>
      ${etat}${verification}${connexion}${actionsU}
      <details ${c ? '' : 'open'}><summary>${c ? 'Modifier la configuration' : 'Configurer'}</summary>
        <p class="small">Projet <b>${h(Cloud.PROJET.projectId)}</b> : collez la <b>clé API</b> (« AIza… ») de l’application Web, ou tout le bloc <code>firebaseConfig</code> (console Firebase → ⚙ Paramètres du projet → Général → Vos applications).</p>
        <textarea id="fb-config" rows="${c ? 6 : 2}" placeholder="AIza…   ou   const firebaseConfig = { apiKey: &quot;…&quot;, … };">${c ? h(JSON.stringify(c.config, null, 2)) : ''}</textarea>
        <label class="small muted" style="display:block;margin-top:6px">Nom de la base<input id="fb-base" value="${h(cloudBase())}" style="max-width:220px"></label>
        <p class="small neg" id="fb-cfg-msg"></p>
        <div class="toolbar"><button data-act="cloudConfigurer">Enregistrer la configuration</button>${c ? '<button class="danger" data-act="cloudOublier">Désactiver</button>' : ''}</div>
      </details></div>`;
  }
  actions.cloudConfigurer = async () => {
    const msg = document.getElementById('fb-cfg-msg');
    try {
      const config = Cloud.lireConfig(document.getElementById('fb-config').value);
      const base = (document.getElementById('fb-base').value || 'principal').trim().replace(/[^\w-]/g, '-');
      cloud.cfg = { config, base };
      localStorage.setItem(CLOUD_KEY, JSON.stringify(cloud.cfg));
      if (cloud.arret) cloud.arret();
      cloud.utilisateur = null;
      cloud.version = null;
      await demarrerCloud();
      render();
    } catch (e) {
      msg.textContent = e.message;
    }
  };
  actions.cloudOublier = async () => {
    if (cloud.arret) cloud.arret();
    if (cloud.pret && Cloud.utilisateur()) await Cloud.deconnexion();
    localStorage.removeItem(CLOUD_KEY);
    Object.assign(cloud, { cfg: null, utilisateur: null, version: null, arret: null, erreur: '', choix: null });
    etatCloud();
    render();
  };
  actions.cloudConnexion = () => actionCompte('Connexion…', () => Cloud.connexion(...champsCompte()));
  const champsCompte = () => [document.getElementById('fb-email').value.trim(), document.getElementById('fb-mdp').value];
  async function actionCompte(texte, fn) {
    const msg = document.getElementById('fb-msg');
    msg.className = 'small';
    msg.textContent = texte;
    try {
      if (!cloud.pret) await demarrerCloud();
      const r = await fn();
      if (r) msg.textContent = r;
    } catch (e) {
      msg.className = 'small neg';
      msg.textContent = e.message;
    }
  }
  actions.cloudCreerCompte = () => actionCompte('Création du compte…', () => Cloud.creerCompte(...champsCompte()));
  actions.cloudMdpOublie = () =>
    actionCompte('Envoi…', async () => {
      const [email] = champsCompte();
      if (!email) throw new Error('indiquez votre adresse e-mail');
      await Cloud.reinitialiser(email);
      return `Si un compte existe pour ${email}, un e-mail pour choisir un nouveau mot de passe vient d’être envoyé.`;
    });
  actions.cloudRenvoyer = () =>
    actionCompte('Envoi…', async () => {
      await Cloud.envoyerVerification();
      return 'E-mail de vérification renvoyé.';
    });
  actions.cloudVerifie = () =>
    actionCompte('Vérification…', async () => {
      if (!(await Cloud.actualiser())) return 'Adresse pas encore vérifiée : cliquez sur le lien de l’e-mail, puis réessayez.';
      const u = Cloud.utilisateur();
      cloud.utilisateur = u;
      cloud.version = null;
      if (cloud.arret) cloud.arret();
      cloud.arret = Cloud.ecouter(cloudBase(), recevoirDistant, (err) => ((cloud.erreur = err.message), etatCloud(), render()));
      etatCloud();
      render();
    });
  actions.cloudDeconnexion = async () => {
    await Cloud.deconnexion();
    render();
  };
  actions.cloudEnvoyer = () => envoyerCloud();

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

  // Import par lien : aucune fenêtre système (bloquées par certains navigateurs intégrés aux applis),
  // tout passe par un bandeau dans la page.
  let bandeauImport = null; // { type: 'ok' | 'proposition' | 'erreur', texte, donnees? }
  const resumeDonnees = (d) => {
    const n = (x) => (Array.isArray(x) ? x.length : 0);
    return `${n(d.biens)} bien(s), ${n(d.baux)} bail(s), ${n(d.paiements)} encaissement(s), ${n(d.charges)} charge(s)`;
  };
  function appliquerImport(d) {
    db = C.migrer({ ...empty(), ...d });
    db.paiements.push(...C.paiementsAutomatiques(db, today()));
    save();
    view = 'dashboard';
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    bandeauImport = { type: 'ok', texte: `Données importées et enregistrées (chiffrées) dans ce navigateur : ${resumeDonnees(d)}.` };
  }
  async function recevoirImport(code) {
    let d;
    try {
      d = await Coffre.decoderLien(code);
      if (!d || !Array.isArray(d.biens)) throw new Error('données non reconnues');
    } catch (e) {
      bandeauImport = { type: 'erreur', texte: `Import impossible : ${e.message}. Le lien a peut-être été coupé : copiez-le en entier dans Paramètres → « Coller un lien d'import ».` };
      return;
    }
    if (!db.biens.length) return appliquerImport(d);
    bandeauImport = {
      type: 'proposition',
      donnees: d,
      texte: `Données reçues par lien : ${resumeDonnees(d)}. Elles remplaceront vos données actuelles (${db.biens.length} bien(s), ${db.paiements.length} encaissement(s)).`,
    };
  }
  async function traiterImportLien() {
    if (!importEnAttente) return;
    const code = importEnAttente;
    importEnAttente = null;
    await recevoirImport(code);
  }
  function htmlBandeau() {
    if (!bandeauImport) return '';
    const cls = { ok: 'st-ok', proposition: 'st-part', erreur: 'st-due' }[bandeauImport.type];
    const boutons =
      bandeauImport.type === 'proposition'
        ? '<button data-act="importLienOui">Remplacer par ces données</button> <button class="secondary" data-act="importLienNon">Ignorer</button>'
        : '<button class="secondary" data-act="importLienNon">Fermer</button>';
    return `<div class="card bandeau ${cls}" style="margin-bottom:12px"><p style="margin:0 0 8px">${h(bandeauImport.texte)}</p><div class="toolbar" style="margin:0">${boutons}</div></div>`;
  }
  actions.importLienOui = () => {
    if (bandeauImport && bandeauImport.donnees) appliquerImport(bandeauImport.donnees);
    render();
  };
  actions.importLienNon = () => {
    bandeauImport = null;
    render();
  };
  actions.collerImport = async () => {
    const t = document.getElementById('coller-import').value.trim();
    const m = t.match(/#?import=([A-Za-z0-9_-]+)/) || t.match(/^([A-Za-z0-9_-]{40,})$/);
    if (!m) {
      bandeauImport = { type: 'erreur', texte: "Ce texte ne contient pas de lien d'import." };
      return render();
    }
    await recevoirImport(m[1]);
    render();
    window.scrollTo(0, 0);
  };

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
            if (anciennes) db = C.migrer({ ...empty(), ...JSON.parse(anciennes) });
          } catch (_) {
            /* données illisibles : on repart de zéro */
          }
          save();
        } else {
          const o = await Coffre.ouvrir(form.mdp.value, JSON.parse(env));
          cle = o.cle;
          db = C.migrer({ ...empty(), ...o.donnees });
        }
        document.body.classList.remove('locked');
        activite();
        appliquerPaiementsAuto();
        await traiterImportLien();
        render();
        demarrerCloud();
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