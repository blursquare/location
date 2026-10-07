/*
 * Recherches dans les référentiels publics (sans clé d'API) :
 *  - adresses : Base Adresse Nationale (Géoplateforme IGN) ;
 *  - entreprises : API Recherche d'entreprises (annuaire-entreprises.data.gouv.fr), par SIREN ou par nom.
 * Seul le texte recherché est envoyé à ces services publics.
 */
(function (root) {
  'use strict';
  const URL_ADRESSE = 'https://data.geopf.fr/geocodage/search';
  const URL_ENTREPRISE = 'https://recherche-entreprises.api.gouv.fr/search';

  const capitaliser = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/(^|[\s'’-])(\p{L})/gu, (m, sep, c) => sep + c.toUpperCase())
      .replace(/\b(De|Du|Des|La|Le|Les|D'|L'|Et|Sur|Sous|En|Aux?)\b/g, (m) => m.toLowerCase())
      .replace(/^(\p{L})/u, (c) => c.toUpperCase());

  const TYPES_VOIE = {
    RUE: 'rue', AV: 'avenue', AVE: 'avenue', BD: 'boulevard', PL: 'place', CHE: 'chemin', CH: 'chemin', IMP: 'impasse', ALL: 'allée', QU: 'quai', QUAI: 'quai',
    CRS: 'cours', RTE: 'route', SQ: 'square', PAS: 'passage', MTE: 'montée', ESP: 'esplanade', SEN: 'sentier', VOIE: 'voie', RES: 'résidence', LOT: 'lotissement', HAM: 'hameau', CHS: 'chaussée', FG: 'faubourg', PRV: 'parvis',
  };

  /** Adresse du siège en deux lignes (« 3 rue Justin Godart » / « 69004 Lyon »). */
  function adresseSiege(s) {
    if (!s) return { ligne1: '', ligne2: '', complement: '' };
    const voie = [s.numero_voie, s.indice_repetition, TYPES_VOIE[String(s.type_voie || '').toUpperCase()] || (s.type_voie || '').toLowerCase(), capitaliser(s.libelle_voie)]
      .filter(Boolean)
      .join(' ');
    return {
      ligne1: voie || capitaliser(s.adresse || ''),
      ligne2: [s.code_postal, capitaliser(s.libelle_commune)].filter(Boolean).join(' '),
      complement: capitaliser(s.complement_adresse || ''),
    };
  }

  /** Société → champs d'un propriétaire / gestionnaire. */
  function normaliserEntreprise(r) {
    const a = adresseSiege(r.siege);
    const nj = String(r.nature_juridique || '');
    const dirigeants = (r.dirigeants || []).map((d) =>
      d.type_dirigeant === 'personne morale' || d.denomination
        ? { nom: d.denomination || d.nom || '', qualite: d.qualite || '' }
        : { nom: [capitaliser(String(d.prenoms || '').split(' ')[0]), String(d.nom || '').toUpperCase()].filter(Boolean).join(' '), qualite: d.qualite || '' }
    );
    const gerant = dirigeants.find((d) => /g[ée]rant/i.test(d.qualite)) || dirigeants.find((d) => /pr[ée]sident/i.test(d.qualite)) || dirigeants[0];
    return {
      siren: r.siren,
      nom: r.nom_raison_sociale || r.nom_complet || '',
      adresse: [a.complement, a.ligne1, a.ligne2].filter(Boolean).join('\n'),
      adresseLigne: [a.ligne1, a.ligne2].filter(Boolean).join(', '),
      gerant: gerant ? gerant.nom : '',
      gerantCertain: !!gerant && /g[ée]rant|pr[ée]sident/i.test(gerant.qualite),
      dirigeants,
      estSCI: /^654/.test(nj),
      natureJuridique: nj,
      dateCreation: r.date_creation || '',
      active: r.etat_administratif !== 'C',
      activite: r.activite_principale || '',
    };
  }

  const sirenValide = (s) => /^\d{9}$/.test(String(s || '').replace(/\s/g, ''));

  async function getJSON(url) {
    let r;
    try {
      r = await fetch(url, { headers: { Accept: 'application/json' } });
    } catch (e) {
      throw new Error('service public injoignable (connexion internet ?)');
    }
    if (r.status === 429) throw new Error('trop de recherches, réessayez dans quelques secondes');
    if (!r.ok) throw new Error(`service indisponible (${r.status})`);
    return r.json();
  }

  /** Suggestion d'adresse ; garde le numéro saisi quand seule la voie est connue de la base. */
  function suggestionAdresse(p, saisie) {
    const ligne2 = `${p.postcode || ''} ${p.city || ''}`.trim();
    let ligne1 = p.name || '';
    const num = String(saisie || '').match(/^\s*(\d+\s*(?:bis|ter|quater|[a-d])?)\s+/i);
    if (p.type === 'street' && num && !/^\d/.test(ligne1)) ligne1 = `${num[1].trim()} ${ligne1}`;
    return { label: `${ligne1} ${ligne2}`.trim(), ligne1, ligne2, type: p.type };
  }

  async function rechercherAdresses(q, limite = 6) {
    const texte = String(q || '').trim();
    if (texte.length < 4) return [];
    const url = `${URL_ADRESSE}?autocomplete=1&limit=${limite}&q=${encodeURIComponent(texte)}`;
    const d = await getJSON(url);
    return (d.features || []).map((f) => suggestionAdresse(f.properties || {}, texte));
  }

  /** Recherche par SIREN (9 chiffres, SIRET accepté) ou par nom. */
  async function rechercherEntreprises(q, limite = 8) {
    let texte = String(q || '').trim();
    const chiffres = texte.replace(/\s/g, '');
    if (/^\d{14}$/.test(chiffres)) texte = chiffres.slice(0, 9);
    else if (/^\d{9}$/.test(chiffres)) texte = chiffres;
    if (texte.length < 3) return [];
    const d = await getJSON(`${URL_ENTREPRISE}?per_page=${limite}&q=${encodeURIComponent(texte)}`);
    return (d.results || []).map(normaliserEntreprise);
  }

  const api = { suggestionAdresse, capitaliser, adresseSiege, normaliserEntreprise, sirenValide, rechercherAdresses, rechercherEntreprises };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Annuaire = api;
})(typeof window !== 'undefined' ? window : globalThis);
