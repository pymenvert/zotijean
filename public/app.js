// Interface Zotijean — un seul module, sans dépendance ni build.

const $ = (sélecteur, racine = document) => racine.querySelector(sélecteur);
const $$ = (sélecteur, racine = document) => [...racine.querySelectorAll(sélecteur)];

const état = {
  config: null,
  catalogue: null,
  tableau: null,
  diagnostic: null,
};

// ---------------------------------------------------------------- Réseau

async function appeler(méthode, chemin, corps) {
  // L'en-tête X-Zotijean est notre marqueur d'origine locale : un site tiers ne
  // peut pas le poser sans déclencher un contrôle préalable que le serveur ne
  // valide jamais. Voir src/securite.js.
  const réponse = await fetch(chemin, {
    method: méthode,
    headers: {
      'X-Zotijean': 'local',
      ...(corps ? { 'Content-Type': 'application/json' } : {}),
    },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  const données = await réponse.json().catch(() => ({}));
  if (!réponse.ok) throw new Error(données.erreur || `Erreur ${réponse.status}`);
  return données;
}

// ------------------------------------------------------------ Notifications

function noter(message, genre = '') {
  const élément = document.createElement('div');
  élément.className = `notification ${genre}`;
  élément.textContent = message;
  $('#notes').append(élément);
  setTimeout(() => {
    élément.classList.add('sortante');
    setTimeout(() => élément.remove(), 200);
  }, genre === 'erreur' ? 7000 : 3800);
}

// ------------------------------------------------------- Fabriques d'éléments

/** Construit une option radio avec sa ligne d'explication. */
function fabriquerOption({ id, libellé, explication, recommandé, marques = [], choisi, surChoix }) {
  const étiquette = document.createElement('label');
  étiquette.className = `option${choisi ? ' choisi' : ''}`;
  étiquette.innerHTML = `
    <input type="radio" ${choisi ? 'checked' : ''}>
    <span class="puce"></span>
    <span class="option-corps">
      <span class="option-titre">
        ${échapper(libellé)}
        ${recommandé ? '<span class="etiquette-reco">Recommandé</span>' : ''}
        ${marques.join('')}
      </span>
      <span class="option-explication">${échapper(explication)}</span>
    </span>`;
  étiquette.addEventListener('click', (événement) => {
    événement.preventDefault();
    surChoix(id);
  });
  return étiquette;
}

function échapper(texte) {
  const d = document.createElement('div');
  d.textContent = texte ?? '';
  return d.innerHTML;
}

function remplir(conteneur, éléments) {
  conteneur.replaceChildren(...éléments);

  // Les boutons radio d'un même groupe doivent partager un attribut `name`,
  // sinon un lecteur d'écran les annonce tous comme cochés et les flèches du
  // clavier ne circulent pas entre eux. On le pose ici plutôt qu'à chaque appel :
  // le conteneur EST le groupe.
  const groupe = conteneur.id || 'groupe';
  for (const radio of $$('input[type="radio"]', conteneur)) {
    radio.name = groupe;
    const titre = radio.parentElement?.querySelector('.option-titre');
    if (titre) radio.setAttribute('aria-label', titre.textContent.trim());
  }
}

// ----------------------------------------------------------------- Navigation

function activerVue(nom) {
  $$('.onglet').forEach((o) => o.classList.toggle('actif', o.dataset.vue === nom));
  $$('.vue').forEach((v) => v.classList.toggle('active', v.dataset.vue === nom));
  location.hash = nom;
  if (nom === 'diagnostic' && !état.diagnostic) chargerDiagnostic();
}

$$('.onglet').forEach((onglet) =>
  onglet.addEventListener('click', () => activerVue(onglet.dataset.vue)),
);

// ------------------------------------------------------------- Tableau de bord

/** Identifiants des playlists dont le panneau de réglages est ouvert. */
const panneauxOuverts = new Set();

async function rafraîchirTableau({ reconstruirePlaylists = true } = {}) {
  état.tableau = await appeler('GET', '/api/tableau-de-bord');
  rendreHéros();
  rendreTuiles();

  // On ne reconstruit jamais la liste pendant que l'utilisateur y saisit
  // quelque chose : le nœud remplacé emporterait le texte tapé et l'événement
  // « change » ne partirait jamais.
  const saisieEnCours = $('#gestion-playlists')?.contains(document.activeElement);
  if (reconstruirePlaylists && !saisieEnCours) rendrePlaylists();

  rendreHistorique();
}

function rendreHéros() {
  const { phraseHéros, enCours, décision, prochaineÉchéance } = état.tableau;
  const héros = $('#heros');
  héros.dataset.ton = phraseHéros.ton;
  $('#heros-titre').textContent = phraseHéros.texte;

  let détail = phraseHéros.détail || '';
  if (!enCours && prochaineÉchéance && décision.code !== 'aucune_playlist') {
    détail += détail ? ` · Prochaine vérification ${prochaineÉchéance}` : `Prochaine vérification ${prochaineÉchéance}`;
  }
  $('#heros-detail').textContent = détail;

  // Un bouton qui ne peut rien faire ne doit pas rester engageant : tant qu'un
  // point bloquant subsiste, on renvoie vers le diagnostic plutôt que de
  // laisser cliquer sur Synchroniser pour rien.
  const bloqué = phraseHéros.versDiagnostic === true;
  $('#btn-synchro').hidden = !!enCours;
  $('#btn-synchro').disabled = bloqué;
  $('#btn-synchro').title = bloqué
    ? 'Impossible pour l’instant : réglez d’abord le point signalé dans Diagnostic.'
    : 'Vérifier les playlists et télécharger les nouveaux titres maintenant';
  $('#btn-arreter').hidden = !enCours;
  $('#progression').hidden = !enCours;

  if (enCours) {
    const jauge = $('#progression-jauge');
    const barre = jauge.parentElement;
    if (typeof enCours.pourcentage === 'number') {
      barre.classList.remove('indetermine');
      jauge.style.width = `${enCours.pourcentage}%`;
    } else {
      barre.classList.add('indetermine');
    }
    $('#progression-ligne').textContent = enCours.dernièreLigne || 'Préparation…';
  }
}

function rendreTuiles() {
  const { résumé, réglagesRésumé, playlists } = état.tableau;
  const tuiles = [
    { valeur: playlists.length, libellé: playlists.length > 1 ? 'playlists surveillées' : 'playlist surveillée' },
    { valeur: résumé.totalFichiers ?? 0, libellé: 'titres téléchargés' },
    {
      valeur: réglagesRésumé.planificationActive ? `${réglagesRésumé.intervalleHeures} h` : '—',
      libellé: réglagesRésumé.planificationActive ? 'entre deux vérifications' : 'vérification automatique',
    },
    { valeur: `${réglagesRésumé.attente} s`, libellé: 'd’attente entre les titres' },
  ];

  remplir($('#cartes-resume'), tuiles.map(({ valeur, libellé }) => {
    const tuile = document.createElement('div');
    tuile.className = 'tuile';
    tuile.innerHTML = `<div class="tuile-valeur">${échapper(String(valeur))}</div>
                       <div class="tuile-libelle">${échapper(libellé)}</div>`;
    return tuile;
  }));
}

function fabriquerLignePlaylist(playlist, avecActions) {
  const ligne = document.createElement('div');
  ligne.className = 'playlist';

  const infos = playlist.infos;
  const meta = [
    infos?.nbFichiers ? `${infos.nbFichiers} titre${infos.nbFichiers > 1 ? 's' : ''}` : 'jamais synchronisée',
    playlist.url.replace('https://open.spotify.com/', ''),
  ].join(' · ');

  ligne.innerHTML = `
    <div class="playlist-corps">
      <div class="playlist-nom">${échapper(playlist.nom || nomDepuisURL(playlist.url))}</div>
      <div class="playlist-meta" title="${échapper(playlist.url)}">${échapper(meta)}</div>
    </div>`;

  const actions = document.createElement('div');
  actions.className = 'playlist-actions';

  if (avecActions) {
    const bascule = document.createElement('label');
    bascule.className = 'bascule';
    bascule.title = playlist.actif
      ? 'Surveillée — décochez pour l’ignorer sans la supprimer'
      : 'Ignorée — cochez pour la surveiller à nouveau';
    bascule.innerHTML = `<input type="checkbox" ${playlist.actif ? 'checked' : ''}><span class="curseur"></span>`;
    $('input', bascule).addEventListener('change', async (événement) => {
      await appeler('PATCH', '/api/playlists', {
        id: playlist.id,
        modifications: { actif: événement.target.checked },
      });
      rafraîchirTableau();
    });

    const déplier = document.createElement('button');
    déplier.className = 'icone-bouton';
    déplier.title = 'Réglages propres à cette playlist';
    déplier.innerHTML = '<svg class="ic chevron"><use href="#i-chevron"/></svg>';
    // L'état d'ouverture vit hors du DOM : sinon il disparaîtrait à la première
    // reconstruction de la liste.
    if (panneauxOuverts.has(playlist.id)) ligne.classList.add('deplie');
    déplier.addEventListener('click', () => {
      const ouvert = ligne.classList.toggle('deplie');
      if (ouvert) panneauxOuverts.add(playlist.id);
      else panneauxOuverts.delete(playlist.id);
    });

    const supprimer = document.createElement('button');
    supprimer.className = 'icone-bouton';
    supprimer.title = 'Retirer de la surveillance (les fichiers déjà téléchargés sont conservés)';
    supprimer.innerHTML = '<svg class="ic"><use href="#i-poubelle"/></svg>';
    supprimer.addEventListener('click', async () => {
      if (!confirm(`Retirer « ${playlist.nom || nomDepuisURL(playlist.url)} » de la surveillance ?\n\nLes fichiers déjà téléchargés ne sont pas supprimés.`)) return;
      await appeler('DELETE', '/api/playlists', { id: playlist.id });
      noter('Playlist retirée.', 'succes');
      rafraîchirTableau();
    });

    actions.append(bascule, déplier, supprimer);
    ligne.append(fabriquerSurcharges(playlist));
  } else {
    const pastille = document.createElement('span');
    pastille.className = 'tuile-libelle';
    pastille.textContent = playlist.actif ? '' : 'ignorée';
    actions.append(pastille);
  }

  ligne.append(actions);
  return ligne;
}

/**
 * Panneau de réglages propres à une playlist.
 * Chaque champ vide signifie « comme le réglage général » : c'est ce qui permet
 * de ne sortir du lot qu'une seule playlist sans dupliquer toute la config.
 */
function fabriquerSurcharges(playlist) {
  const panneau = document.createElement('div');
  panneau.className = 'playlist-surcharges';
  const r = playlist.remplacements || {};

  const optionsDe = (liste, choisi) =>
    `<option value="">Comme le réglage général</option>` +
    liste.map((o) => `<option value="${o.id}" ${o.id === choisi ? 'selected' : ''}>${échapper(o.libellé)}</option>`).join('');

  panneau.innerHTML = `
    <div class="surcharge-ligne">
      <label>Dossier</label>
      <input type="text" data-champ="dossierMusique" value="${échapper(r.dossierMusique || '')}"
             placeholder="Comme le réglage général" spellcheck="false">
    </div>
    <div class="surcharge-ligne">
      <label>Qualité</label>
      <select data-champ="niveau">${optionsDe(état.catalogue.qualités, r.niveau)}</select>
    </div>
    <div class="surcharge-ligne">
      <label>Format</label>
      <select data-champ="format">${optionsDe(état.catalogue.formats, r.format)}</select>
    </div>
    <div class="surcharge-ligne">
      <label>Rangement</label>
      <select data-champ="schéma">${optionsDe(
        état.catalogue.schémas.filter((s) => s.id !== 'personnalise'), r.schéma,
      )}</select>
    </div>
    <p class="aide">Laissez « comme le réglage général » pour suivre les réglages
    communs. Utile pour sortir une seule playlist du lot — par exemple en FLAC
    pour Rekordbox alors que le reste reste en Ogg.</p>`;

  const enregistrer = async () => {
    const remplacements = {};
    for (const champ of $$('[data-champ]', panneau)) {
      const valeur = champ.value.trim();
      if (valeur) remplacements[champ.dataset.champ] = valeur;
    }
    await appeler('PATCH', '/api/playlists', { id: playlist.id, modifications: { remplacements } });
    état.config = await appeler('GET', '/api/config');
    noter('Réglages de la playlist enregistrés.', 'succes');
    rafraîchirTableau();
  };

  for (const champ of $$('[data-champ]', panneau)) {
    champ.addEventListener('change', enregistrer);
  }

  return panneau;
}

function nomDepuisURL(url) {
  const morceaux = String(url).split('/');
  return `${morceaux.at(-2) || 'playlist'} ${morceaux.at(-1)?.slice(0, 8) || ''}`;
}

function rendrePlaylists() {
  const { playlists } = état.tableau;

  const vide = (texte) => {
    const d = document.createElement('div');
    d.className = 'vide';
    d.textContent = texte;
    return d;
  };

  remplir($('#accueil-playlists'),
    playlists.length
      ? playlists.map((p) => fabriquerLignePlaylist(p, false))
      : [vide('Aucune playlist surveillée. Ajoutez-en une dans l’onglet Playlists.')]);

  remplir($('#gestion-playlists'),
    playlists.length
      ? playlists.map((p) => fabriquerLignePlaylist(p, true))
      : [vide('Collez un lien Spotify ci-dessus pour commencer.')]);
}

async function rendreHistorique() {
  const { exécutions } = await appeler('GET', '/api/historique');

  if (!exécutions.length) {
    const d = document.createElement('div');
    d.className = 'vide';
    d.textContent = 'Aucune synchronisation pour l’instant.';
    remplir($('#historique'), [d]);
    return;
  }

  remplir($('#historique'), exécutions.map((exécution) => {
    const ligne = document.createElement('div');
    ligne.className = 'execution';
    const date = new Date(exécution.date);
    // « Interrompue » tout court n'apprend rien : c'est justement quand une
    // exécution s'arrête que l'utilisateur a besoin de savoir pourquoi, et si
    // ça repartira tout seul.
    const interruption = exécution.interrompu
      ? exécution.raisonInterruption
        ? ` — en pause : ${exécution.raisonInterruption}`
        : ', interrompue'
      : '';

    const résultat = exécution.échec
      ? `Échec — ${exécution.échec}`
      : `${exécution.nbFichiers} nouveau${exécution.nbFichiers > 1 ? 'x' : ''} titre${exécution.nbFichiers > 1 ? 's' : ''}` +
        // « erreur » désigne un TITRE PERDU, pas une ligne signalée par zotify.
        // La ligne affichait « 4 erreurs » pour quatre paroles introuvables sur
        // des morceaux entiers et convertis.
        (exécution.nbErreurs
          ? `, ${exécution.nbErreurs} titre${exécution.nbErreurs > 1 ? 's' : ''} perdu${exécution.nbErreurs > 1 ? 's' : ''}`
          : '') +
        interruption;

    ligne.innerHTML = `
      <span class="execution-date">${date.toLocaleDateString('fr-FR')} ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
      <span class="execution-resultat">${échapper(résultat)}</span>
      <span class="tuile-libelle">${échapper(exécution.déclencheur || '')}</span>`;
    return ligne;
  }));
}

// ------------------------------------------------------------------ Réglages

async function enregistrerConfig(patch) {
  const fusion = structuredClone(état.config);
  for (const [section, valeurs] of Object.entries(patch)) {
    fusion[section] = { ...fusion[section], ...valeurs };
  }
  état.config = await appeler('PUT', '/api/config', fusion);

  // On rafraîchit les chiffres du tableau de bord, PAS la liste des playlists :
  // la reconstruire refermerait le panneau de réglages qu'on est en train
  // d'utiliser, et perdrait la saisie en cours du champ Dossier.
  rafraîchirTableau({ reconstruirePlaylists: false });
  return état.config;
}

function rendreQualité() {
  const { qualités, formats, noteQualité } = état.catalogue;

  $('#bascule-paroles').checked = état.config.qualité.paroles === true;

  remplir($('#choix-qualite'), qualités.map((q) =>
    fabriquerOption({
      ...q,
      choisi: état.config.qualité.niveau === q.id,
      surChoix: async (id) => {
        await enregistrerConfig({ qualité: { niveau: id } });
        rendreQualité();
        noter('Qualité enregistrée.', 'succes');
      },
    })));

  remplir($('#choix-format'), formats.map((f) =>
    fabriquerOption({
      ...f,
      marques: [f.sansPerte
        ? '<span class="etiquette-sansperte">sans perte ajoutée</span>'
        : '<span class="etiquette-perte">perte ajoutée</span>'],
      choisi: état.config.qualité.format === f.id,
      surChoix: async (id) => {
        await enregistrerConfig({ qualité: { format: id } });
        rendreQualité();
        rafraîchirAperçu();
        noter('Format enregistré.', 'succes');
      },
    })));

  $('#note-qualite').textContent = noteQualité;
}

/**
 * Prévient avant un changement de rangement qui ferait tout retélécharger.
 *
 * zotify décide de sauter un morceau en regardant si LE FICHIER QU'IL ÉCRIRAIT
 * existe déjà — au chemin exact. Changer le schéma ou le modèle change ce
 * chemin : plus rien n'est reconnu, et toute la bibliothèque repart. À trente
 * secondes par titre, c'est dix-sept heures pour deux mille morceaux.
 *
 * C'est le piège le plus coûteux de l'application, et le seul que l'utilisateur
 * ne peut pas deviner.
 */
async function confirmerChangementDeRangement(nouveauSchéma) {
  const déjàLà = état.tableau?.résumé?.totalFichiers ?? 0;
  if (déjàLà === 0) return true;
  if (nouveauSchéma === état.config.organisation.schéma) return true;

  const heures = Math.round((déjàLà * (état.config.rythme?.attenteEntreTitres ?? 30)) / 3600);
  return confirm(
    `Changer le rangement va faire retélécharger vos ${déjàLà} titres.\n\n` +
    'Zotijean reconnaît un morceau déjà pris en regardant son emplacement exact. ' +
    'En changeant le classement, plus aucun fichier ne sera reconnu : tout sera ' +
    `repris depuis le début, soit environ ${heures} heure${heures > 1 ? 's' : ''} ` +
    'de téléchargement.\n\n' +
    'Vos fichiers actuels ne seront ni supprimés ni déplacés : ils resteront à ' +
    'leur place, à côté des nouveaux.\n\n' +
    'Continuer quand même ?',
  );
}

function rendreRangement() {
  const { schémas, variables } = état.catalogue;

  $('#champ-dossier').value = état.config.général.dossierMusique;

  remplir($('#choix-schema'), schémas.map((s) =>
    fabriquerOption({
      ...s,
      choisi: état.config.organisation.schéma === s.id,
      surChoix: async (id) => {
        if (!(await confirmerChangementDeRangement(id))) return;
        await enregistrerConfig({ organisation: { schéma: id } });
        rendreRangement();
        rafraîchirAperçu();
      },
    })));

  const personnalisé = état.config.organisation.schéma === 'personnalise';
  $('#bloc-personnalise').hidden = !personnalisé;
  $('#champ-modele').value = état.config.organisation.modèlePersonnalisé;

  remplir($('#jetons-variables'), variables.map((v) => {
    const jeton = document.createElement('button');
    jeton.className = 'jeton';
    jeton.type = 'button';
    jeton.textContent = `{${v.nom}}`;
    jeton.title = v.description;
    jeton.addEventListener('click', () => {
      const champ = $('#champ-modele');
      const position = champ.selectionStart ?? champ.value.length;
      champ.value = champ.value.slice(0, position) + `{${v.nom}}` + champ.value.slice(position);
      champ.focus();
      champ.selectionStart = champ.selectionEnd = position + v.nom.length + 2;
      champ.dispatchEvent(new Event('input'));
    });
    return jeton;
  }));

  rafraîchirAperçu();
}

let minuterieAperçu = null;
$('#champ-modele')?.addEventListener('input', () => {
  clearTimeout(minuterieAperçu);
  minuterieAperçu = setTimeout(async () => {
    const modèle = $('#champ-modele').value;
    const résultat = await appeler('POST', '/api/apercu', {
      organisation: { ...état.config.organisation, schéma: 'personnalise', modèlePersonnalisé: modèle },
      format: état.config.qualité.format,
    });
    afficherAperçu(résultat);
    if (!résultat.problèmes.length) {
      await enregistrerConfig({ organisation: { schéma: 'personnalise', modèlePersonnalisé: modèle } });
    }
  }, 350);
});

async function rafraîchirAperçu() {
  const résultat = await appeler('POST', '/api/apercu', {
    organisation: état.config.organisation,
    format: état.config.qualité.format,
  });
  afficherAperçu(résultat);
}

function afficherAperçu(résultat) {
  const conteneur = $('#apercu-lignes');

  if (résultat.problèmes?.length) {
    remplir(conteneur, résultat.problèmes.map((problème) => {
      const p = document.createElement('p');
      p.className = 'erreur-champ';
      p.textContent = problème;
      return p;
    }));
    return;
  }

  remplir(conteneur, (résultat.lignes || []).map((ligne) => {
    const élément = document.createElement('div');
    élément.className = `apercu-ligne${ligne.principal ? ' principal' : ''}`;
    // On met en valeur le nom de fichier, c'est ce qu'on lit en premier.
    const morceaux = ligne.chemin.split(/[\\/]/);
    const fichier = morceaux.pop();
    const dossiers = morceaux.length ? `${morceaux.join(' / ')} / ` : '';
    élément.innerHTML = `
      <span class="apercu-etiquette">${échapper(ligne.étiquette)}</span>
      <span class="apercu-chemin">${échapper(dossiers)}<b>${échapper(fichier)}</b></span>`;
    return élément;
  }));
}

function rendrePlanification() {
  const {
    intervalles, notePlanification, rythmes, politiquesRetrait,
    noteRetrait, noteRetraitPourquoi, sourcesAprèsConversion,
    noteSourcesAprèsConversion,
  } = état.catalogue;

  remplir($('#choix-sources'), sourcesAprèsConversion.map((s) =>
    fabriquerOption({
      ...s,
      choisi: état.config.retrait.sourcesAprèsConversion === s.id,
      surChoix: async (id) => {
        await enregistrerConfig({ retrait: { sourcesAprèsConversion: id } });
        rendrePlanification();
        noter('Enregistré.', 'succes');
      },
    })));

  $('#note-sources').textContent = noteSourcesAprèsConversion || '';
  $('#note-retrait').textContent = noteRetrait;
  $('#note-retrait-pourquoi').textContent = noteRetraitPourquoi || '';

  $('#bascule-planif').checked = état.config.planification.actif;
  $('#note-planification').textContent = notePlanification;

  remplir($('#choix-intervalle'), intervalles.map((i) =>
    fabriquerOption({
      id: i.id,
      libellé: i.libellé,
      explication: '',
      recommandé: i.recommandé,
      choisi: état.config.planification.intervalleHeures === i.id,
      surChoix: async (id) => {
        await enregistrerConfig({ planification: { intervalleHeures: id } });
        rendrePlanification();
      },
    })));

  remplir($('#choix-rythme'), rythmes.map((r) =>
    fabriquerOption({
      ...r,
      choisi: état.config.rythme.préréglage === r.id,
      surChoix: async (id) => {
        await enregistrerConfig({ rythme: { préréglage: id } });
        rendrePlanification();
        noter('Rythme enregistré.', 'succes');
      },
    })));

  const planif = état.config.planification;
  $('#bascule-heures-calmes').checked = !!planif.heuresCalmes?.actif;
  $('#plage-heures-calmes').hidden = !planif.heuresCalmes?.actif;
  $('#heure-debut').value = planif.heuresCalmes?.début || '23:00';
  $('#heure-fin').value = planif.heuresCalmes?.fin || '08:00';
  $('#bascule-secteur').checked = !!planif.uniquementSurSecteur;
  $('#bascule-wifi').checked = !!planif.uniquementEnWifi;

  // Ce texte affirmait auparavant que l'état était lu par la coquille macOS.
  // C'était faux : rien ne le lisait, et les deux bascules n'avaient aucun
  // effet. Il est désormais lu par le moteur, et la phrase dit ce qui se passe
  // réellement sur chaque système.
  $('#note-conditions').textContent =
    'Une condition non remplie reporte la vérification, elle ne la saute pas : dès ' +
    'qu’elle redevient vraie, le téléchargement part. Sur Mac, Zotijean lit ' +
    'l’alimentation et le type de connexion toutes les minutes ; un partage de ' +
    'connexion depuis un iPhone est reconnu comme réseau facturé. Sur les autres ' +
    'systèmes, ces informations ne sont pas lisibles et les deux conditions sont ' +
    'considérées comme remplies.';

  remplir($('#choix-retrait'), politiquesRetrait.map((p) =>
    fabriquerOption({
      ...p,
      choisi: état.config.retrait.politique === p.id,
      surChoix: async (id) => {
        await enregistrerConfig({ retrait: { politique: id } });
        rendrePlanification();
      },
    })));
}

// ---------------------------------------------------------------- Diagnostic

async function chargerDiagnostic() {
  const bouton = $('#btn-diagnostic');
  bouton.disabled = true;
  try {
    état.diagnostic = await appeler('GET', '/api/diagnostic');
    rendreDiagnostic();
  } finally {
    bouton.disabled = false;
  }
}

function rendreDiagnostic() {
  const rapport = état.diagnostic;
  const icônes = { ok: '#i-ok', avertissement: '#i-alerte', bloquant: '#i-alerte' };

  remplir($('#liste-diagnostic'), rapport.contrôles.map((contrôle) => {
    const élément = document.createElement('div');
    élément.className = 'controle';
    élément.dataset.gravite = contrôle.gravité;
    élément.innerHTML = `
      <svg class="ic"><use href="${icônes[contrôle.gravité]}"/></svg>
      <div>
        <div class="controle-titre">${échapper(contrôle.titre)}</div>
        <div class="controle-message">${échapper(contrôle.message)}</div>
        ${contrôle.chemin ? `<div class="controle-chemin">${échapper(contrôle.chemin)}</div>` : ''}
        ${contrôle.plateforme ? `<div class="controle-chemin">${échapper(contrôle.plateforme)}</div>` : ''}
        ${contrôle.options?.length ? `<div class="controle-chemin">${contrôle.options.length} options détectées</div>` : ''}
      </div>`;
    return élément;
  }));

  // Savoir quelle version on utilise n'a d'intérêt que le jour où quelque chose
  // cloche — c'est précisément la page où on regarde ce jour-là.
  const ligneVersion = $('#version-app');
  ligneVersion.hidden = !rapport.version;
  ligneVersion.textContent = rapport.version ? `Zotijean version ${rapport.version}` : '';

  const bloquants = rapport.contrôles.filter((c) => c.gravité === 'bloquant').length;
  $('#pastille-diagnostic').hidden = bloquants === 0;
}

// ------------------------------------------------------------------ Journal

function ajouterLigneJournal(entrée) {
  const conteneur = $('#journal');
  const ligne = document.createElement('div');
  ligne.className = 'journal-ligne';
  ligne.dataset.niveau = entrée.niveau;
  const heure = new Date(entrée.date).toLocaleTimeString('fr-FR');
  ligne.innerHTML = `<span class="journal-heure">${heure}</span><span class="journal-texte">${échapper(entrée.message)}</span>`;
  conteneur.append(ligne);

  while (conteneur.childElementCount > 500) conteneur.firstElementChild.remove();
  if ($('#suivre-journal').checked) conteneur.scrollTop = conteneur.scrollHeight;
}

async function chargerJournal() {
  const { entrées } = await appeler('GET', '/api/journal');
  $('#journal').replaceChildren();
  entrées.forEach(ajouterLigneJournal);
}

// ------------------------------------------------------ Notifications système

/**
 * Notification du système, pour un outil qui travaille des heures en fond.
 *
 * L'autorisation n'est JAMAIS demandée au chargement : une fenêtre qui surgit
 * avant qu'on ait rien fait se refuse par réflexe, et le navigateur ne
 * redemande plus jamais. On attend la fin d'une vraie synchronisation, moment
 * où l'intérêt est évident.
 */
const notifications = {
  disponible: 'Notification' in window,

  async demanderSiPertinent() {
    if (!this.disponible || Notification.permission !== 'default') return;
    if (localStorage.getItem('zotijean.notifsDemandees')) return;
    localStorage.setItem('zotijean.notifsDemandees', '1');
    try {
      await Notification.requestPermission();
    } catch {
      // Certains navigateurs refusent hors interaction : sans importance.
    }
  },

  montrer(titre, corps) {
    if (!this.disponible || Notification.permission !== 'granted') return;
    if (!document.hidden) return; // inutile si l'utilisateur regarde déjà
    try {
      const notification = new Notification(titre, { body: corps, tag: 'zotijean-synchro' });
      notification.addEventListener('click', () => {
        window.focus();
        notification.close();
      });
    } catch {
      // Une notification refusée ne doit jamais interrompre l'app.
    }
  },
};

// ------------------------------------------------------ Raccourcis clavier

document.addEventListener('keydown', (événement) => {
  // Jamais pendant une saisie : on ne détourne pas les touches de quelqu'un
  // en train d'écrire un modèle de rangement.
  const cible = événement.target;
  if (cible.matches?.('input, textarea, select')) return;
  if (événement.metaKey || événement.ctrlKey || événement.altKey) return;
  if (!$('#onboarding').hidden) return;

  const vues = ['accueil', 'playlists', 'qualite', 'rangement', 'planification', 'diagnostic', 'journal'];

  // Chiffres 1 à 7 : navigation directe entre les onglets.
  const chiffre = Number(événement.key);
  if (chiffre >= 1 && chiffre <= vues.length) {
    activerVue(vues[chiffre - 1]);
    return;
  }

  if (événement.key === 's' && !$('#btn-synchro').hidden) {
    événement.preventDefault();
    $('#btn-synchro').click();
  } else if (événement.key === 'd') {
    activerVue('diagnostic');
    chargerDiagnostic();
  } else if (événement.key === '?') {
    noter(
      'Raccourcis : 1 à 7 pour les onglets · S pour synchroniser · D pour le diagnostic.',
    );
  }
});

// -------------------------------------------------------------- Événements

function écouterÉvénements() {
  const source = new EventSource('/api/evenements');

  source.addEventListener('message', (message) => {
    const événement = JSON.parse(message.data);

    if (événement.type === 'journal') {
      ajouterLigneJournal(événement.entrée);
      return;
    }

    if (événement.type === 'ligne') {
      const ligne = $('#progression-ligne');
      ligne.textContent = événement.texte;
      // Une piste indisponible dans le pays, une clé audio refusée : ça défile
      // au milieu de lignes anodines et personne ne le remarque. La ligne change
      // de couleur pour ce qui est une erreur, et le journal garde la trace.
      ligne.dataset.sousType = événement.sousType || 'info';
      if (typeof événement.pourcentage === 'number') {
        const jauge = $('#progression-jauge');
        jauge.parentElement.classList.remove('indetermine');
        jauge.style.width = `${événement.pourcentage}%`;
      }
      return;
    }

    if (['synchro-début', 'playlist-début', 'playlist-fin'].includes(événement.type)) {
      rafraîchirTableau();
      return;
    }

    if (événement.type === 'connexion-requise') {
      // zotify attend que l'utilisateur autorise l'accès à son compte Spotify.
      // L'adresse doit être CLIQUABLE — un non-développeur ne va pas la
      // recopier depuis un journal — et rester affichée : contrairement aux
      // notifications ordinaires, celle-ci n'a pas le droit de disparaître
      // toute seule au bout de quelques secondes.
      //
      // Construite en DOM, jamais en HTML : l'adresse vient de la sortie d'un
      // sous-processus, elle ne doit pas pouvoir injecter quoi que ce soit.
      if (!/^https?:\/\//.test(événement.url || '')) return;
      if ($('#note-connexion-spotify')) return; // déjà affichée

      const élément = document.createElement('div');
      élément.className = 'notification erreur';
      élément.id = 'note-connexion-spotify';

      const texte = document.createElement('span');
      texte.textContent = 'zotify doit se connecter à votre compte Spotify — ';
      const lien = document.createElement('a');
      lien.href = événement.url;
      lien.target = '_blank';
      lien.rel = 'noopener';
      lien.textContent = 'cliquez ici pour autoriser';
      élément.append(texte, lien, document.createTextNode('. Le téléchargement reprendra tout seul.'));
      $('#notes').append(élément);
      return;
    }

    if (['synchro-fin', 'synchro-echec'].includes(événement.type)) {
      // La fenêtre de connexion est fermée : le bandeau ne doit pas survivre à
      // l'exécution qui l'a affiché — le lien qu'il porte est mort.
      $('#note-connexion-spotify')?.remove();
    }

    if (événement.type === 'achats-progres') {
      const jauge = $('#progression-achats-jauge');
      if (jauge) jauge.style.width = `${événement.pourcentage}%`;
      const ligne = $('#progression-achats-ligne');
      if (ligne) {
        ligne.textContent =
          `${événement.traités}/${événement.total} — ${événement.texte}`;
      }
      return;
    }

    if (événement.type === 'export-progres') {
      // L'export sonde chaque fichier de la bibliothèque : sur une grosse
      // collection, ça prend des minutes. Un compteur qui avance vaut mille
      // fois mieux qu'un message figé.
      const zone = $('#resultat-export-dj');
      if (zone) {
        zone.innerHTML =
          `<p class="aide">Lecture des fichiers — ${événement.examinés} examiné(s)…<br>`
          + `<code>${échapper(événement.fichier || '')}</code></p>`;
      }
      return;
    }

    if (événement.type === 'synchro-fin') {
      rafraîchirTableau();
      // Le moteur calcule la phrase : elle mentionne les morceaux repris plus
      // tard et les interruptions, que le décompte brut passait sous silence.
      // Le repli ne sert que si un vieux moteur ne l'envoie pas.
      const n = événement.bilan.nbFichiers;
      const phrase = événement.bilan.phrase
        || (n > 0
          ? `${n} nouveau${n > 1 ? 'x' : ''} titre${n > 1 ? 's' : ''} téléchargé${n > 1 ? 's' : ''}.`
          : 'Aucune nouveauté.');
      noter(phrase, événement.bilan.interrompu ? 'erreur' : 'succes');

      notifications.montrer('Zotijean', phrase);
      // L'autorisation se demande ici, après une synchronisation réussie :
      // c'est le seul moment où l'intérêt est évident pour l'utilisateur.
      notifications.demanderSiPertinent();
      if (événement.bilan.réglagesNonAppliqués?.length) {
        noter(
          `Votre version de zotify ne gère pas : ${événement.bilan.réglagesNonAppliqués.join(', ')}. ` +
          'Ces réglages ont été ignorés.', 'erreur',
        );
      }
      return;
    }

    if (événement.type === 'synchro-echec') {
      rafraîchirTableau();
      noter(événement.message, 'erreur');
    }
  });

  // Perte du moteur. EventSource retente seul toutes les 3 secondes, donc on
  // n'alarme qu'après une dizaine de secondes d'échec continu — sans quoi un
  // simple redémarrage ferait clignoter un message inquiétant. Mais rester
  // muet serait pire : l'interface afficherait indéfiniment un état figé,
  // en laissant croire que tout va bien.
  let minuteurPerte = null;

  const signalerPerte = () => {
    const héros = $('#heros');
    héros.dataset.ton = 'erreur';
    $('#heros-titre').textContent = 'Connexion au moteur perdue';
    $('#heros-detail').textContent =
      'Zotijean ne répond plus. Relancez-le depuis la barre des menus, ou en ' +
      'double-cliquant son lanceur, puis rechargez cette page.';
    $('#progression').hidden = true;   // ne plus animer un travail qui n'existe plus
    $('#btn-arreter').hidden = true;   // un bouton sans effet ne doit pas s'afficher
  };

  source.addEventListener('open', () => {
    clearTimeout(minuteurPerte);
    minuteurPerte = null;
    rafraîchirTableau().catch(() => {});
  });

  source.addEventListener('error', () => {
    if (!minuteurPerte) minuteurPerte = setTimeout(signalerPerte, 10000);
  });
}

// -------------------------------------------------------------- Interactions

$('#btn-synchro').addEventListener('click', async () => {
  const bouton = $('#btn-synchro');
  bouton.disabled = true;
  try {
    const résultat = await appeler('POST', '/api/synchroniser');
    if (!résultat.lancé) noter(résultat.raison, 'erreur');
  } catch (erreur) {
    noter(erreur.message, 'erreur');
  } finally {
    bouton.disabled = false;
    rafraîchirTableau();
  }
});

$('#btn-arreter').addEventListener('click', async () => {
  await appeler('POST', '/api/arreter');
  noter('Arrêt demandé — le titre en cours se termine.');
});

$('#btn-diagnostic').addEventListener('click', chargerDiagnostic);

$('#btn-rapport').addEventListener('click', async () => {
  const bouton = $('#btn-rapport');
  bouton.disabled = true;
  try {
    const { texte, nom } = await appeler('GET', '/api/rapport');

    // Téléchargement côté navigateur : l'utilisateur choisit où le mettre et
    // peut le transmettre tel quel. Aucun fichier n'est déposé à son insu.
    const lien = document.createElement('a');
    lien.href = URL.createObjectURL(new Blob([texte], { type: 'text/plain;charset=utf-8' }));
    lien.download = nom;
    lien.click();
    URL.revokeObjectURL(lien.href);

    noter('Diagnostic enregistré dans vos téléchargements.', 'succes');
  } catch (erreur) {
    noter(erreur.message, 'erreur');
  } finally {
    bouton.disabled = false;
  }
});

$('#btn-simuler').addEventListener('click', async () => {
  const bouton = $('#btn-simuler');
  bouton.disabled = true;
  try {
    activerVue('accueil');
    rendreSimulation(await appeler('GET', '/api/simulation'));
  } catch (erreur) {
    noter(erreur.message, 'erreur');
  } finally {
    bouton.disabled = false;
  }
});

$('#btn-fermer-simulation').addEventListener('click', () => {
  $('#carte-simulation').hidden = true;
});

$('#btn-export-dj').addEventListener('click', async () => {
  const bouton = $('#btn-export-dj');
  bouton.disabled = true;
  const zone = $('#resultat-export-dj');
  zone.innerHTML = '<p class="aide">Lecture des fichiers en cours…</p>';
  try {
    const résultat = await appeler('POST', '/api/export-dj');
    const lignes = [];
    if (résultat.rekordbox) {
      lignes.push(`<p class="aide"><strong>Rekordbox</strong> — ${résultat.rekordbox.nbTitres} titre(s) dans ${résultat.rekordbox.nbPlaylists} playlist(s).<br>
        Fichier : <code>${échapper(résultat.rekordbox.destination)}</code><br>
        Dans Rekordbox : Préférences → Avancé → Base de données → rekordbox xml → Ajouter une bibliothèque.</p>`);
    }
    if (résultat.serato) {
      lignes.push(`<p class="aide"><strong>Serato</strong> — ${résultat.serato.nbCrates} crate(s) écrite(s) à la racine de ${échapper(résultat.serato.racineDisque)}.<br>
        Relancez Serato pour les voir apparaître.</p>`);
    }
    for (const avertissement of résultat.avertissements || []) {
      lignes.push(`<p class="erreur-champ">${échapper(avertissement)}</p>`);
    }
    zone.innerHTML = lignes.join('') || '<p class="aide">Rien à exporter.</p>';
    noter('Export terminé.', 'succes');
  } catch (erreur) {
    zone.innerHTML = `<p class="erreur-champ">${échapper(erreur.message)}</p>`;
  } finally {
    bouton.disabled = false;
  }
});

$('#bascule-export-auto').addEventListener('change', async (événement) => {
  await enregistrerConfig({ exportsDJ: { automatique: événement.target.checked } });
});

$('#bascule-heures-calmes').addEventListener('change', async (événement) => {
  const actif = événement.target.checked;
  $('#plage-heures-calmes').hidden = !actif;
  await enregistrerConfig({
    planification: {
      ...état.config.planification,
      heuresCalmes: { ...état.config.planification.heuresCalmes, actif },
    },
  });
});

/** « 23:00 », « 23h », « 9 » — on accepte ce que les gens tapent vraiment. */
function normaliserHeure(saisie) {
  const texte = String(saisie).trim().replace(/\s/g, '').replace(/h/i, ':');
  const correspondance = texte.match(/^(\d{1,2})(?::(\d{1,2}))?:?$/);
  if (!correspondance) return null;
  const heures = Number(correspondance[1]);
  const minutes = Number(correspondance[2] || 0);
  if (heures > 23 || minutes > 59) return null;
  return `${String(heures).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

for (const [champ, clé] of [['#heure-debut', 'début'], ['#heure-fin', 'fin']]) {
  $(champ).addEventListener('change', async (événement) => {
    const normalisée = normaliserHeure(événement.target.value);
    if (!normalisée) {
      noter('Heure non comprise. Écrivez par exemple 23:00 ou 8h30.', 'erreur');
      événement.target.value = état.config.planification.heuresCalmes[clé];
      return;
    }
    événement.target.value = normalisée;
    await enregistrerConfig({
      planification: {
        ...état.config.planification,
        heuresCalmes: { ...état.config.planification.heuresCalmes, [clé]: normalisée },
      },
    });
  });
}

$('#bascule-secteur').addEventListener('change', async (événement) => {
  await enregistrerConfig({ planification: { uniquementSurSecteur: événement.target.checked } });
});

$('#bascule-wifi').addEventListener('change', async (événement) => {
  await enregistrerConfig({ planification: { uniquementEnWifi: événement.target.checked } });
});

$('#btn-ouvrir-dossier').addEventListener('click', async () => {
  await appeler('POST', '/api/ouvrir-dossier');
});

$('#form-playlist').addEventListener('submit', async (événement) => {
  événement.preventDefault();
  const erreur = $('#erreur-playlist');
  erreur.hidden = true;
  try {
    await appeler('POST', '/api/playlists', {
      url: $('#champ-url').value,
      nom: $('#champ-nom').value,
    });
    $('#champ-url').value = '';
    $('#champ-nom').value = '';
    noter('Playlist ajoutée.', 'succes');
    rafraîchirTableau();
  } catch (problème) {
    erreur.textContent = problème.message;
    erreur.hidden = false;
  }
});

$('#bascule-paroles').addEventListener('change', async (événement) => {
  await enregistrerConfig({ qualité: { paroles: événement.target.checked } });
  noter(événement.target.checked
    ? 'Les paroles seront enregistrées à côté des morceaux.'
    : 'Aucun fichier de paroles ne sera écrit.', 'succes');
});

$('#bascule-planif').addEventListener('change', async (événement) => {
  await enregistrerConfig({ planification: { actif: événement.target.checked } });
  noter(événement.target.checked
    ? 'Vérification automatique activée.'
    : 'Vérification automatique désactivée.', 'succes');
});

$('#btn-enregistrer-dossier').addEventListener('click', async () => {
  await enregistrerConfig({ général: { dossierMusique: $('#champ-dossier').value.trim() } });
  noter('Dossier enregistré.', 'succes');
  état.diagnostic = null;
  chargerDiagnostic();
});

// ------------------------------------------------------------------ Spotify

async function rendreSpotify() {
  const zone = $('#spotify-contenu');
  const état_ = await appeler('GET', '/api/spotify/etat');
  $('#spotify-etat').textContent = état_.connecté
    ? (état_.profil ? `connecté — ${état_.profil.nom}` : 'connecté')
    : état_.reconnexionNécessaire
      ? 'autorisation révoquée'
      : 'non connecté';

  if (état_.connecté) {
    zone.innerHTML = `
      <p class="aide">Zotijean lit vos playlists pour savoir lesquelles ont changé
      et quels morceaux manquent. Il ne modifie jamais rien chez Spotify.</p>
      <div class="ligne-formulaire">
        <button class="bouton" id="btn-choisir-playlists">Choisir mes playlists</button>
        <button class="bouton" id="btn-voir-manquants">Voir ce qui manque</button>
        <button class="bouton danger" id="btn-deconnecter-spotify">Déconnecter</button>
      </div>
      <div id="spotify-resultat"></div>`;

    $('#btn-choisir-playlists').addEventListener('click', afficherSélecteurPlaylists);
    $('#btn-voir-manquants').addEventListener('click', afficherManquants);
    $('#btn-deconnecter-spotify').addEventListener('click', async () => {
      if (!confirm('Déconnecter votre compte Spotify ?\n\nZotijean continuera de fonctionner, avec moins de précision.')) return;
      await appeler('POST', '/api/spotify/deconnexion');
      noter('Compte déconnecté.', 'succes');
      rendreSpotify();
    });
    return;
  }

  // Autorisation révoquée : ce n'est pas la même chose que « jamais connecté ».
  // L'utilisateur a fait la manipulation ; elle a été annulée depuis son compte
  // Spotify. Sans cette distinction, il relirait les explications de mise en
  // route en se demandant ce qu'il a raté.
  const avertissementRévocation = état_.reconnexionNécessaire
    ? `<p class="erreur-champ">Spotify a révoqué l’autorisation de Zotijean — mot de
       passe changé, ou accès retiré depuis votre compte. Reconnectez-vous ci-dessous.
       Vos téléchargements, eux, ne sont pas concernés : ils passent par zotify.</p>`
    : '';

  // Non connecté : on explique ce que ça apporte ET ce que ça coûte, comme
  // pour toute autre option de l'app.
  zone.innerHTML = avertissementRévocation + `
    <p class="aide">Facultatif. Sans connexion, Zotijean fonctionne : il passe vos
    liens à zotify et regarde ce qui apparaît sur le disque. Avec, il sait en plus
    quelles playlists n’ont pas bougé — et les saute, ce qui fait gagner des
    heures — quels morceaux manquent exactement, et lesquels ont été retirés.</p>
    <p class="aide">En contrepartie, il faut créer une application dans le tableau
    de bord développeur de Spotify, dont les conditions interdisent d’alimenter un
    téléchargeur. Cela expose un second compte en plus de votre compte d’écoute.</p>
    <ol class="aide liste-etapes">
      <li>Ouvrez <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener">developer.spotify.com/dashboard</a> et créez une application.</li>
      <li>Dans <em>Redirect URI</em>, collez exactement : <code class="jeton">${échapper(état_.redirection)}</code></li>
      <li>Cochez <em>Web API</em>, enregistrez, puis copiez l’<em>identifiant client</em> ci-dessous.</li>
    </ol>
    <div class="ligne-formulaire">
      <input type="text" id="champ-client-id" placeholder="Identifiant client (32 caractères)" spellcheck="false" autocomplete="off">
      <button class="bouton primaire" id="btn-connecter-spotify">Connecter</button>
    </div>
    <p class="erreur-champ" id="erreur-spotify" hidden></p>`;

  $('#btn-connecter-spotify').addEventListener('click', async (événement) => {
    const bouton = événement.currentTarget;
    const erreur = $('#erreur-spotify');
    erreur.hidden = true;

    // Deux clics lançaient deux demandes : la seconde écrasait le secret de la
    // première, et l'utilisateur recevait « La réponse de Spotify ne correspond
    // pas à la demande » pour avoir simplement cliqué deux fois.
    bouton.disabled = true;
    try {
      const { url } = await appeler('POST', '/api/spotify/connexion', {
        clientId: $('#champ-client-id').value.trim(),
      });
      window.open(url, '_blank', 'noopener');
      noter('Autorisez Zotijean dans l’onglet qui vient de s’ouvrir, puis revenez ici.');
      guetterConnexion();
    } catch (problème) {
      erreur.textContent = problème.message;
      erreur.hidden = false;
    } finally {
      bouton.disabled = false;
    }
  });
}

/** Un seul guet à la fois : les précédents s'accumulaient sinon. */
let guetConnexion = null;

/**
 * Attend que l'utilisateur ait autorisé l'application dans l'autre onglet.
 *
 * On regarde régulièrement plutôt que de lui demander de cliquer une fois de
 * plus. L'attente est généreuse : une authentification à deux facteurs prend du
 * temps, et abandonner en silence laissait la carte afficher « non connecté »
 * alors que les jetons étaient bien là.
 */
function guetterConnexion() {
  clearInterval(guetConnexion);
  const départ = Date.now();

  const vérifier = async () => {
    try {
      const à_jour = await appeler('GET', '/api/spotify/etat');
      if (à_jour.connecté) {
        clearInterval(guetConnexion);
        guetConnexion = null;
        noter('Compte Spotify connecté.', 'succes');
        rendreSpotify().catch(() => {});
        return;
      }
    } catch {
      // Moteur momentanément injoignable : on réessaiera au prochain tour.
    }

    if (Date.now() - départ > 10 * 60 * 1000) {
      clearInterval(guetConnexion);
      guetConnexion = null;
      noter('Toujours pas de réponse de Spotify. Si vous avez terminé, cliquez sur Connecter à nouveau.');
      rendreSpotify().catch(() => {});
    }
  };

  guetConnexion = setInterval(vérifier, 2000);

  // Beaucoup d'utilisateurs reviennent sur l'onglet une fois l'autorisation
  // donnée : c'est le meilleur moment pour revérifier tout de suite.
  document.addEventListener('visibilitychange', function auRetour() {
    if (document.hidden) return;
    document.removeEventListener('visibilitychange', auRetour);
    if (guetConnexion) vérifier();
  });
}

async function afficherSélecteurPlaylists(événement) {
  const bouton = événement?.currentTarget;
  const zone = $('#spotify-resultat');
  if (bouton) bouton.disabled = true;
  zone.innerHTML = '<p class="aide">Lecture de vos playlists…</p>';

  let playlists;
  try {
    ({ playlists } = await appeler('GET', '/api/spotify/playlists'));
  } catch (erreur) {
    zone.innerHTML = `<p class="erreur-champ">${échapper(erreur.message)}</p>`;
    return;
  } finally {
    if (bouton) bouton.disabled = false;
  }

  // Un cadre vide avec un bouton actif capable de tout effacer serait le pire
  // des états : on explique la cause la plus fréquente.
  if (!playlists.length) {
    zone.innerHTML = `<p class="aide">Aucune playlist trouvée sur ce compte.
      Si votre application Spotify est en mode développement, votre compte doit
      être ajouté à sa liste d’utilisateurs dans le tableau de bord développeur.</p>`;
    return;
  }

  const choisies = new Map(playlists.filter((p) => p.suivie).map((p) => [p.url, p]));

  zone.innerHTML = `
    <p class="aide">Plusieurs playlists possibles — cochez celles à surveiller.</p>
    <div class="choix" id="liste-choix-playlists"></div>
    <div class="ligne-formulaire espacee">
      <button class="bouton primaire" id="btn-valider-playlists">Enregistrer la sélection</button>
      <span class="tuile-libelle" id="compte-choisies"></span>
    </div>`;

  const majCompte = () => {
    $('#compte-choisies').textContent =
      `${choisies.size} playlist(s) sur ${playlists.length}`;
  };

  remplir($('#liste-choix-playlists'), playlists.map((p) => {
    const étiquette = document.createElement('label');
    étiquette.className = `option${choisies.has(p.url) ? ' choisi' : ''}`;
    étiquette.innerHTML = `
      <span class="puce carree"></span>
      <span class="option-corps">
        <span class="option-titre">${échapper(p.nom)}</span>
        <span class="option-explication">${p.nbTitres} titre(s) · ${échapper(p.propriétaire || '')}${p.collaborative ? ' · collaborative' : ''}</span>
      </span>`;
    étiquette.addEventListener('click', (événement) => {
      événement.preventDefault();
      if (choisies.has(p.url)) choisies.delete(p.url);
      else choisies.set(p.url, p);
      étiquette.classList.toggle('choisi');
      majCompte();
    });
    return étiquette;
  }));

  majCompte();

  $('#btn-valider-playlists').addEventListener('click', async () => {
    // On transmet aussi l'univers réellement affiché : le serveur ne retirera
    // que ce qui figurait dans cette liste. Vos albums et liens collés à la
    // main n'y sont pas, donc ils ne peuvent pas être effacés par erreur.
    const { retirées } = await appeler('POST', '/api/spotify/suivre', {
      playlists: [...choisies.values()],
      proposées: playlists.map((p) => p.url),
    });
    noter(
      `${choisies.size} playlist(s) suivie(s)` +
        (retirées ? `, ${retirées} retirée(s).` : '.'),
      'succes',
    );
    zone.innerHTML = '';
    état.config = await appeler('GET', '/api/config');
    rafraîchirTableau();
  });
}

async function afficherManquants(événement) {
  const bouton = événement?.currentTarget;
  const zone = $('#spotify-resultat');

  // Sans cette désactivation, trois clics lancaient trois inventaires complets
  // en parallèle — autant de lectures de toute la bibliothèque et d'appels à
  // Spotify, pour un résultat identique.
  if (bouton) bouton.disabled = true;
  zone.innerHTML = '<p class="aide">Comparaison avec vos fichiers…</p>';

  try {
    const { playlists } = await appeler('GET', '/api/spotify/manquants');
    if (!playlists.length) {
      zone.innerHTML = '<p class="aide">Aucune playlist suivie.</p>';
      return;
    }

    zone.innerHTML = playlists.map((p) => {
      if (!p.disponible) {
        return `<div class="controle" data-gravite="avertissement">
          <div><div class="controle-titre">${échapper(p.nom)}</div>
          <div class="controle-message">${échapper(p.erreur || 'Analyse impossible : ce lien n’est pas une playlist.')}</div></div></div>`;
      }
      const gravité = p.avertissement ? 'avertissement' : p.nbManquants > 0 ? 'avertissement' : 'ok';
      const liste = p.manquants.length
        ? `<div class="controle-chemin">${p.manquants.slice(0, 12).map((m) =>
            échapper(`${m.artiste} — ${m.titre}`)).join('<br>')}${
            p.nbManquants > 12 ? `<br>…et ${p.nbManquants - 12} autre(s)` : ''}</div>`
        : '';
      return `<div class="controle" data-gravite="${gravité}">
        <div><div class="controle-titre">${échapper(p.nom)}</div>
        <div class="controle-message">${
          p.avertissement ? échapper(p.avertissement)
            : `${p.nbPrésents} présent(s), ${p.nbManquants} manquant(s) sur ${p.nbTitres}.`
        }</div>${liste}</div></div>`;
    }).join('');
  } catch (erreur) {
    zone.innerHTML = `<p class="erreur-champ">${échapper(erreur.message)}</p>`;
  } finally {
    if (bouton) bouton.disabled = false;
  }
}

// ---------------------------------------------------------------- Simulation

function rendreSimulation(simu) {
  const conteneur = $('#contenu-simulation');
  const blocs = [];

  const bloc = (titre, éléments) => {
    const d = document.createElement('div');
    d.className = 'simu-bloc';
    const t = document.createElement('div');
    t.className = 'simu-titre';
    t.textContent = titre;
    d.append(t, ...éléments);
    return d;
  };

  const paragraphe = (texte, classe = 'aide') => {
    const p = document.createElement('p');
    p.className = classe;
    p.textContent = texte;
    return p;
  };

  if (simu.bloquants.length) {
    blocs.push(bloc('À régler avant de pouvoir synchroniser',
      simu.bloquants.map((b) => paragraphe(`${b.titre} — ${b.message}`, 'erreur-champ'))));
  }

  blocs.push(bloc('Destination', [
    paragraphe(simu.destination.racine),
    paragraphe(
      simu.destination.espaceLibreLisible
        ? `${simu.destination.espaceLibreLisible} disponibles · ${simu.bibliothèque.nbFichiers} fichier(s) déjà présents (${simu.bibliothèque.lisible})`
        : `${simu.bibliothèque.nbFichiers} fichier(s) déjà présents`,
    ),
  ]));

  if (simu.playlists.length) {
    blocs.push(bloc(
      `Ce qui serait téléchargé — ${simu.playlists.length} playlist(s)`,
      simu.playlists.map((p) => {
        const ligne = document.createElement('div');
        ligne.className = 'simu-playlist';
        const morceaux = p.cheminComplet.split(/[\\/]/);
        const fichier = morceaux.pop();
        ligne.innerHTML = `
          <span class="simu-playlist-nom">${échapper(p.nom)}</span>
          ${p.surchargée ? '<span class="etiquette-surcharge">réglages propres</span>' : ''}
          <span class="simu-chemin">${échapper(morceaux.join('/'))}/<b>${échapper(fichier)}</b></span>
          <span class="tuile-libelle">${échapper(p.format)}${
            p.nomConnu ? ` · ${p.fichiersDéjàPrésents} déjà là` : ' · nom découvert à la 1ʳᵉ synchro'
          }</span>`;
        return ligne;
      }),
    ));
  } else {
    blocs.push(bloc('Playlists', [paragraphe('Aucune playlist active à synchroniser.')]));
  }

  const tableau = document.createElement('table');
  tableau.className = 'simu-reperes';
  tableau.innerHTML = `
    <thead><tr><th>Si…</th><th>Durée</th><th>Espace</th><th>Tient sur le disque</th></tr></thead>
    <tbody>${simu.rythme.repères.map((r) => `
      <tr>
        <td>${r.titres} titres</td>
        <td>${échapper(r.durée)}</td>
        <td>${échapper(r.espace)}</td>
        <td class="${r.tientSurLeDisque === false ? 'simu-non' : 'simu-oui'}">${
          r.tientSurLeDisque === null ? '—' : r.tientSurLeDisque ? 'oui' : 'non'
        }</td>
      </tr>`).join('')}</tbody>`;

  const notes = [tableau];
  if (simu.rythme.noteEspace) notes.push(paragraphe(simu.rythme.noteEspace));

  // Annoncer « dix-sept heures » sans dire ça reviendrait à mentir : Zotijean
  // empêche la veille d'inactivité, mais rien ne peut empêcher un couvercle
  // fermé d'endormir un Mac. Sans cette phrase, l'utilisateur constate que ses
  // dix-sept heures en prennent trois fois plus, sans comprendre pourquoi.
  notes.push(paragraphe(
    'Pendant la synchronisation, Zotijean empêche le Mac de s’endormir tout seul. '
    + 'En revanche, fermer le couvercle l’endort quand même et met le téléchargement '
    + 'en pause jusqu’au réveil — laissez-le ouvert pour que la durée annoncée soit la bonne.',
  ));

  notes.push(paragraphe(simu.incertitude));

  blocs.push(bloc(
    `Repères — ${simu.rythme.attenteSecondes} s d’attente entre chaque titre`,
    notes,
  ));

  remplir(conteneur, blocs);
  $('#carte-simulation').hidden = false;
  $('#carte-simulation').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// -------------------------------------------------------------- Exports DJ

function rendreExportsDJ() {
  const { exportsDJ, noteExportsDJ } = état.catalogue;
  const actuel = état.config.exportsDJ || {};

  remplir($('#choix-exports-dj'), exportsDJ.map((e) => {
    const étiquette = document.createElement('label');
    étiquette.className = `option${actuel[e.id] ? ' choisi' : ''}`;
    étiquette.innerHTML = `
      <input type="checkbox" ${actuel[e.id] ? 'checked' : ''}>
      <span class="puce carree"></span>
      <span class="option-corps">
        <span class="option-titre">${échapper(e.libellé)}</span>
        <span class="option-explication">${échapper(e.explication)}</span>
      </span>`;
    étiquette.addEventListener('click', async (événement) => {
      événement.preventDefault();
      await enregistrerConfig({ exportsDJ: { [e.id]: !actuel[e.id] } });
      rendreExportsDJ();
    });
    return étiquette;
  }));

  $('#bascule-export-auto').checked = !!actuel.automatique;
  $('#note-exports-dj').textContent = noteExportsDJ;
}

// ------------------------------------------------- Racheter en sans-perte

function rendreAchats() {
  const { sourcesAchats, noteAchats } = état.catalogue;
  const actuel = état.config.achats || {};

  remplir($('#choix-sources-achats'), (sourcesAchats || []).map((source) => {
    const coché = actuel[source.id] !== false;
    const étiquette = document.createElement('label');
    étiquette.className = `option${coché ? ' choisi' : ''}`;
    étiquette.innerHTML = `
      <input type="checkbox" ${coché ? 'checked' : ''}>
      <span class="puce carree"></span>
      <span class="option-corps">
        <span class="option-titre">${échapper(source.libellé)}</span>
        <span class="option-explication">${échapper(source.explication)}</span>
      </span>`;
    étiquette.addEventListener('click', async (événement) => {
      événement.preventDefault();
      await enregistrerConfig({ achats: { [source.id]: !coché } });
      rendreAchats();
      rafraîchirEstimationAchats();
    });
    return étiquette;
  }));

  $('#note-achats').textContent = noteAchats || '';
  rafraîchirEstimationAchats();
}

/**
 * La durée est annoncée AVANT de cliquer, jamais après.
 *
 * Une recherche sur deux mille morceaux dure plus d'une heure. Un bouton qui ne
 * dit pas ce qu'il coûte se clique par curiosité, puis se regrette — et pendant
 * ce temps l'app paraît bloquée.
 */
async function rafraîchirEstimationAchats() {
  const zone = $('#estimation-achats');
  if (!zone) return;
  try {
    const estimation = await appeler('GET', '/api/achats/estimation');
    zone.textContent = estimation.phrase;
    $('#btn-achats').disabled = estimation.nbPistes === 0;
  } catch {
    // Une estimation indisponible ne doit pas empêcher de lancer : elle informe.
    zone.textContent = '';
  }
}

$('#btn-achats').addEventListener('click', async () => {
  const bouton = $('#btn-achats');
  const zone = $('#resultat-achats');
  bouton.disabled = true;
  zone.innerHTML = '';
  $('#progression-achats').hidden = false;
  $('#progression-achats-ligne').textContent = 'Préparation…';

  try {
    const r = await appeler('POST', '/api/achats/rapport');
    const vérifiés = r.bilan.lienPiste + r.bilan.lienAlbum;
    zone.innerHTML = `<p class="aide">
      <strong>${vérifiés} morceau(x) sur ${r.bilan.total}</strong> ont un lien d’achat
      vérifié en sans-perte — ${r.bilan.lienPiste} vers le morceau lui-même,
      ${r.bilan.lienAlbum} vers l’album qui le porte.
      ${r.bilan.lienRéférencé} autre(s) ont un lien d’achat référencé ailleurs, et
      ${r.bilan.rechercheSeule} n’ont qu’une recherche à faire à la main.<br>
      Rapport : <code>${échapper(r.chemins.html)}</code></p>`;
    $('#btn-ouvrir-achats').hidden = false;
    noter(r.interrompu
      ? 'Recherche interrompue — ce qui est trouvé est conservé, relancer reprendra la suite.'
      : `${vérifiés} morceau(x) rachetables en sans-perte.`,
    r.interrompu ? 'erreur' : 'succes');
  } catch (erreur) {
    zone.innerHTML = `<p class="aide">${échapper(erreur.message)}</p>`;
  } finally {
    $('#progression-achats').hidden = true;
    bouton.disabled = false;
  }
});

$('#btn-ouvrir-achats').addEventListener('click', async () => {
  try {
    await appeler('POST', '/api/achats/ouvrir');
  } catch (erreur) {
    noter(erreur.message, 'erreur');
  }
});

// ------------------------------------------------------------ Premier lancement

const ÉTAPES_ONBOARDING = [
  {
    titre: 'Bienvenue',
    rendre: () => `
      <p>Zotijean surveille vos playlists Spotify et télécharge tout seul les
      nouveaux morceaux, rangés comme vous le décidez.</p>
      <p>Il ne télécharge rien lui-même : il pilote <strong>votre installation de
      zotify</strong>, celle que vous utilisez déjà. Rien à réinstaller, rien à
      reconnecter.</p>
      <p>Cette configuration prend deux minutes. Vous pourrez tout changer ensuite.</p>`,
  },
  {
    titre: 'Vérification de votre installation',
    avantAffichage: async () => {
      état.diagnostic = await appeler('GET', '/api/diagnostic');
    },
    rendre: () => {
      const icônes = { ok: '#i-ok', avertissement: '#i-alerte', bloquant: '#i-alerte' };
      const contrôles = (état.diagnostic?.contrôles || []).map((c) => `
        <div class="onb-controle" data-gravite="${c.gravité}">
          <svg class="ic"><use href="${icônes[c.gravité]}"/></svg>
          <div class="onb-controle-corps">
            <div>${échapper(c.titre)}</div>
            <p>${échapper(c.message)}</p>
          </div>
        </div>`).join('');
      const prêt = état.diagnostic?.prêt;
      return `
        <p>${prêt
          ? 'Tout est en place. Vous pouvez continuer.'
          : 'Il manque quelque chose. Vous pouvez continuer la configuration, mais la synchronisation ne démarrera pas tant que ce n’est pas réglé.'}</p>
        <div class="onb-liste">${contrôles}</div>`;
    },
  },
  {
    titre: 'Où ranger la musique',
    rendre: () => `
      <p>Choisissez le dossier de destination et la façon de classer les fichiers.
      L’aperçu vous montrera le résultat réel.</p>
      <div class="surcharge-ligne">
        <label for="onb-dossier">Dossier</label>
        <input type="text" id="onb-dossier" value="${échapper(état.config.général.dossierMusique)}">
      </div>
      <div class="surcharge-ligne">
        <label for="onb-schema">Rangement</label>
        <select id="onb-schema">${état.catalogue.schémas
          .filter((s) => s.id !== 'personnalise')
          .map((s) => `<option value="${s.id}" ${s.id === état.config.organisation.schéma ? 'selected' : ''}>${échapper(s.libellé)}</option>`)
          .join('')}</select>
      </div>
      <p class="aide" id="onb-apercu">…</p>
      <p class="aide">Évitez le Bureau, Documents et Téléchargements : macOS y demande
      une autorisation à chaque écriture.</p>`,
    aprèsAffichage: () => {
      const rafraîchir = async () => {
        const schéma = $('#onb-schema').value;
        const résultat = await appeler('POST', '/api/apercu', {
          organisation: { ...état.config.organisation, schéma },
          format: état.config.qualité.format,
        });
        const principale = résultat.lignes?.find((l) => l.principal);
        $('#onb-apercu').textContent = principale
          ? `Exemple : ${$('#onb-dossier').value}/${principale.chemin}`
          : '';
      };
      $('#onb-schema').addEventListener('change', rafraîchir);
      $('#onb-dossier').addEventListener('input', rafraîchir);
      rafraîchir();
    },
    valider: async () => {
      await enregistrerConfig({
        général: { dossierMusique: $('#onb-dossier').value.trim() },
        organisation: { schéma: $('#onb-schema').value },
      });
    },
  },
  {
    titre: 'Ce qu’il faut savoir',
    rendre: () => `
      <div class="onb-avertissement">
        <p><strong>La qualité plafonne à 320 kb/s.</strong> Spotify a lancé son offre
        sans perte en septembre 2025, incluse dans votre abonnement Premium — mais ce
        flux est réservé à ses applications officielles. Convertir ensuite en FLAC
        n’ajoute aucune perte, mais n’en récupère aucune non plus.</p>
      </div>
      <div class="onb-avertissement">
        <p><strong>Télécharger depuis Spotify contrevient à ses conditions.</strong>
        Des suspensions de comptes et des réinitialisations forcées de mot de passe
        sont documentées. Le rythme prudent, réglé par défaut, réduit ce risque sans
        l’annuler.</p>
      </div>
      <p>Comptez environ <strong>17 heures pour 2 000 titres</strong> : Zotijean attend
      une trentaine de secondes entre chaque morceau, volontairement. Les
      synchronisations suivantes ne prennent que quelques minutes.</p>`,
  },
  {
    titre: 'Votre première playlist',
    rendre: () => `
      <p>Dans Spotify : clic droit sur une playlist, <strong>Partager</strong>, puis
      <strong>Copier le lien de la playlist</strong>. Les liens d’album et d’artiste
      fonctionnent aussi.</p>
      <div class="surcharge-ligne">
        <label for="onb-url">Lien</label>
        <input type="text" id="onb-url" placeholder="https://open.spotify.com/playlist/…" spellcheck="false">
      </div>
      <p class="erreur-champ" id="onb-erreur" hidden></p>
      <p class="aide">Vous pourrez en ajouter autant que vous voulez ensuite.</p>`,
    valider: async () => {
      const url = $('#onb-url').value.trim();
      if (!url) return true; // on n'oblige personne
      try {
        await appeler('POST', '/api/playlists', { url });
        return true;
      } catch (erreur) {
        const champ = $('#onb-erreur');
        champ.textContent = erreur.message;
        champ.hidden = false;
        return false;
      }
    },
  },
];

let étapeCourante = 0;

async function afficherÉtape(index) {
  étapeCourante = Math.max(0, Math.min(index, ÉTAPES_ONBOARDING.length - 1));
  const étape = ÉTAPES_ONBOARDING[étapeCourante];

  $('#onb-etape').textContent = `Étape ${étapeCourante + 1} sur ${ÉTAPES_ONBOARDING.length}`;
  $('#onb-titre').textContent = étape.titre;
  $('#onb-jauge').style.width = `${((étapeCourante + 1) / ÉTAPES_ONBOARDING.length) * 100}%`;
  $('#onb-retour').disabled = étapeCourante === 0;
  $('#onb-suivant').querySelector('span')?.remove();
  $('#onb-suivant').textContent =
    étapeCourante === ÉTAPES_ONBOARDING.length - 1 ? 'Terminer' : 'Continuer';

  $('#onb-contenu').innerHTML = '<p class="aide">Un instant…</p>';
  if (étape.avantAffichage) await étape.avantAffichage();
  $('#onb-contenu').innerHTML = étape.rendre();
  étape.aprèsAffichage?.();
}

async function terminerOnboarding() {
  localStorage.setItem('zotijean.premierLancementFait', '1');
  $('#onboarding').hidden = true;
  état.config = await appeler('GET', '/api/config');
  await rafraîchirTableau();
  rendreQualité();
  rendreRangement();
  rendrePlanification();
  rendreExportsDJ();
  rendreAchats();
}

$('#onb-suivant').addEventListener('click', async () => {
  const étape = ÉTAPES_ONBOARDING[étapeCourante];
  const bouton = $('#onb-suivant');
  bouton.disabled = true;
  try {
    if (étape.valider && (await étape.valider()) === false) return;
    if (étapeCourante === ÉTAPES_ONBOARDING.length - 1) {
      await terminerOnboarding();
      noter('Configuration terminée. Cliquez sur Synchroniser quand vous voulez.', 'succes');
    } else {
      await afficherÉtape(étapeCourante + 1);
    }
  } catch (erreur) {
    noter(erreur.message, 'erreur');
  } finally {
    bouton.disabled = false;
  }
});

$('#onb-retour').addEventListener('click', () => afficherÉtape(étapeCourante - 1));
$('#onb-passer').addEventListener('click', terminerOnboarding);

// ------------------------------------------------------------------ Démarrage

async function démarrer() {
  try {
    [état.config, état.catalogue] = await Promise.all([
      appeler('GET', '/api/config'),
      appeler('GET', '/api/catalogue'),
    ]);

    await rafraîchirTableau();
    rendreQualité();
    rendreRangement();
    rendrePlanification();
    rendreExportsDJ();
    rendreAchats();
    rendreSpotify().catch(() => {
      $('#spotify-etat').textContent = 'indisponible';
    });
    await chargerJournal();
    écouterÉvénements();
    chargerDiagnostic();

    // Le premier lancement ne s'affiche qu'une fois, et jamais si des playlists
    // existent déjà : quelqu'un qui a déjà configuré l'app n'a rien à y faire.
    const déjàFait = localStorage.getItem('zotijean.premierLancementFait');
    if (!déjàFait && état.config.playlists.length === 0) {
      $('#onboarding').hidden = false;
      afficherÉtape(0);
    }

    const vue = location.hash.slice(1);
    if (vue && $(`.onglet[data-vue="${vue}"]`)) activerVue(vue);

    // Le tableau de bord se rafraîchit doucement même sans événement, pour que
    // « vérifié il y a 2 h » reste juste sans recharger la page.
    // Un échec ici ne doit rien casser : le flux d'événements signale déjà la
    // perte du moteur, et une promesse rejetée non attrapée figerait la boucle.
    setInterval(() => rafraîchirTableau().catch(() => {}), 60000);
  } catch (erreur) {
    $('#heros-titre').textContent = 'Impossible de contacter le moteur';
    $('#heros-detail').textContent = erreur.message;
    $('#heros').dataset.ton = 'erreur';
  }
}

démarrer();
