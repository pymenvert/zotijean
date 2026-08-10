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
  const réponse = await fetch(chemin, {
    method: méthode,
    headers: corps ? { 'Content-Type': 'application/json' } : undefined,
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

async function rafraîchirTableau() {
  état.tableau = await appeler('GET', '/api/tableau-de-bord');
  rendreHéros();
  rendreTuiles();
  rendrePlaylists();
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

  $('#btn-synchro').hidden = !!enCours;
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

    actions.append(bascule, supprimer);
  } else {
    const pastille = document.createElement('span');
    pastille.className = 'tuile-libelle';
    pastille.textContent = playlist.actif ? '' : 'ignorée';
    actions.append(pastille);
  }

  ligne.append(actions);
  return ligne;
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
    const résultat = exécution.échec
      ? `Échec — ${exécution.échec}`
      : `${exécution.nbFichiers} nouveau${exécution.nbFichiers > 1 ? 'x' : ''} titre${exécution.nbFichiers > 1 ? 's' : ''}` +
        (exécution.nbErreurs ? `, ${exécution.nbErreurs} erreur${exécution.nbErreurs > 1 ? 's' : ''}` : '') +
        (exécution.interrompu ? ', interrompue' : '');

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
  rafraîchirTableau();
  return état.config;
}

function rendreQualité() {
  const { qualités, formats, noteQualité } = état.catalogue;

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

function rendreRangement() {
  const { schémas, variables } = état.catalogue;

  $('#champ-dossier').value = état.config.général.dossierMusique;

  remplir($('#choix-schema'), schémas.map((s) =>
    fabriquerOption({
      ...s,
      choisi: état.config.organisation.schéma === s.id,
      surChoix: async (id) => {
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
  const { intervalles, notePlanification, rythmes, politiquesRetrait } = état.catalogue;

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
      $('#progression-ligne').textContent = événement.texte;
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

    if (événement.type === 'synchro-fin') {
      rafraîchirTableau();
      const n = événement.bilan.nbFichiers;
      noter(n > 0 ? `${n} nouveau${n > 1 ? 'x' : ''} titre${n > 1 ? 's' : ''} téléchargé${n > 1 ? 's' : ''}.` : 'Aucune nouveauté.', 'succes');
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

  source.addEventListener('error', () => {
    // EventSource se reconnecte tout seul ; inutile d'alarmer l'utilisateur.
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
    await chargerJournal();
    écouterÉvénements();
    chargerDiagnostic();

    const vue = location.hash.slice(1);
    if (vue && $(`.onglet[data-vue="${vue}"]`)) activerVue(vue);

    // Le tableau de bord se rafraîchit doucement même sans événement, pour que
    // « vérifié il y a 2 h » reste juste sans recharger la page.
    setInterval(rafraîchirTableau, 60000);
  } catch (erreur) {
    $('#heros-titre').textContent = 'Impossible de contacter le moteur';
    $('#heros-detail').textContent = erreur.message;
    $('#heros').dataset.ton = 'erreur';
  }
}

démarrer();
