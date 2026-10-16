# Le prime d’un joueur NBA

Tableau de bord interactif sur la progression, le prime et le déclin des joueurs NBA, calculé sur les saisons 1974 à 2026
(plus de 4 000 joueurs, environ 22 000 saisons). Il estime l’âge du pic, la fenêtre de prime et le déclin pour quinze indicateurs
(BPM, VORP, Win Shares, PER, composantes offensives et défensives, etc.), avec des filtres par poste, époque et minutes jouées,
des comparaisons, une exploration de trajectoires individuelles et un onglet de méthode.

**Page publiée :** `https://romainbdr.github.io/nba-players-prime/` (voir « Publication » ci-dessous).

## Méthode en bref

- **Variations entre saisons consécutives.** Pour chaque âge, on mesure la variation moyenne d’un même joueur entre deux saisons
  successives, pondérée par les minutes jouées, puis on cumule ces variations lissées pour obtenir la courbe d’âge. Cela limite
  (sans l’éliminer) le biais de survie d’une simple moyenne par âge.
- **Pic et prime.** Le pic est le maximum de la courbe ; la prime est la plage d’âges où le niveau reste à moins de 0,1, 0,2 ou 0,3
  écart-type de ce maximum.
- **Incertitude.** Intervalles à 90 % obtenus par rééchantillonnage des joueurs (300 tirages). Un âge n’est tracé qu’à partir de
  30 paires de saisons consécutives.
- **Limites.** L’analyse est descriptive et décrit un joueur moyen ; elle ne sépare pas le vieillissement physique de l’évolution
  des rôles, des blessures ou des choix des entraîneurs. Le détail figure dans l’onglet « Méthode » de la page.

## Contenu du dépôt

| Chemin | Rôle |
|---|---|
| `index.html` | page du tableau de bord |
| `assets/app.js`, `assets/app.css`, `assets/theme.css` | graphiques (d3), mise en page et jetons de style (mode clair et sombre) |
| `assets/intro.js`, `assets/intro.css` | section d’accueil : chiffres de la présentation lus dans les CSV, courbe d’âge annotée (BPM, tous postes) et boutons qui ouvrent les onglets |
| `assets/dash.js` | petite couche de données : charge les CSV, garde les filtres dans l’adresse (`?metric=per&pos=C`) et l’onglet dans l’ancre (`#methode`) |
| `assets/d3.min.js` | d3 v7.9.0 (licence ISC) |
| `data/*.csv` | résultats des calculs et indicateurs par joueur et par saison utilisés par la page |
| `analysis/` | scripts Python qui produisent les CSV à partir de l’archive d’origine |

## Utilisation en local

La page charge ses données avec `fetch`, ce qui exige un petit serveur HTTP (l’ouverture directe du fichier ne fonctionne pas) :

```bash
python3 -m http.server 8000
# puis ouvrir http://localhost:8000/
```

## Publication sur GitHub Pages

1. Dans **Settings → Pages**, choisir **Deploy from a branch**, la branche `main` et le dossier `/ (root)`.
2. La page est servie à l’adresse `https://romainbdr.github.io/nba-players-prime/` après une à deux minutes.

Le fichier `.nojekyll` désactive le traitement Jekyll, inutile ici.

## Régénérer les données

```bash
pip install numpy pandas
# télécharger et décompresser l’archive Kaggle « NBA Stats (1947-present) » (sumitrodatta) dans archive/
python3 analysis/build.py archive/ data/          # tables du tableau de bord (plusieurs minutes : rééchantillonnage)
python3 analysis/verify.py archive/ data/         # recalcul indépendant des courbes et comparaison aux CSV
```

Le fichier `data/reperes.csv` (ordres de grandeur de minutes par rôle) est saisi à la main et n’est pas produit par ces scripts.

## Données

Statistiques de Basketball-Reference, via l’archive Kaggle
[NBA Stats (1947-present)](https://www.kaggle.com/datasets/sumitrodatta/nba-aba-baa-stats) de sumitrodatta. Le dossier `data/` ne
contient que des résultats agrégés et les indicateurs par joueur et par saison nécessaires à l’explorateur, pas l’archive complète.
Vérifier les conditions d’utilisation de ces sources avant toute réutilisation.
