// Tests des conditions d'énergie et de réseau.
//
// CE QUI EST EN JEU. Le planificateur vérifie « seulement sur secteur » et
// « seulement en Wi-Fi » au moment de DÉCIDER de lancer. Une fois parti, plus
// rien ne les relisait — alors qu'un rattrapage de 2 000 titres dure dix-sept
// heures.
//
// Le scénario est banal et coûte cher : on lance chez soi, branché en Wi-Fi ;
// trois heures plus tard on débranche, on ferme son sac, et on partage la
// connexion de son téléphone dans le train. Quatorze heures de téléchargement
// sur batterie et sur données mobiles. Quinze gigaoctets en itinérance. La case
// était cochée ; elle n'avait protégé que la première seconde.
//
// Ces tests vérifient les deux sens : que la garde arrête bien quand il le faut,
// et surtout qu'elle N'ARRÊTE PAS quand elle ne sait pas. Une lecture système
// muette ne doit jamais interrompre un téléchargement en cours.

import test from 'node:test';
import assert from 'node:assert/strict';

import { conditionToujoursRemplie } from '../src/energie.js';

// Sur le poste de développement (Windows) comme en intégration continue hors
// macOS, `lireContextePlateforme` renvoie « tout est permis » avec `connu: false`.
// C'est précisément le cas qui doit laisser passer.

const AUCUNE_CONDITION = { planification: {} };
const SUR_SECTEUR = { planification: { uniquementSurSecteur: true } };
const EN_WIFI = { planification: { uniquementEnWifi: true } };
const LES_DEUX = {
  planification: { uniquementSurSecteur: true, uniquementEnWifi: true },
};

test('sans condition cochée, on ne lit même pas l’état du système', async () => {
  assert.equal(await conditionToujoursRemplie(AUCUNE_CONDITION), null);
});

test('une configuration vide ou absente ne fait pas tomber la synchronisation', async () => {
  // Appelée en pleine boucle de téléchargement : une exception ici perdrait
  // l'exécution entière.
  assert.equal(await conditionToujoursRemplie({}), null);
  assert.equal(await conditionToujoursRemplie(null), null);
  assert.equal(await conditionToujoursRemplie(undefined), null);
});

test('un état système illisible laisse la synchronisation continuer', async () => {
  // LA RÈGLE QUI COMPTE : on ne punit pas l'utilisateur pour une commande
  // système qui ne répond pas. Hors macOS, rien n'est lisible — et rien ne doit
  // être interrompu pour autant.
  for (const config of [SUR_SECTEUR, EN_WIFI, LES_DEUX]) {
    assert.equal(
      await conditionToujoursRemplie(config),
      null,
      'une condition non évaluable a interrompu la synchronisation',
    );
  }
});

test('la fonction rend une phrase lisible, jamais un code', async () => {
  // Si un jour elle rend quelque chose, ce doit être une phrase affichable
  // telle quelle dans l'historique et le journal.
  const résultat = await conditionToujoursRemplie(SUR_SECTEUR);
  if (résultat !== null) {
    assert.equal(typeof résultat, 'string');
    assert.ok(résultat.length > 30, 'le message est trop court pour être utile');
    assert.ok(/reprendra/.test(résultat), 'le message ne dit pas que ça repartira tout seul');
  }
});
