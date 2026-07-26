# Spécification technique — OKF Workspace

**Objet** : Outil de travail pour la maintenance de fiches OKF (Objets de Connaissance Fondamentale) adossées au RCC-M 2018 (AFCEN). Application React monopage, fichier unique, sans backend ni dépendances externes autres que React et une API LLM compatible OpenAI-like.

**Format du livrable** : un seul fichier `okf-workspace.jsx` (JSX = JavaScript + syntaxe XML pour les composants React ; transpilé par Vite, Create React App, ou tout bundler standard). Le composant racine est l'export default. Tout le style est en inline styles React — aucune feuille CSS externe, aucun framework CSS.

**Environnement cible** : navigateur moderne (Chrome/Edge recommandé pour le support natif `#page=N` dans les iframes PDF). Aucune dépendance npm au-delà de `react` et `react-dom`.

---

## 1. Vue d'ensemble

L'application est une interface à **trois colonnes** occupant toute la hauteur de la fenêtre (`100vh`). Elle permet de travailler simultanément sur :

1. **Colonne gauche** — Éditeur de la fiche OKF active + éditeurs des fichiers auxiliaires (`index.md`, `log.md`)
2. **Colonne centrale** — Visionneuse PDF du RCC-M, navigant automatiquement aux pages indiquées dans la fiche
3. **Colonne droite** — Chat LLM (appel à une API de complétion compatible OpenAI) contextualisé par le contenu des trois fichiers

Un **toggle global** en haut à droite bascule entre mode Édition et mode Lecture.

---

## 2. Architecture RAG

### Principe général

Le bundle OKF joue le rôle de **boussole de navigation** : ses métadonnées (`ref_rccm`, `pages_pdf`, `titre`) indiquent *quoi* chercher dans la base documentaire. La base RAG fournit le *contenu brut* du RCC-M sous forme de chunks. Les chunks récupérés sont injectés en tête du system prompt LLM, avant les fiches OKF, car ils constituent la source primaire.

```
Message utilisateur
      │
      ▼
[OKF fiche active] → buildRagQuery()  ← ref_rccm + titre + message
      │
      ▼
POST RAG_API_URL { query, refs, pages, top_k }
      │
      ▼
chunks[]  ──┐
            ├──► system prompt LLM :
OKF files ──┘    [extraits RCC-M] + [bundle OKF] + [instructions]
      │
      ▼
Réponse LLM contextualisée
```

### Configuration (constantes en tête de fichier)

```js
const RAG_API_URL = ""; // URL de l'endpoint REST de la base RAG
                        // Si vide : mode dégradé (pas de retrieval, LLM fonctionne sur OKF seul)
const RAG_TOP_K   = 5; // nombre de chunks à récupérer par requête
```

### Contrat de l'API RAG

**Requête** (POST JSON) :
```json
{
  "query":   "B5300 B5310 Contrôle des soudures bout-à-bout qualification",
  "refs":    ["B5300", "B5310", "B5320"],
  "pages":   { "start": 142, "end": 158 },
  "top_k":   5
}
```
- `query` : chaîne combinant `ref_rccm` de la fiche + `titre` + message utilisateur
- `refs` : tableau des références RCC-M parsées depuis le front-matter (aide le backend à filtrer)
- `pages` : plage de pages issue de `pages_pdf` (hint de localisation, optionnel côté backend)
- `top_k` : nombre maximum de chunks souhaités

**Réponse** (JSON) :
```json
{
  "chunks": [
    {
      "id":         "chunk-b5310-142",
      "ref":        "B5310",
      "page_start": 142,
      "page_end":   145,
      "text":       "Texte extrait du RCC-M…",
      "score":      0.91
    }
  ]
}
```
- `id` : identifiant unique du chunk (string)
- `ref` : référence RCC-M du chunk (ex. "B5310")
- `page_start`, `page_end` : numéros de pages dans le PDF source
- `text` : contenu textuel du chunk (utilisé directement dans le prompt)
- `score` : score de similarité (float 0–1, affiché dans l'UI)

### Fonction `buildRagQuery(meta, userMessage)`

Construit la query en concaténant, séparés par un espace, les champs non vides :
1. `meta.ref_rccm` (ex. "B5300, B5310, B5320")
2. `meta.titre` (ex. "Contrôle des soudures bout-à-bout")
3. `userMessage` (le message de l'utilisateur)

### Fonction `fetchRagChunks(meta, userMessage)`

- Si `RAG_API_URL` est vide : retourne `[]` immédiatement (mode dégradé silencieux)
- Sinon : appelle `RAG_API_URL` en POST avec `{ query, refs, pages, top_k }`
- En cas d'erreur réseau ou HTTP non-2xx : log `console.warn` et retourne `[]`
- Retourne `data.chunks` si tableau, sinon `[]`

### Fonction `formatChunksForPrompt(chunks)`

Retourne `null` si `chunks` est vide. Sinon, formate chaque chunk ainsi :
```
--- Chunk N | {ref} | pp.{page_start}–{page_end} | score {score.toFixed(2)} ---
{text}
```
Chunks séparés par `\n\n`.

### Injection dans le system prompt

Les chunks sont injectés **avant** le bundle OKF dans le system prompt, dans une section dédiée :
```
=== EXTRAITS RCC-M — SOURCE PRIMAIRE (base RAG) ===
Ces passages sont extraits directement du RCC-M 2018.
Appuie-toi prioritairement sur ces extraits pour répondre aux questions techniques.
Cite la référence et les pages lorsque tu t'y réfères.

{chunksBlock}
```
Si aucun chunk n'est disponible, cette section est omise entièrement.

### Mode dégradé

Si `RAG_API_URL` est vide ou si l'appel échoue, l'application fonctionne normalement sur la base des fiches OKF seules. Aucune erreur n'est affichée à l'utilisateur ; le `ragStatus` passe à `"disabled"` ou `"error"` selon le cas.


---

## 3. Palette de couleurs

Toutes les couleurs sont définies dans un objet constant `C` utilisé dans tous les composants. Aucune classe CSS externe.

```js
const C = {
  bg:        "#0d1117",   // fond général (noir bleuté)
  surface:   "#161b22",   // surfaces secondaires (headers, panneaux)
  border:    "#21262d",   // bordures
  borderAct: "#388bfd",   // bordure active (non utilisée directement mais dans la palette)
  text:      "#e6edf3",   // texte principal
  muted:     "#8b949e",   // texte secondaire / labels
  amber:     "#d29922",   // accent principal (titres OKF, actions primaires)
  amberBg:   "#1a1500",   // fond ambre très sombre (bandeau pages PDF)
  green:     "#3fb950",   // statut VALIDÉ, confirmations
  red:       "#f85149",   // erreurs (dans la palette, non utilisé activement)
  blue:      "#388bfd",   // liens, onglets actifs, badge ID fiche
  blueDim:   "#1f3358",   // fond bulle utilisateur dans le chat
  purple:    "#bc8cff",   // statut BROUILLON
};
```

Esthétique : **engineering-grade dark** — monospace dominant, accents ambre, minimalisme sobre.

---

## 4. Données initiales (démo)

L'application s'ouvre avec des données d'exemple hardcodées dans trois constantes :

### `SAMPLE_OKF`
Fiche markdown complète avec front-matter YAML :
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
```
Suivi d'un corps markdown avec sections `## Objet`, `## Domaine d'application`, `## Références normatives` (tableau), `## Exigences principales` (liste numérotée), `## Actions en cours` (cases à cocher GFM), `## Historique` (tableau).

### `SAMPLE_INDEX`
Fichier markdown avec un tableau de 6 fiches (colonnes : ID, Titre, Statut, Pages RCC-M, Liens).

### `SAMPLE_LOG`
Journal markdown chronologique (sections `## YYYY-MM-DD` avec entrées `- [ID] ...`).

---

## 5. Parsing du front-matter

Fonction `parseFrontMatter(md: string) → object` :

- Extrait le bloc entre `---\n` et `\n---` via regex
- Parse chaque ligne `clé: valeur`
- Cas spécial pour `pages_pdf` : parse la valeur `"142-158"` en `{ start: 142, end: 158, raw: "142-158" }` et le stocke sous la clé `pages` (pas `pages_pdf`)
- Retourne un objet plat avec toutes les autres clés telles quelles (strings)

Le résultat `meta` est calculé dans le composant racine à chaque render : `const meta = parseFrontMatter(okfContent)`.

---

## 6. Icônes

Objet `Icon` avec des fonctions-composants SVG inline (pas de bibliothèque). Icônes nécessaires :

| Clé | Usage |
|-----|-------|
| `file` | En-tête panneau OKF |
| `pdf` | En-tête panneau PDF |
| `chat` | En-tête panneau chat |
| `send` | Bouton envoi chat |
| `copy` | Copier fiche |
| `prev` / `next` | Navigation PDF |
| `link` | Affichage des liens inter-fiches |
| `check` | Confirmation copie + bouton appliquer edits |
| `upload` | Ouvrir fichier |
| `save` | Télécharger fichier |

Toutes les SVGs ont `width="14" height="14"` (ou `12` pour copy/link/check), `fill="currentColor"`, viewBox `0 0 16 16`.

---

## 7. Composant `StatusBadge`

Props : `{ status: string }`

Rendu : `<span>` avec couleur et fond selon la valeur :

| Valeur | Couleur | Fond | Label affiché |
|--------|---------|------|---------------|
| `VALIDÉ` | `C.green` | `#0d2a1a` | `VALIDÉ` |
| `EN_COURS` | `C.amber` | `#1a1500` | `EN COURS` |
| `BROUILLON` | `C.purple` | `#1a0f1a` | `BROUILLON` |
| autre | `C.muted` | `C.surface` | valeur brute ou `—` |

Style : `border: 1px solid ${couleur}44`, `borderRadius: 4`, `fontSize: 10`, `fontWeight: 700`, `padding: "2px 8px"`, `letterSpacing: 1`, `fontFamily: "monospace"`.

---

## 8. Composant `MarkdownPreview`

Props : `{ content: string }`

Rendu ligne par ligne après suppression du front-matter (`content.replace(/^---[\s\S]*?---\n/, "")`). Pas de bibliothèque markdown. Règles de rendu :

| Pattern | Rendu |
|---------|-------|
| `### ...` | `<h3>` couleur `C.blue`, fontSize 14 |
| `## ...` | `<h2>` couleur `C.text`, borderBottom, fontSize 16 |
| `# ...` | `<h1>` couleur `C.amber`, fontSize 18 |
| `\| ...` | Ligne de tableau : `display: grid` avec colonnes égales. Les séparateurs `\|---|` sont ignorés (`return null`). Première cellule en `C.amber`, reste en `C.text`, fontFamily monospace, fontSize 12 |
| `- [ ] ...` | Case non cochée : `☐` amber + texte muted |
| `- [x] ...` | Case cochée : `☑` green + texte muted |
| `- ...` | Puce `•` avec `paddingLeft: 16` |
| `1. ...` | Idem avec texte tel quel |
| ligne vide | `<div style={{ height: 8 }} />` |
| autre | `<p>` fontSize 13 |

Le composant gère aussi le gras inline (`**texte**`) dans les paragraphes : split sur `(\*\*.*?\*\*)`, rendu en `<strong style={{ color: C.amber }}>`.

---

## 9. Composant `PDFPanel`

Props : `{ meta: object }` (l'objet parsé depuis le front-matter)

### État local
- `pdfFile` : nom du fichier chargé (string | null)
- `currentPage` : numéro de page courant (initialisé à `meta?.pages?.start || 1`)
- `pdfUrl` : URL objet créée par `URL.createObjectURL` (string | null)
- `loading` : boolean

### Comportement
- `useEffect` sur `meta?.pages?.start` : met à jour `currentPage` quand le front-matter change
- Chargement via `<input type="file" accept=".pdf">` (ref caché), crée une `objectURL`
- L'iframe reçoit `src={pdfUrl}#page=${currentPage}` pour la navigation par page (comportement natif navigateur)

### Structure visuelle (de haut en bas)

**Barre d'outils** (fond `C.surface`, `borderBottom`) :
- Icône PDF + nom du fichier chargé (ou "Aucun PDF chargé"), tronqué avec `textOverflow: ellipsis`
- Bouton "Ouvrir PDF" (variant `secondary`) déclenche le file input caché

**Bandeau pages** (visible uniquement si `meta?.pages` existe) :
- Fond `C.amberBg`, border `C.amber33`
- Texte : `📌 Pages RCC-M indiquées dans la fiche : **{meta.pages.raw}**` en `C.amber`, fontSize 11, monospace
- Boutons de page individuels pour chaque page dans la plage (max 8 affichés, puis `+N` pour le reste). La page courante est mise en surbrillance amber.

**Barre de navigation** (visible uniquement si `pdfUrl` existe) :
- Boutons prev/next modifiant `currentPage` (min 1)
- Texte `Page {currentPage}` avec la valeur en `C.blue`
- Input numérique à droite pour aller directement à une page (width 56px, fond `C.bg`)

**Zone principale** :
- Si pas de PDF : écran vide centré avec icône PDF dans un carré à bordure dashed, texte "Charger le PDF RCC-M", affichage de `meta.ref_rccm` si disponible, bouton primaire "Ouvrir le PDF RCC-M"
- Si PDF chargé : `<iframe>` 100% largeur/hauteur, `border: none`, `background: #fff`

---

## 10. Composant `ChatPanel`

Props : `{ okfContent, indexContent, logContent, onApplyEdit, readOnly }`

### État local
- `messages` : tableau de `{ role: "user"|"assistant", content: string, edits?: object }`
- `input` : string
- `loading` : boolean

Message initial assistant :
```
"Bonjour ! Je suis votre assistant RCC-M. Je peux vous aider à :

• **Modifier la fiche OKF** active
• **Mettre à jour index.md** (statut, liens, pages)
• **Ajouter une entrée dans log.md**
• **Vérifier la cohérence** des liens inter-fiches
• **Suggérer des amendements** selon le RCC-M

Que souhaitez-vous faire ?"
```

### Appel API

L'application appelle un endpoint de complétion LLM via `fetch`. Le fournisseur est **configurable** : le code doit exposer deux constantes en haut de fichier pour permettre le changement sans modifier la logique :

```js
const LLM_API_URL = "https://api.openai.com/v1/chat/completions"; // à remplacer selon le fournisseur
const LLM_MODEL   = "gpt-4o";                                      // à remplacer selon le fournisseur
const LLM_API_KEY = "";  // laisser vide si injecté par l'environnement, sinon renseigner
```

Format de la requête (compatible OpenAI Chat Completions) :

```js
fetch(LLM_API_URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...(LLM_API_KEY ? { "Authorization": `Bearer ${LLM_API_KEY}` } : {}),
  },
  body: JSON.stringify({
    model: LLM_MODEL,
    max_tokens: 2000,
    messages: [
      { role: "system", content: systemPrompt },
      ...conversationHistory   // tableau { role: "user"|"assistant", content: string }
    ],
  }),
});
```

Extraction de la réponse texte : `data.choices[0].message.content`.

> **Note d'adaptation** : si le fournisseur retenu utilise un format différent (ex. Anthropic `/v1/messages` avec champ `system` séparé, Gemini avec `generationConfig`, etc.), seule la fonction d'appel `sendMessage` doit être modifiée — le reste de l'application est indépendant du fournisseur.

### System prompt — mode Édition

```
Tu es un assistant expert en RCC-M (Règles de Conception et de Construction des Matériels Mécaniques des ilots nucléaires). Tu aides à maintenir des fiches OKF (Objets de connaissance fondamentale).

CONTENU ACTUEL DES FICHIERS :

=== FICHE OKF ACTIVE (fiche.md) ===
{okfContent}

=== INDEX (index.md) ===
{indexContent}

=== JOURNAL (log.md) ===
{logContent}

INSTRUCTIONS :
- Réponds en français, de manière concise et professionnelle
- Quand tu proposes des modifications, formate-les dans un bloc JSON entre balises <EDITS> et </EDITS> avec cette structure :
{
  "fiche": "contenu complet modifié de la fiche si modifiée, sinon null",
  "index": "contenu complet modifié de index.md si modifié, sinon null",
  "log": "contenu complet modifié de log.md si modifié, sinon null",
  "summary": "résumé des changements en 1-2 phrases"
}
- Explique toujours tes modifications avant le bloc EDITS
- Respecte scrupuleusement la nomenclature RCC-M (chapitres B, C, S, F, etc.)
- Maintiens la cohérence des liens entre fiches
- Pour log.md, ajoute toujours en haut avec la date d'aujourd'hui
```

### System prompt — mode Lecture (`readOnly === true`)

Même préambule + contenu des fichiers, mais la section INSTRUCTIONS est remplacée par :

```
MODE LECTURE SEULE : L'utilisateur consulte uniquement. Réponds à ses questions en t'appuyant sur le contenu des fiches ci-dessus. N'émets pas de blocs EDITS et ne propose pas de modifications. Tu peux signaler des incohérences ou des points d'attention, mais sans proposer d'action.
```

### Parsing de la réponse

Après réception, chercher `/<EDITS>([\s\S]*?)<\/EDITS>/` dans le texte. Si trouvé :
- Parser le JSON intérieur → objet `edits` avec clés `fiche`, `index`, `log`, `summary`
- Retirer le bloc `<EDITS>...</EDITS>` du texte affiché
- Stocker `edits` dans le message pour affichage

### Rendu des messages

Chaque message est affiché dans un `div` flex :
- **Utilisateur** : aligné à droite, bulle fond `C.blueDim`, border `C.blue44`, border-radius `12px 4px 12px 12px`, avatar "MOI" en bleu
- **Assistant** : aligné à gauche, bulle fond `C.surface`, border `C.border`, border-radius `4px 12px 12px 12px`, avatar "AI" en amber

Rendu du contenu ligne par ligne :
- `**texte**` (ligne entière) → div fontWeight 700, couleur selon locuteur
- `• ...` ou `- ...` → puce indentée en `C.muted`
- `✅ ...` → couleur `C.green`
- ligne vide → spacer 6px
- sinon → div normal avec traitement inline `**bold**`

**Bloc edits** (affiché sous la bulle si `msg.edits` existe) :
- Fond `${C.green}11`, border `${C.green}44`, borderRadius 8
- Header "MODIFICATIONS PROPOSÉES" en `C.green`, fontSize 11, fontWeight 700
- Texte `edits.summary` en `C.muted`
- Badges colorés pour chaque fichier modifié (non-null) : `📝 fiche.md` amber, `📋 index.md` bleu, `📒 log.md` purple
- Bouton "Appliquer les modifications" (variant `primary`, pleine largeur)
  - En mode `readOnly` : `disabled`, opacity 0.4, cursor `not-allowed`, label "🔒 Modifications désactivées"
  - En mode édition : appelle `onApplyEdit(edits)` puis ajoute un message assistant de confirmation

**Indicateur de chargement** (pendant l'appel API) :
- Trois points pulsants (animation CSS `pulse` : `0%,100% { opacity:.3; transform:scale(.8) } 50% { opacity:1; transform:scale(1) }`)
- Délais : 0s, 0.2s, 0.4s
- Label "Analyse en cours..."

### Suggestions rapides

Ligne de boutons pill (`borderRadius: 12`) au-dessus de la zone de saisie. Les suggestions changent selon le mode :

**Mode Édition** :
- "Met à jour le statut en VALIDÉ"
- "Ajoute une entrée dans log.md"
- "Vérifie la cohérence des liens"
- "Met à jour les références B5310"

**Mode Lecture** :
- "Résume cette fiche"
- "Quelles sont les exigences clés ?"
- "Explique les références RCC-M"
- "Vérifie la cohérence des liens"

Au clic : injecte la suggestion dans le champ de saisie.

Hover : `borderColor → C.amber`, `color → C.amber`.

### Zone de saisie

Toujours visible (même en mode lecture). `<textarea rows={2}`, resize none, `Enter` sans Shift envoie, Shift+Enter insère un saut de ligne.

- Mode édition : placeholder "Décrivez la modification souhaitée... (Entrée pour envoyer)", focus border `C.blue`
- Mode lecture : placeholder "Posez une question sur cette fiche... (Entrée pour envoyer)", focus border `C.amber`

---

## 11. Composant `OKFPanel`

Props : `{ content, onChange, meta, readOnly }`

### État local
- `tab` : `"edit"` | `"preview"` — initialisé à `"preview"` si `readOnly`, sinon `"edit"`
- `copied` : boolean (feedback visuel copie)
- `useEffect` sur `readOnly` : force `tab` à `"preview"` si `readOnly` passe à `true`

### Structure (haut en bas)

**En-tête** (fond `C.surface`) :
- Ligne 1 : icône file + `meta.id` en amber monospace bold + `StatusBadge` + boutons à droite
  - Boutons en mode édition : "Ouvrir" (label input file accept=".md,.markdown") + icône save (télécharge le fichier `{meta.id}.md`) + icône copy (clipboard, feedback 1.5s avec check)
  - Mode lecture : seul le bouton copy est présent
- Ligne 2 : métadonnées inline en fontSize 11 — `ref_rccm` en `C.blue`, `pages` en `C.amber`, `version`, `auteur` en `C.muted`
- Ligne 3 (si `meta.liens`) : rangée de badges liens inter-fiches (fond `${C.blue}11`, border `${C.blue}33`, couleur `C.blue`, fontSize 10)

**Barre d'onglets** :
- Mode édition : deux onglets "✏️ Édition" et "👁 Aperçu"
- Mode lecture : un seul onglet "👁 Aperçu" + label "🔒 lecture seule" en `C.muted` à droite
- Onglet actif : `color: C.blue`, `borderBottom: 2px solid C.blue`

**Zone de contenu** :
- Tab `edit` : `<textarea>` fond `C.bg`, fontFamily monospace, fontSize 12, lineHeight 1.7, padding 16px, tabSize 2, spellCheck false, `onChange` appelle `onChange` prop
- Tab `preview` : `<div>` scrollable + `<MarkdownPreview content={content} />`

---

## 12. Composant `SideFiles`

Props : `{ indexContent, logContent, onIndexChange, onLogChange, readOnly }`

Occupe le tiers inférieur de la colonne gauche (le panneau OKF occupe `flex: 0 0 65%`, SideFiles prend le reste).

### Structure

**Barre d'onglets** (fond `C.surface`) :
- Deux onglets : "📋 index.md" et "📒 log.md"
- À droite : bouton upload (caché en `readOnly`) + bouton download (toujours visible)

**Textarea** :
- `readOnly={readOnly}`
- `onChange` : no-op si `readOnly`, sinon appelle le handler approprié
- Mode lecture : fond `${C.surface}cc`, cursor `default`
- Mode édition : fond `C.bg`, cursor `text`
- fontFamily monospace, fontSize 11, lineHeight 1.6, padding 10px

---

## 13. Composant racine `OKFWorkspace`

### État
- `okfContent` : string (initialisé à `SAMPLE_OKF`)
- `indexContent` : string (initialisé à `SAMPLE_INDEX`)
- `logContent` : string (initialisé à `SAMPLE_LOG`)
- `layout` : `"3col"` | `"focus-okf"` | `"focus-pdf"` (initialisé à `"3col"`)
- `readOnly` : boolean (initialisé à `false`)

### Layout CSS Grid

```js
const colW = {
  "3col":      ["1fr", "1fr", "1fr"],
  "focus-okf": ["2fr", "1.5fr", "0.5fr"],
  "focus-pdf": ["0.5fr", "2fr", "1fr"],
}[layout];
// appliqué comme gridTemplateColumns avec transition: "grid-template-columns .3s"
```

### Callback `handleApplyEdit`

```js
const handleApplyEdit = useCallback(({ fiche, index, log }) => {
  if (fiche) setOkfContent(fiche);
  if (index) setIndexContent(index);
  if (log)   setLogContent(log);
}, []);
```

### Structure globale

```
<div height:100vh flex-column>
  <header height:44px>
    Logo ⚛ + "OKF Workspace — RCC-M"
    Badge ID fiche active (si meta.id)
    [push right]
    Toggle Lecture/Édition
    Séparateur vertical
    Boutons layout ⊞ ⊟ ⊠
  </header>
  <div flex:1 display:grid gridTemplateColumns:{colW}>
    <col1 flex-column borderRight>
      <OKFPanel flex:0 0 65% />
      <SideFiles flex:1 />
    </col1>
    <col2 borderRight>
      <PDFPanel />
    </col2>
    <col3>
      <ChatPanel />
    </col3>
  </div>
  <style> /* pulse animation + scrollbar webkit */ </style>
</div>
```

### En-tête global

**Logo** : carré 24×24, `borderRadius: 6`, fond `${C.amber}22`, border `${C.amber}44`, emoji `⚛` à l'intérieur. Texte "OKF Workspace" en monospace amber bold + "— RCC-M" en `C.muted`.

**Badge fiche active** : pill `borderRadius: 20`, fond `${C.blue}11`, border `${C.blue}33`. Affiche `meta.id` + `StatusBadge`. Visible uniquement si `meta.id` existe.

**Toggle Lecture/Édition** :
- Pill `borderRadius: 20`, border et fond changent selon `readOnly`
- Contient un toggle switch visuel (div 28×16, borderRadius 8, fond `C.amber` ou `C.border`) avec knob circulaire (12×12) qui se translate de `left: 2` à `left: 14` via transition CSS
- Label : "🔒 Lecture" ou "✏️ Édition"

**Boutons layout** : trois boutons ghost avec les symboles Unicode `⊞` `⊟` `⊠`, colorés en `C.blue` si actif, `C.muted` sinon.

---

## 14. Helpers de style

Fonction `btnStyle(variant: "primary"|"secondary"|"ghost") → CSSProperties` :

```js
// base commune
{
  display: "inline-flex", alignItems: "center", gap: 5,
  border: "1px solid", borderRadius: 6, cursor: "pointer",
  fontSize: 12, fontFamily: "system-ui", padding: "4px 10px",
  transition: "all .15s", whiteSpace: "nowrap",
}
// primary : background C.amber, color "#0d0d0d", fontWeight 700
// secondary : background C.surface, color C.text, borderColor C.border
// ghost : background transparent, color C.muted, borderColor transparent
```

---

## 15. CSS global (via `<style>` injecté dans le JSX)

```css
@keyframes pulse {
  0%, 100% { opacity: .3; transform: scale(.8); }
  50% { opacity: 1; transform: scale(1); }
}
* { box-sizing: border-box; }
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #484f58; }
```

---

## 16. Contraintes d'implémentation

1. **Fichier unique** : tout le code dans un seul fichier `.jsx`, export default du composant racine. Le JSX est transpilé par le bundler (Vite, CRA, ou équivalent) — aucune configuration spéciale requise.
2. **Pas de localStorage ni sessionStorage** : tout l'état est en mémoire React (`useState`). Aucune persistance entre sessions.
3. **Pas de bibliothèque markdown** : rendu manuel ligne par ligne dans `MarkdownPreview`.
4. **Pas de bibliothèque PDF** : viewer via `<iframe src="{objectURL}#page={n}">`. Le support du paramètre `#page=` dépend du navigateur (Chrome/Edge : OK ; Firefox : OK ; Safari : partiel).
5. **Pas de `<form>` HTML** : les interactions utilisent `onClick`, `onChange`, `onKeyDown`.
6. **Imports React uniquement** : `import { useState, useRef, useEffect, useCallback } from "react"`. Aucune autre dépendance npm.
7. **API LLM** : appel direct via `fetch` natif, sans SDK. Le fournisseur est paramétrable via `LLM_API_URL`, `LLM_MODEL`, `LLM_API_KEY` (voir section 9). Le format attendu en réponse est `data.choices[0].message.content` (OpenAI-compatible).
8. **Tout le style en inline styles** : objet JS passé à l'attribut `style`, pas de classes CSS, pas de Tailwind, pas de styled-components.
9. **Responsive** : non requis. Conçu pour desktop ≥ 1200px de large.

---

## 17. Comportements à tester

| Scénario | Comportement attendu |
|----------|---------------------|
| Chargement initial | Données SAMPLE affichées, mode Édition actif, layout 3col |
| Parsing front-matter | `pages_pdf: 142-158` → boutons de pages 142 à 149 + `+8` dans le bandeau PDF |
| Navigation PDF par page | Clic sur numéro de page → iframe se recharge avec `#page=N` |
| Chargement fiche `.md` | Front-matter re-parsé, badge ID et statut mis à jour en temps réel |
| Envoi message chat (édition) | System prompt inclut les 3 fichiers ; réponse avec `<EDITS>` parse le JSON et affiche le bloc vert |
| Clic "Appliquer" | `okfContent`, `indexContent`, `logContent` mis à jour ; message de confirmation ajouté |
| Toggle → Lecture | Onglet édition masqué, preview forcé, suggestions chat changent, textarea SideFiles verrouillées, bouton Appliquer grisé, placeholder chat change |
| Toggle → Édition | Tout revient à l'état édition |
| Layout focus-okf | Col1 élargit à 2fr, col2 à 1.5fr, col3 à 0.5fr |
| Copie fiche | Contenu copié dans le presse-papier, icône check 1.5s |
| Téléchargement | Déclenche download navigateur avec le nom `{meta.id}.md` |
