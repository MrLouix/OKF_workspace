# Contribuer à OKF Workspace

Merci de votre intérêt pour contribuer à OKF Workspace ! 🎉

Ce guide vous aidera à comprendre comment contribuer au projet.

---

## 📋 Table des matières

- [🎯 Code de conduite](#-code-de-conduite)
- [🚀 Comment contribuer ?](#-comment-contribuer-)
  - [Signaler un bug](#signaler-un-bug)
  - [Proposer une fonctionnalité](#proposer-une-fonctionnalité)
  - [Contribuer au code](#contribuer-au-code)
- [📂 Structure du projet](#-structure-du-projet)
- [🔧 Développement local](#-développement-local)
- [✅ Bonnes pratiques](#-bonnes-pratiques)
- [📝 Conventions de commit](#-conventions-de-commit)
- [🤝 Processus de Pull Request](#-processus-de-pull-request)

---

## 🎯 Code de conduite

En participant à ce projet, vous acceptez de respecter notre [Code de Conduite](CODE_OF_CONDUCT.md). Soyez bienveillant, respectueux et constructif.

---

## 🚀 Comment contribuer ?

### Signaler un bug

1. Vérifiez que le bug n'a pas déjà été signalé dans les [issues](https://github.com/your-org/okf-workspace/issues)
2. Créez une nouvelle issue en utilisant le template [Bug Report](.github/ISSUE_TEMPLATE/bug_report.md)
3. Fournissez autant de détails que possible :
   - Étapes pour reproduire
   - Comportement attendu vs. comportement réel
   - Capture d'écran si applicable
   - Informations sur votre environnement

### Proposer une fonctionnalité

1. Vérifiez que la fonctionnalité n'a pas déjà été demandée
2. Créez une nouvelle issue en utilisant le template [Feature Request](.github/ISSUE_TEMPLATE/feature_request.md)
3. Expliquez clairement :
   - Le problème que la fonctionnalité résoudrait
   - La valeur ajoutée
   - Une proposition de mise en œuvre si vous en avez une

### Contribuer au code

1. **Forker le dépôt** sur GitHub
2. **Cloner votre fork** localement :
   ```bash
   git clone https://github.com/votre-utilisateur/okf-workspace.git
   cd okf-workspace
   ```
3. **Installer les dépendances** :
   ```bash
   npm install
   ```
4. **Créer une branche** pour votre contribution :
   ```bash
   git checkout -b feature/nom-de-votre-fonctionnalité
   # ou
   git checkout -b fix/nom-du-bug
   ```
5. **Faire vos modifications** en suivant les bonnes pratiques
6. **Tester** vos changements localement
7. **Committer** vos modifications avec des messages clairs
8. **Pousser** vers votre fork :
   ```bash
   git push origin feature/nom-de-votre-fonctionnalité
   ```
9. **Ouvrir une Pull Request** vers la branche `main` du dépôt original

---

## 📂 Structure du projet

```
okf_workspace/
├── src/
│   └── App.jsx              # Code source unique (toute l'application)
├── public/                  # Assets statiques
├── docs/
│   └── spec_okf_workspace.md # Spécification technique détaillée
├── .github/
│   ├── ISSUE_TEMPLATE/      # Templates pour les issues
│   │   ├── bug_report.md
│   │   └── feature_request.md
│   └── workflows/
│       └── ci.yml           # Pipeline CI/CD
├── .gitignore
├── .editorconfig
├── .env.example
├── CONTRIBUTING.md         # Ce fichier
├── LICENSE
├── README.md
├── package.json
└── vite.config.js
```

> ⚠️ **Important** : L'application est conçue comme un **fichier JSX unique**. Tous les composants et la logique sont dans `src/App.jsx`.

---

## 🔧 Développement local

### Prérequis

- Node.js ≥ 18.0.0
- npm ≥ 9.0.0 (ou yarn/pnpm)

### Commandes utiles

| Commande | Description |
|----------|-------------|
| `npm install` | Installe les dépendances |
| `npm run dev` | Démarre le serveur de développement |
| `npm run build` | Génère le build de production |
| `npm run preview` | Précédente le build de production |

### Configuration

Créez un fichier `.env` à la racine du projet en copiant `.env.example` :

```bash
cp .env.example .env
```

Éditez `.env` avec vos clés API (ne commitez jamais ce fichier !).

---

## ✅ Bonnes pratiques

### Code

1. **Respectez le style existant** :
   - Indentation : 2 espaces
   - Point-virgule : optionnel (mais cohérent)
   - Noms de variables : camelCase
   - Noms de composants : PascalCase

2. **Commentaires** :
   - Ajoutez des commentaires pour expliquer le **pourquoi**, pas le **comment**
   - Utilisez des commentaires JSDoc pour les fonctions exportées

3. **Fonctions utilitaires** :
   - Placez-les en haut du fichier, avant les composants
   - Nommez-les de manière descriptive

4. **Composants** :
   - Gardez la structure actuelle (tout dans App.jsx)
   - Si vous devez ajouter un nouveau composant, placez-le avant le composant racine

### Commits

Voir [Conventions de commit](#-conventions-de-commit) ci-dessous.

### Pull Requests

Voir [Processus de Pull Request](#-processus-de-pull-request) ci-dessous.

---

## 📝 Conventions de commit

Nous utilisons les [Conventional Commits](https://www.conventionalcommits.org/) pour standardiser les messages de commit.

### Format

```
type(scope): description

[body]

[footer]
```

### Types de commits

| Type | Description |
|------|-------------|
| `feat` | Nouvelle fonctionnalité |
| `fix` | Correction de bug |
| `docs` | Modification de la documentation |
| `style` | Changements de style (formatage, etc.) |
| `refactor` | Refactorisation du code |
| `perf` | Amélioration des performances |
| `test` | Ajout/modification de tests |
| `chore` | Tâches de maintenance |
| `revert` | Annulation d'un commit |

### Exemples

```bash
# Nouvelle fonctionnalité
git commit -m "feat(chat): ajouter support Anthropic"

# Correction de bug
git commit -m "fix(pdf): corriger navigation par page"

# Documentation
git commit -m "docs: mettre à jour README"

# Refactorisation
git commit -m "refactor(rag): extraire fonction buildRagQuery"
```

---

## 🤝 Processus de Pull Request

1. **Créer une PR** depuis votre branche vers `main`
2. **Donnez un titre clair** à votre PR :
   - `feat: ajouter [fonctionnalité]`
   - `fix: corriger [bug]`
3. **Décrivez vos changements** dans la description :
   - Qu'ai-je changé ?
   - Pourquoi ?
   - Captures d'écran si applicable
   - Issues liées (utilisez `Fixes #123` ou `Closes #456`)
4. **Assurez-vous que** :
   - Votre code suit les bonnes pratiques
   - Tous les tests passent (le cas échéant)
   - Le build fonctionne (`npm run build`)
5. **Attendez les revues** :
   - Un maintainer reviendra sur votre PR
   - Répondez aux commentaires et effectuez les modifications nécessaires
6. **Merge** : Une fois approuvée, votre PR sera mergée

---

## 🙏 Remerciements

Merci à tous les contributeurs ! Votre aide est précieuse pour améliorer OKF Workspace.

---

*Inspiré par les guides de contribution de [React](https://github.com/facebook/react/blob/main/CONTRIBUTING.md) et [Vite](https://github.com/vitejs/vite/blob/main/CONTRIBUTING.md)*
