# OKF Workspace — RCC-M

> **Outil de maintenance de fiches OKF (Open Knowledge Format) adossées au RCC-M 2018 (AFCEN)**

[![React](https://img.shields.io/badge/React-18+-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-5+-646CFF?logo=vite&logoColor=white)](https://vitejs.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 📋 Table des matières

- [🎯 Fonctionnalités](#-fonctionnalités)
- [🏗 Architecture](#-architecture)
- [📦 Prérequis](#-prérequis)
- [⚡ Installation](#-installation)
- [⚙ Configuration](#-configuration)
  - [LLM (Large Language Model)](#llm-large-language-model)
  - [RAG (Retrieval-Augmented Generation)](#rag-retrieval-augmented-generation)
- [🚀 Utilisation](#-utilisation)
- [📂 Structure du projet](#-structure-du-projet)
- [🎨 Style & Design](#-style--design)
- [📄 Fichiers d'exemple](#-fichiers-dexemple)
- [🔧 Développement](#-développement)
- [📜 License](#-license)

---

## 🎯 Fonctionnalités

OKF Workspace est une **application React monopage** (fichier unique) conçue pour :

| Fonctionnalité | Description |
|---------------|-------------|
| **Éditeur OKF** | Édition de fiches markdown avec front-matter YAML (ID, titre, références RCC-M, statut, etc.) |
| **Visionneuse PDF** | Visualisation du RCC-M avec navigation automatique vers les pages indiquées dans la fiche |
| **Chat LLM contextualisé** | Assistant IA intégré avec accès au contenu des fiches OKF et à une base RAG |
| **Architecture RAG** | Récupération de chunks RCC-M pertinents pour enrichir les réponses de l'IA |
| **Mode Lecture/Édition** | Basculer entre consultation et modification des fiches |
| **Layouts adaptatifs** | 3 colonnes ou focus sur OKF/PDF |
| **Gestion de fichiers** | Chargement/sauvegarde de fiches OKF, index.md et log.md |

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         EN-TÊTE GLOBAL                            │
│  ⚛ Logo + Titre  │  Badge Fiche Active  │  Toggle Lecture/Édition  │ │
├─────────────────┬─────────────────────┬────────────────────────────┤
│   COLONNE 1      │    COLONNE 2        │       COLONNE 3               │
│  (Gauche)        │   (Centrale)        │      (Droite)                │
│                 │                     │                            │
│  ┌─────────────┐ │  ┌───────────────┐  │  ┌─────────────────────┐  │
│  │  OKFPanel   │ │  │   PDFPanel   │  │  │     ChatPanel        │  │
│  │  (65%)      │ │  │              │  │  │                     │  │
│  ├─────────────┤ │  │  - Barre     │  │  │  - Messages          │  │
│  │ - Éditeur   │ │  │    outils    │  │  │  - Blocs EDITS       │  │
│  │ - Aperçu    │ │  │  - Bandeau   │  │  │  - Suggestions        │  │
│  │ - Métadonnées││  │    pages    │  │  │  - Zone de saisie     │  │
│  └─────────────┘ │  │  - Navigation│  │  └─────────────────────┘  │
│                 │ │  │  - Iframe   │  │                            │
│  ┌─────────────┐ │  └───────────────┘  │                            │
│  │ SideFiles   │ │                     │                            │
│  │  (35%)      │ │                     │                            │
│  │ - index.md │ │                     │                            │
│  │ - log.md   │ │                     │                            │
│  └─────────────┘ │                     │                            │
└─────────────────┴─────────────────────┴────────────────────────────┘
```

### Flux RAG

```
Message utilisateur
      │
      ▼
[OKF fiche active] → buildRagQuery() ← ref_rccm + titre + message
      │
      ▼
POST RAG_API_URL { query, refs, pages, top_k }
      │
      ▼
chunks[] RCC-M
      │
      ▼
Injection dans system prompt LLM (AVANT le bundle OKF)
      │
      ▼
Réponse LLM contextualisée avec citations RCC-M
```

---

## 📦 Prérequis

- **Node.js** ≥ 18.0.0
- **npm** ≥ 9.0.0 (ou **yarn** / **pnpm**)
- **Navigateur moderne** (Chrome/Edge recommandé pour le support natif de `#page=N` dans les iframes PDF)

---

## ⚡ Installation

1. **Cloner le dépôt** (si applicable) :
   ```bash
   git clone <url-du-depot>
   cd okf_workspace
   ```

2. **Installer les dépendances** :
   ```bash
   npm install
   ```

3. **Démarrer l'application** :
   ```bash
   npm run dev
   ```
   > L'application sera accessible sur [http://localhost:5173](http://localhost:5173)

4. **Build pour la production** :
   ```bash
   npm run build
   ```
   > Les fichiers optimisés seront dans le dossier `dist/`

---

## ⚙ Configuration

### LLM (Large Language Model)

L'application appelle une API LLM compatible OpenAI. Configurez les constantes en tête de fichier `src/App.jsx` :

```javascript
// Fournisseur par défaut : Anthropic
const LLM_API_URL = "https://api.anthropic.com/v1/messages";
const LLM_MODEL   = "claude-sonnet-4-6";  // ou "claude-3-5-sonnet-20250620"
const LLM_API_KEY = "";                   // Renseigner votre clé API
```

**Fournisseurs supportés** :

| Fournisseur | URL | Modèle (exemple) | Format de réponse |
|-------------|-----|------------------|------------------|
| **OpenAI** | `https://api.openai.com/v1/chat/completions` | `gpt-4o` | `data.choices[0].message.content` |
| **Anthropic** | `https://api.anthropic.com/v1/messages` | `claude-3-5-sonnet-20250620` | `data.content[0].text` |
| **Autre** | À configurer | À configurer | Compatible OpenAI par défaut |

> ⚠️ **Note** : Si votre fournisseur utilise un format différent, modifiez uniquement la fonction `sendMessage` dans `ChatPanel`.

### RAG (Retrieval-Augmented Generation)

Pour activer le retrieval RCC-M, configurez l'endpoint RAG :

```javascript
const RAG_API_URL = "https://votre-rag.example.com/retrieve";
const RAG_TOP_K   = 5;  // Nombre de chunks à récupérer
const RAG_API_KEY = ""; // Clé API si nécessaire
```

**Contrat de l'API RAG** :

**Requête (POST JSON)** :
```json
{
  "query": "B5300 B5310 Contrôle des soudures",
  "refs": ["B5300", "B5310", "B5320"],
  "pages": { "start": 142, "end": 158 },
  "top_k": 5
}
```

**Réponse attendue** :
```json
{
  "chunks": [
    {
      "id": "chunk-b5310-142",
      "ref": "B5310",
      "page_start": 142,
      "page_end": 145,
      "text": "Texte extrait du RCC-M 2018...",
      "score": 0.91
    }
  ]
}
```

> 💡 **Mode dégradé** : Si `RAG_API_URL` est vide, l'application fonctionne sans retrieval (LLM basé uniquement sur les fiches OKF).

---

## 🚀 Utilisation

### 1. Chargement initial

Au démarrage, l'application affiche des **données d'exemple** :
- `SAMPLE_OKF` : Fiche OKF-2024-003 (Contrôle des soudures bout-à-bout)
- `SAMPLE_INDEX` : Tableau de 6 fiches OKF
- `SAMPLE_LOG` : Journal des modifications

### 2. Navigation

| Zone | Actions disponibles |
|------|---------------------|
| **OKFPanel** | Éditer/prévisualiser la fiche, charger/sauvegarder un fichier `.md` |
| **PDFPanel** | Charger un PDF RCC-M, naviguer par page (boutons ou input numérique) |
| **ChatPanel** | Discuter avec l'assistant, recevoir des suggestions de modifications |

### 3. Workflow typique

```
1. Charger une fiche OKF (ou utiliser l'exemple)
2. Charger le PDF RCC-M correspondant
3. Basculer en mode **Édition** (toggle en haut à droite)
4. Discuter avec l'assistant pour :
   - Modifier la fiche OKF
   - Mettre à jour index.md
   - Ajouter une entrée dans log.md
   - Vérifier la cohérence des liens
5. Appliquer les modifications proposées (bouton "Appliquer")
6. Sauvegarder les fichiers modifiés
```

### 4. Commandes clavier

| Raccourci | Action |
|-----------|--------|
| `Entrée` | Envoyer le message dans le chat |
| `Shift + Entrée` | Saut de ligne dans le champ de saisie |

---

## 📂 Structure du projet

```
okf_workspace/
├── src/
│   └── App.jsx              # Code source unique (toute l'application)
├── public/                  # Assets statiques
├── docs/
│   └── spec_okf_workspace.md # Spécification technique détaillée
├── README.md                # Ce fichier
├── package.json
├── vite.config.js
└── index.html
```

### Fichier unique `src/App.jsx`

L'application est conçue comme un **fichier JSX unique** (≈980 lignes) contenant :

```
├── Configuration (LLM, RAG, Palette C)
├── Données d'exemple (SAMPLE_OKF, SAMPLE_INDEX, SAMPLE_LOG)
├── Fonctions utilitaires
│   ├── parseFrontMatter()
│   ├── buildRagQuery()
│   ├── fetchRagChunks()
│   └── formatChunksForPrompt()
├── Composants
│   ├── Icon (SVG inline)
│   ├── StatusBadge
│   ├── RagIndicator
│   ├── ChunksDrawer
│   ├── MarkdownPreview
│   ├── PDFPanel
│   ├── ChatPanel
│   ├── OKFPanel
│   ├── SideFiles
│   └── OKFWorkspace (racine)
└── Helpers (btnStyle)
```

---

## 🎨 Style & Design

### Palette de couleurs (`C`)

| Nom | Valeur | Usage |
|-----|--------|-------|
| `bg` | `#0d1117` | Fond général |
| `surface` | `#161b22` | Surfaces secondaires (headers, panneaux) |
| `border` | `#21262d` | Bordures |
| `text` | `#e6edf3` | Texte principal |
| `muted` | `#8b949e` | Texte secondaire |
| `amber` | `#d29922` | Accent principal (titres, actions) |
| `amberBg` | `#1a1500` | Fond ambre (bandeau pages PDF) |
| `green` | `#3fb950` | Statut VALIDÉ |
| `blue` | `#388bfd` | Liens, onglets actifs |
| `purple` | `#bc8cff` | Statut BROUILLON |

**Esthétique** : Engineering-grade dark theme avec polices monospace dominantes et accents ambre.

### Layouts disponibles

| Layout | Colonne 1 | Colonne 2 | Colonne 3 |
|--------|-----------|-----------|-----------|
| `3col` (défaut) | 1fr | 1fr | 1fr |
| `focus-okf` | 2fr | 1.5fr | 0.5fr |
| `focus-pdf` | 0.5fr | 2fr | 1fr |

> Basculer entre les layouts avec les boutons ⊞ (3col) / ⊟ (focus-okf) / ⊠ (focus-pdf) en haut à droite.

---

## 📄 Fichiers d'exemple

### Fiche OKF (SAMPLE_OKF)

```yaml
---
id: OKF-2024-003
titre: Contrôle des soudures bout-à-bout
ref_rccm: B5300, B5310, B5320
pages_pdf: 142-158
statut: EN_COURS
version: 1.2
date_maj: 2024-06-15
auteur: J. Martin
tags: [soudure, contrôle, END]
liens:
  - OKF-2024-001
  - OKF-2024-007
---

# OKF-2024-003 — Contrôle des soudures bout-à-bout

## Objet
Définir les exigences de contrôle non-destructif applicables aux soudures...

## Domaine d'application
- Composants de classe 1, 2 et 3
- Soudures de tuyauteries DN ≥ 50 mm

## Références normatives
| Paragraphe | Objet |
|------------|-------|
| B5300 | Généralités contrôle END |
| B5310 | Contrôle par ultrasons |

## Actions en cours
- [ ] Révision tableau B5310 suite à amendement 2024
- [ ] Validation par expert END
```

### Statuts disponibles

| Statut | Couleur | Fond | Usage |
|--------|---------|------|-------|
| `VALIDÉ` | Vert (#3fb950) | `#0d2a1a` | Fiche validée |
| `EN_COURS` | Ambre (#d29922) | `#1a1500` | Fiche en cours |
| `BROUILLON` | Violet (#bc8cff) | `#1a0f1a` | Brouillon |

---

## 🔧 Développement

### Scripts disponibles

| Commande | Description |
|----------|-------------|
| `npm run dev` | Démarre le serveur de développement |
| `npm run build` | Génère le build de production |
| `npm run preview` | Précédente le build de production |

### Contraintes techniques

1. **Fichier unique** : Tout le code dans `src/App.jsx` (pas de split de composants)
2. **Pas de CSS externe** : Tout le style en inline styles React
3. **Pas de dépendances supplémentaires** : Seulement `react` et `react-dom`
4. **Pas de persistance** : Pas de `localStorage` ni `sessionStorage`
5. **Pas de bibliothèque markdown** : Rendu manuel ligne par ligne
6. **Pas de bibliothèque PDF** : Visionneuse via `<iframe>` natif

### Personnalisation

1. **Modifier les couleurs** : Éditer l'objet `C` en tête de `App.jsx`
2. **Changer les données d'exemple** : Modifier `SAMPLE_OKF`, `SAMPLE_INDEX`, `SAMPLE_LOG`
3. **Adapter le system prompt** : Modifier la section correspondante dans `ChatPanel`

---

## 📜 License

Ce projet est sous license **MIT** — voir le fichier [LICENSE](LICENSE) pour plus de détails.

---

## 🙏 Remerciements

- **AFCEN** pour le RCC-M 2018
- **React** pour le framework
- **Vite** pour le bundling ultra-rapide
