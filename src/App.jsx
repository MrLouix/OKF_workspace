import { useState, useRef, useEffect, useCallback } from "react";

// ─── CONFIGURATION LLM & RAG ─────────────────────────────────────────────────
// Remplacer par les valeurs du fournisseur cible
const LLM_API_URL = "https://api.anthropic.com/v1/messages";
const LLM_MODEL   = "claude-sonnet-4-6";
const LLM_API_KEY = ""; // laisser vide si injecté par l'environnement

// Stub RAG — remplacer RAG_API_URL par l'endpoint réel quand disponible.
// L'endpoint doit accepter : POST { query: string, refs: string[], pages: {start,end}|null, top_k: number }
// et retourner : { chunks: [{ id, ref, page_start, page_end, text, score }] }
const RAG_API_URL = ""; // ex. "https://mon-rag.example.com/retrieve"
const RAG_TOP_K   = 5;
const RAG_API_KEY = ""; // laisser vide si injecté par l'environnement, sinon renseigner

// ─── PALETTE & DESIGN ────────────────────────────────────────────────────────
const C = {
  bg:        "#0d1117",
  surface:   "#161b22",
  border:    "#21262d",
  borderAct: "#388bfd",
  text:      "#e6edf3",
  muted:     "#8b949e",
  amber:     "#d29922",
  amberBg:   "#1a1500",
  green:     "#3fb950",
  red:       "#f85149",
  blue:      "#388bfd",
  blueDim:   "#1f3358",
  purple:    "#bc8cff",
  teal:      "#39d353",
};

// ─── SAMPLE DATA ─────────────────────────────────────────────────────────────
const SAMPLE_OKF = `---
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
Définir les exigences de contrôle non-destructif applicables aux soudures bout-à-bout
conformément au RCC-M Tome I, Livre B, Chapitre B5300.

## Domaine d'application
- Composants de classe 1, 2 et 3
- Soudures de tuyauteries DN ≥ 50 mm
- Soudures de viroles et fonds

## Références normatives
| Paragraphe | Objet |
|------------|-------|
| B5300      | Généralités contrôle END |
| B5310      | Contrôle par ultrasons |
| B5320      | Contrôle radiographique |

## Exigences principales
1. Qualification des opérateurs selon RCC-M B5110
2. Procédures de contrôle approuvées avant exécution
3. Compte-rendu de contrôle archivé 30 ans

## Actions en cours
- [ ] Révision tableau B5310 suite à amendement 2024
- [ ] Mise à jour lien vers OKF-2024-001 (procédure parent)
- [ ] Validation par expert END

## Historique
| Version | Date | Modification |
|---------|------|--------------|
| 1.0 | 2024-01-10 | Création initiale |
| 1.1 | 2024-03-22 | Ajout tableau références |
| 1.2 | 2024-06-15 | EN COURS |
`;

const SAMPLE_INDEX = `# index.md — Registre des fiches OKF

| ID | Titre | Statut | Pages RCC-M | Liens |
|----|-------|--------|-------------|-------|
| OKF-2024-001 | Procédures générales soudage | VALIDÉ | 120-135 | - |
| OKF-2024-002 | Matériaux de base classe 1 | VALIDÉ | 80-98 | OKF-2024-001 |
| OKF-2024-003 | Contrôle des soudures bout-à-bout | EN_COURS | 142-158 | OKF-2024-001, OKF-2024-007 |
| OKF-2024-004 | Traitement thermique | BROUILLON | 200-215 | - |
| OKF-2024-005 | Épreuves hydrauliques | VALIDÉ | 310-325 | OKF-2024-003 |
| OKF-2024-007 | Qualification soudeurs | VALIDÉ | 110-119 | OKF-2024-001 |
`;

const SAMPLE_LOG = `# log.md — Journal des modifications

## 2024-06-15
- [OKF-2024-003] v1.2 — Révision en cours (amendement B5310-2024)
- [index.md] Mise à jour statut OKF-2024-003 → EN_COURS

## 2024-05-30
- [OKF-2024-005] v2.0 — Validation finale épreuves hydrauliques

## 2024-03-22
- [OKF-2024-003] v1.1 — Ajout tableau références paragraphes
`;

// ─── PARSE FRONT-MATTER ──────────────────────────────────────────────────────
function parseFrontMatter(md) {
  console.log('[parseFrontMatter] input:', md?.substring(0, 50) + (md?.length > 50 ? '...' : ''));
  if (!md) return {};
  const match = md.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const meta = {};
  match[1].split("\n").forEach(line => {
    const [k, ...v] = line.split(":");
    if (k && v.length) {
      const val = v.join(":").trim().replace(/^["']|["']$/g, "");
      if (k.trim() === "pages_pdf") {
        const [start, end] = val.split("-").map(Number);
        meta.pages = { start: start || 1, end: end || start || 1, raw: val };
      } else {
        meta[k.trim()] = val;
      }
    }
  });
  return meta;
}

// ─── RAG LAYER ───────────────────────────────────────────────────────────────
// La query combine les refs RCC-M de la fiche (navigation OKF) + le message
// utilisateur (intention sémantique). Le bundle OKF joue le rôle de boussole :
// il dit QUOI chercher ; le RAG fournit le CONTENU brut du RCC-M.
function buildRagQuery(meta, userMessage) {
  return [meta?.ref_rccm, meta?.titre, userMessage].filter(Boolean).join(" ");
}

async function fetchRagChunks(meta, userMessage) {
  if (!RAG_API_URL) return [];
  const query = buildRagQuery(meta, userMessage);
  const refs  = (meta?.ref_rccm || "").split(",").map(r => r.trim()).filter(Boolean);
  const pages = meta?.pages ? { start: meta.pages.start, end: meta.pages.end } : null;
  try {
    const resp = await fetch(RAG_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(RAG_API_KEY ? { "Authorization": `Bearer ${RAG_API_KEY}` } : {}),
      },
      body: JSON.stringify({ query, refs, pages, top_k: RAG_TOP_K }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    return Array.isArray(data.chunks) ? data.chunks : [];
  } catch (err) {
    console.warn("RAG retrieval failed:", err.message);
    return [];
  }
}

// Formate les chunks pour injection en tête de system prompt
function formatChunksForPrompt(chunks) {
  if (!chunks.length) return null;
  return chunks.map((c, i) =>
    `--- Chunk ${i+1} | ${c.ref || "?"} | pp.${c.page_start ?? "?"}–${c.page_end ?? "?"} | score ${c.score != null ? c.score.toFixed(2) : "—"} ---\n${c.text}`
  ).join("\n\n");
}

// ─── ICÔNES ──────────────────────────────────────────────────────────────────
const Icon = {
  file:    () => <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25V1.75zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5H3.75zm6.75.56v2.19c0 .138.112.25.25.25h2.19L10.5 2.06z"/></svg>,
  pdf:     () => <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.5L9.5 0H4zm5.5 1.5v3h3L9.5 1.5zM2.5 2A1.5 1.5 0 0 1 4 .5h5v4h4v9.5A1.5 1.5 0 0 1 11.5 15.5h-7A1.5 1.5 0 0 1 3 14V2.5z"/></svg>,
  chat:    () => <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2.678 11.894a1 1 0 0 1 .287.801 11 11 0 0 1-.398 2a11 11 0 0 0 2.205-.306A1 1 0 0 1 5.5 14.5c0 .068-.007.135-.02.2L5.5 15l.017-.003A8.5 8.5 0 0 0 14 8.5C14 4.358 10.642 1 6.5 1 2.357 1 0 4.358 0 8.5c0 1.564.454 3.02 1.227 4.25a1 1 0 0 1 .228.569l.223 2.575zM0 8.5C0 3.806 2.806 0 6.5 0S13 3.806 13 8.5c0 2.117-.7 4.07-1.87 5.624a1 1 0 0 1-.155.176l-.012.01c-.21.18-.449.337-.704.47A9.5 9.5 0 0 1 6.5 16c-.91 0-1.785-.12-2.614-.346a1 1 0 0 1-.29-.134l-.02-.016-.021-.013-.005-.004-.001-.001a1 1 0 0 1-.394-.765l-.252-2.902A9.3 9.3 0 0 1 0 8.5z"/></svg>,
  send:    () => <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M15.854.146a.5.5 0 0 1 .11.54l-5.819 14.547a.75.75 0 0 1-1.329.124l-3.178-4.995L.643 7.184a.75.75 0 0 1 .124-1.33L15.314.037a.5.5 0 0 1 .54.11ZM6.636 10.07l2.761 4.338L14.13 2.576zm6.787-8.201L1.591 6.602l4.339 2.76z"/></svg>,
  copy:    () => <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg>,
  prev:    () => <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z"/></svg>,
  next:    () => <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"/></svg>,
  link:    () => <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M4.715 6.542 3.343 7.914a3 3 0 1 0 4.243 4.243l1.828-1.829A3 3 0 0 0 8.586 5.5L8 6.086a1 1 0 0 0-.154.199 2 2 0 0 1 .861 3.337L6.88 11.45a2 2 0 1 1-2.83-2.83l.793-.792a4 4 0 0 1-.128-1.287z"/><path d="M6.586 4.672A3 3 0 0 0 7.414 9.5l.775-.776a2 2 0 0 1-.896-3.346L9.12 3.55a2 2 0 1 1 2.83 2.83l-.793.792c.112.42.155.855.128 1.287l1.372-1.372a3 3 0 1 0-4.243-4.243z"/></svg>,
  check:   () => <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/></svg>,
  upload:  () => <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/><path d="M7.646 1.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8.5 2.707V11.5a.5.5 0 0 1-1 0V2.707L5.354 4.854a.5.5 0 1 1-.708-.708l3-3z"/></svg>,
  save:    () => <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2 1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H9.5a1 1 0 0 0-1 1v7.293l2.646-2.647a.5.5 0 0 1 .708.708l-3.5 3.5a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L7.5 9.293V2a2 2 0 0 1 2-2H14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h2.5a.5.5 0 0 1 0 1H2z"/></svg>,
  rag:     () => <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M1 2.828c.885-.37 2.154-.769 3.388-.893 1.33-.134 2.458.063 3.112.752v9.746c-.935-.53-2.12-.603-3.213-.493-1.18.12-2.37.461-3.287.811V2.828zm7.5-.141c.654-.689 1.782-.886 3.112-.752 1.234.124 2.503.523 3.388.893v9.923c-.918-.35-2.107-.692-3.287-.81-1.094-.111-2.278-.039-3.213.492V2.687zM8 1.783C7.015.936 5.587.81 4.287.94c-1.514.153-3.042.672-3.994 1.105A.5.5 0 0 0 0 2.5v11a.5.5 0 0 0 .707.455c.882-.4 2.303-.881 3.68-1.02 1.409-.142 2.59.087 3.223.877a.5.5 0 0 0 .78 0c.633-.79 1.814-1.019 3.222-.877 1.378.139 2.8.62 3.681 1.02A.5.5 0 0 0 16 13.5v-11a.5.5 0 0 0-.293-.455c-.952-.433-2.48-.952-3.994-1.105C10.413.809 8.985.936 8 1.783z"/></svg>,
};

// ─── STATUS BADGE ─────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const map = {
    VALIDÉ:    { bg: "#0d2a1a", color: C.green,  label: "VALIDÉ" },
    EN_COURS:  { bg: "#1a1500", color: C.amber,  label: "EN COURS" },
    BROUILLON: { bg: "#1a0f1a", color: C.purple, label: "BROUILLON" },
  };
  const s = map[status] || { bg: C.surface, color: C.muted, label: status || "—" };
  return (
    <span style={{
      background: s.bg, color: s.color, border: `1px solid ${s.color}44`,
      borderRadius: 4, fontSize: 10, fontWeight: 700,
      padding: "2px 8px", letterSpacing: 1, fontFamily: "monospace",
    }}>{s.label}</span>
  );
}

// ─── RAG INDICATOR ───────────────────────────────────────────────────────────
// status: "idle" | "loading" | "ok" | "error" | "disabled"
function RagIndicator({ status, count }) {
  const map = {
    idle:     { color: C.muted, label: "RAG en attente" },
    loading:  { color: C.amber, label: "Retrieval…" },
    ok:       { color: C.teal,  label: `${count} chunk${count > 1 ? "s" : ""} injecté${count > 1 ? "s" : ""}` },
    error:    { color: C.red,   label: "RAG indisponible" },
    disabled: { color: C.muted, label: "RAG non configuré" },
  };
  const s = map[status] || map.idle;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10,
      color: s.color, fontFamily: "monospace",
    }}>
      <Icon.rag /> {s.label}
    </span>
  );
}

// ─── CHUNKS DRAWER ───────────────────────────────────────────────────────────
// Zone repliable sous le chat affichant les chunks injectés dans le contexte.
// Permet à l'utilisateur de voir exactement quel contenu RCC-M a été transmis au LLM.
function ChunksDrawer({ chunks, ragStatus }) {
  const [expanded, setExpanded] = useState(null);
  if (ragStatus === "idle" || ragStatus === "disabled" || (!chunks.length && ragStatus !== "loading")) return null;

  return (
    <div style={{
      borderTop: `1px solid ${C.teal}33`, background: `${C.teal}06`,
      flexShrink: 0, maxHeight: 220, display: "flex", flexDirection: "column",
    }}>
      {/* drawer header */}
      <div style={{
        padding: "5px 12px", display: "flex", alignItems: "center", gap: 8,
        borderBottom: `1px solid ${C.border}`, flexShrink: 0,
      }}>
        <Icon.rag />
        <span style={{ fontSize: 11, color: C.teal, fontFamily: "monospace", fontWeight: 700 }}>
          Contexte RCC-M injecté
        </span>
        {chunks.length > 0 && (
          <span style={{ fontSize: 10, color: C.muted }}>
            — {chunks.length} chunk{chunks.length > 1 ? "s" : ""} · cliquer pour développer
          </span>
        )}
      </div>

      {/* chunk list */}
      <div style={{ overflowY: "auto", flex: 1 }}>
        {ragStatus === "loading" && (
          <div style={{ padding: "8px 12px", display: "flex", gap: 6, alignItems: "center" }}>
            {[0,1,2].map(i => (
              <div key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: C.amber,
                animation: `pulse 1s ease-in-out ${i*0.2}s infinite` }} />
            ))}
            <span style={{ fontSize: 11, color: C.muted }}>Interrogation de la base RCC-M…</span>
          </div>
        )}
        {chunks.map((c, i) => (
          <div key={i}
            onClick={() => setExpanded(expanded === i ? null : i)}
            style={{
              padding: "5px 12px", borderBottom: `1px solid ${C.border}22`,
              cursor: "pointer", userSelect: "none",
            }}
            onMouseEnter={e => e.currentTarget.style.background = `${C.teal}08`}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 10, color: C.teal, fontFamily: "monospace", fontWeight: 700 }}>
                {c.ref || `chunk-${i+1}`}
              </span>
              <span style={{ fontSize: 10, color: C.muted }}>
                pp.{c.page_start}–{c.page_end}
              </span>
              <span style={{ fontSize: 10, color: C.muted, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.text?.slice(0, 80)}…
              </span>
              {c.score != null && (
                <span style={{ fontSize: 10, color: C.muted, flexShrink: 0 }}>
                  {c.score.toFixed(2)}
                </span>
              )}
            </div>
            {expanded === i && (
              <div style={{
                marginTop: 6, fontSize: 11, color: C.text, lineHeight: 1.55,
                fontFamily: "monospace", whiteSpace: "pre-wrap",
                background: C.bg, borderRadius: 4, padding: "8px 10px",
                border: `1px solid ${C.border}`,
              }}>
                {c.text}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── MARKDOWN PREVIEW ────────────────────────────────────────────────────────
function MarkdownPreview({ content }) {
  console.log('[MarkdownPreview] content:', content?.substring(0, 50) + (content?.length > 50 ? '...' : ''));
  if (!content) return null;
  const lines = content.replace(/^---[\s\S]*?---\n/, "").split("\n");
  return (
    <div style={{ fontFamily: "monospace", lineHeight: 1.7, color: C.text, fontSize: 14 }}>
      {lines.map((line, i) => {
        if (line.startsWith("### ")) return <h3 key={i} style={{ color: C.blue, fontSize: 14, marginTop: 16, marginBottom: 4 }}>{line.slice(4)}</h3>;
        if (line.startsWith("## "))  return <h2 key={i} style={{ color: C.text, fontSize: 16, borderBottom: `1px solid ${C.border}`, paddingBottom: 4, marginTop: 20 }}>{line.slice(3)}</h2>;
        if (line.startsWith("# "))   return <h1 key={i} style={{ color: C.amber, fontSize: 18, marginBottom: 12 }}>{line.slice(2)}</h1>;
        if (line.startsWith("| ")) {
          if (/^[| -]+$/.test(line)) return null;
          const cells = line.split("|").filter(c => c.trim());
          return (
            <div key={i} style={{ display: "grid", gridTemplateColumns: `repeat(${cells.length}, 1fr)`, borderBottom: `1px solid ${C.border}26` }}>
              {cells.map((c, j) => <div key={j} style={{ padding: "3px 8px", fontSize: 12, color: j === 0 ? C.amber : C.text, fontFamily: "monospace" }}>{c.trim()}</div>)}
            </div>
          );
        }
        if (line.startsWith("- [ ]")) return <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", color: C.muted, fontSize: 13 }}><span style={{ color: C.amber }}>☐</span>{line.slice(6)}</div>;
        if (line.startsWith("- [x]")) return <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", color: C.muted, fontSize: 13 }}><span style={{ color: C.green }}>☑</span>{line.slice(6)}</div>;
        if (line.startsWith("- ")) return <div key={i} style={{ paddingLeft: 16, color: C.text, fontSize: 13 }}>• {line.slice(2)}</div>;
        if (line.startsWith(/\d+\. /)) return <div key={i} style={{ paddingLeft: 16, color: C.text, fontSize: 13 }}>{line}</div>;
        if (line.trim() === "") return <div key={i} style={{ height: 8 }} />;
        return <p key={i} style={{ margin: "4px 0", fontSize: 13, color: C.text }}>{line}</p>;
      })}
    </div>
  );
}

// ─── PDF VIEWER PANEL ────────────────────────────────────────────────────────
function PDFPanel({ meta }) {
  const [pdfFile, setPdfFile] = useState(null);
  const [currentPage, setCurrentPage] = useState(meta?.pages?.start || 1);
  const [pdfUrl, setPdfUrl] = useState(null);
  const fileInputRef = useRef(null);

  const pageStart = meta?.pages?.start || 1;
  const pageEnd   = meta?.pages?.end   || pageStart;

  useEffect(() => {
    if (meta?.pages?.start) setCurrentPage(meta.pages.start);
  }, [meta?.pages?.start]);

  const handleFileLoad = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setPdfUrl(URL.createObjectURL(file));
    setPdfFile(file.name);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: C.surface, borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <Icon.pdf />
        <span style={{ fontFamily: "monospace", fontSize: 12, color: C.muted, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {pdfFile || "Aucun PDF chargé"}
        </span>
        <button onClick={() => fileInputRef.current?.click()} style={btnStyle("secondary")}>
          <Icon.upload /> Ouvrir PDF
        </button>
        <input ref={fileInputRef} type="file" accept=".pdf" style={{ display: "none" }} onChange={handleFileLoad} />
      </div>

      {meta?.pages && (
        <div style={{ padding: "6px 12px", background: C.amberBg, borderBottom: `1px solid ${C.amber}33`, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span style={{ color: C.amber, fontSize: 11, fontFamily: "monospace" }}>
            📌 Pages RCC-M indiquées : <strong>{meta.pages.raw}</strong>
          </span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
            {Array.from({ length: pageEnd - pageStart + 1 }, (_, i) => pageStart + i).slice(0, 8).map(p => (
              <button key={p} onClick={() => setCurrentPage(p)} style={{
                ...btnStyle("ghost"), padding: "1px 6px", fontSize: 10,
                color: currentPage === p ? C.amber : C.muted,
                background: currentPage === p ? `${C.amber}22` : "transparent",
                border: currentPage === p ? `1px solid ${C.amber}44` : "1px solid transparent",
              }}>{p}</button>
            ))}
            {pageEnd - pageStart + 1 > 8 && <span style={{ color: C.muted, fontSize: 10 }}>+{pageEnd - pageStart - 7}</span>}
          </div>
        </div>
      )}

      {pdfUrl && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", background: C.surface, borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <button onClick={() => setCurrentPage(p => Math.max(1, p-1))} style={btnStyle("ghost")}><Icon.prev /></button>
          <span style={{ fontFamily: "monospace", fontSize: 12, color: C.text }}>
            Page <strong style={{ color: C.blue }}>{currentPage}</strong>
          </span>
          <button onClick={() => setCurrentPage(p => p+1)} style={btnStyle("ghost")}><Icon.next /></button>
          <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
            <span style={{ fontSize: 11, color: C.muted }}>Aller à :</span>
            <input type="number" value={currentPage} onChange={e => setCurrentPage(Number(e.target.value))}
              style={{ width: 56, background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 4, padding: "2px 6px", fontFamily: "monospace", fontSize: 12 }} />
          </div>
        </div>
      )}

      <div style={{ flex: 1, overflow: "hidden" }}>
        {!pdfUrl ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 16 }}>
            <div style={{ width: 64, height: 64, borderRadius: 12, background: C.surface, display: "flex", alignItems: "center", justifyContent: "center", border: `2px dashed ${C.border}` }}>
              <svg width="28" height="28" viewBox="0 0 16 16" fill={C.muted}><path d="M4 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.5L9.5 0H4zm5.5 1.5v3h3L9.5 1.5zM2.5 2A1.5 1.5 0 0 1 4 .5h5v4h4v9.5A1.5 1.5 0 0 1 11.5 15.5h-7A1.5 1.5 0 0 1 3 14V2.5z"/></svg>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ color: C.text, fontSize: 14, marginBottom: 4 }}>Charger le PDF RCC-M</div>
              {meta?.ref_rccm && <div style={{ color: C.muted, fontSize: 12 }}>Référence : <span style={{ color: C.amber }}>{meta.ref_rccm}</span></div>}
            </div>
            <button onClick={() => fileInputRef.current?.click()} style={btnStyle("primary")}>
              <Icon.upload /> Ouvrir le PDF RCC-M
            </button>
          </div>
        ) : (
          <iframe src={`${pdfUrl}#page=${currentPage}`}
            style={{ width: "100%", height: "100%", border: "none", background: "#fff" }}
            title="RCC-M PDF" />
        )}
      </div>
    </div>
  );
}

// ─── CHAT PANEL ──────────────────────────────────────────────────────────────
function ChatPanel({ okfContent, indexContent, logContent, onApplyEdit, readOnly, meta }) {
  const [messages, setMessages] = useState([{
    role: "assistant",
    content: "Bonjour ! Je suis votre assistant RCC-M. Je peux vous aider à :\n\n• **Modifier la fiche OKF** active\n• **Mettre à jour index.md** (statut, liens, pages)\n• **Ajouter une entrée dans log.md**\n• **Interroger la base RCC-M** pour des détails techniques\n\nQue souhaitez-vous faire ?"
  }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [ragStatus, setRagStatus] = useState(RAG_API_URL ? "idle" : "disabled");
  const [lastChunks, setLastChunks] = useState([]);
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const userMessage = input;
    const newMessages = [...messages, { role: "user", content: userMessage }];
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    setLastChunks([]);

    // ── 1. RETRIEVAL : le bundle OKF oriente la query, le RAG retourne les chunks ──
    let chunks = [];
    if (RAG_API_URL) {
      setRagStatus("loading");
      chunks = await fetchRagChunks(meta, userMessage);
      setLastChunks(chunks);
      setRagStatus(chunks.length > 0 ? "ok" : "error");
    }

    // ── 2. SYSTEM PROMPT : chunks en tête, fiches OKF en contexte de navigation ──
    const chunksBlock = formatChunksForPrompt(chunks);
    const systemPrompt = `Tu es un assistant expert en RCC-M (Règles de Conception et de Construction des Matériels Mécaniques des ilots nucléaires). Tu aides à maintenir des fiches OKF (Objets de connaissance fondamentale).
${chunksBlock ? `
=== EXTRAITS RCC-M — SOURCE PRIMAIRE (base RAG) ===
Ces passages sont extraits directement du RCC-M 2018.
Appuie-toi prioritairement sur ces extraits pour répondre aux questions techniques.
Cite la référence et les pages lorsque tu t'y réfères.

${chunksBlock}

` : ""}
=== BUNDLE OKF — NAVIGATION ET CONTEXTE ===

--- FICHE ACTIVE (fiche.md) ---
${okfContent}

--- INDEX (index.md) ---
${indexContent}

--- JOURNAL (log.md) ---
${logContent}

${readOnly
  ? `MODE LECTURE SEULE : Réponds aux questions en t'appuyant sur les extraits RCC-M et les fiches OKF. N'émets pas de blocs EDITS. Tu peux signaler des incohérences sans proposer de modifications.`
  : `INSTRUCTIONS :
- Réponds en français, de manière concise et professionnelle
- Pour les questions techniques sur le RCC-M, cite les extraits injectés (ref + pages)
- Quand tu proposes des modifications aux fiches, encadre le JSON dans <EDITS>...</EDITS> :
{
  "fiche": "contenu complet si modifié, sinon null",
  "index": "contenu complet si modifié, sinon null",
  "log": "contenu complet si modifié, sinon null",
  "summary": "résumé en 1-2 phrases"
}
- Explique toujours tes modifications avant le bloc EDITS
- Respecte la nomenclature RCC-M (chapitres B, C, S, F…)
- Pour log.md, ajoute en haut avec la date d'aujourd'hui`}`;

    // ── 3. APPEL LLM ──────────────────────────────────────────────────────────
    try {
      const resp = await fetch(LLM_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(LLM_API_KEY ? { "Authorization": `Bearer ${LLM_API_KEY}` } : {}),
        },
        body: JSON.stringify({
          model: LLM_MODEL,
          max_tokens: 2000,
          system: systemPrompt,
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await resp.json();
      // Support both Anthropic and OpenAI response shapes
      const text = data.content?.[0]?.text ?? data.choices?.[0]?.message?.content ?? "Erreur de réponse.";

      const editsMatch = text.match(/<EDITS>([\s\S]*?)<\/EDITS>/);
      let edits = null;
      let displayText = text;
      if (editsMatch) {
        try {
          edits = JSON.parse(editsMatch[1].trim());
          displayText = text.replace(/<EDITS>[\s\S]*?<\/EDITS>/, "").trim();
        } catch {}
      }

      setMessages(prev => [...prev, { role: "assistant", content: displayText, edits, chunks }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: "assistant", content: `Erreur : ${err.message}` }]);
    }
    setLoading(false);
  };

  const applyEdits = (edits) => {
    onApplyEdit(edits);
    setMessages(prev => [...prev, {
      role: "assistant",
      content: `✅ Modifications appliquées :\n${edits.summary || "Fichiers mis à jour."}`
    }]);
  };

  const renderMessage = (msg, i) => {
    const isUser = msg.role === "user";
    const lines = msg.content.split("\n");
    return (
      <div key={i} style={{ marginBottom: 16, display: "flex", flexDirection: isUser ? "row-reverse" : "row", gap: 8, alignItems: "flex-start" }}>
        <div style={{
          width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
          background: isUser ? C.blueDim : `${C.amber}22`,
          border: `1px solid ${isUser ? C.blue : C.amber}44`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 10, fontWeight: 700, color: isUser ? C.blue : C.amber,
        }}>
          {isUser ? "MOI" : "AI"}
        </div>
        <div style={{ maxWidth: "85%", display: "flex", flexDirection: "column", gap: 6, alignItems: isUser ? "flex-end" : "flex-start" }}>
          <div style={{
            background: isUser ? C.blueDim : C.surface,
            border: `1px solid ${isUser ? C.blue+"44" : C.border}`,
            borderRadius: isUser ? "12px 4px 12px 12px" : "4px 12px 12px 12px",
            padding: "10px 14px", fontSize: 13, color: C.text, lineHeight: 1.6,
          }}>
            {lines.map((line, j) => {
              if (line.startsWith("**") && line.endsWith("**"))
                return <div key={j} style={{ fontWeight: 700, color: isUser ? C.blue : C.amber, marginBottom: 2 }}>{line.slice(2,-2)}</div>;
              if (line.startsWith("• ") || line.startsWith("- "))
                return <div key={j} style={{ paddingLeft: 12, color: C.muted }}>• {line.slice(2)}</div>;
              if (line.startsWith("✅"))
                return <div key={j} style={{ color: C.green }}>{line}</div>;
              if (line === "") return <div key={j} style={{ height: 6 }} />;
              const parts = line.split(/(\*\*.*?\*\*)/);
              return <div key={j}>{parts.map((p,k) => p.startsWith("**") && p.endsWith("**") ? <strong key={k} style={{ color: C.amber }}>{p.slice(2,-2)}</strong> : p)}</div>;
            })}
          </div>

          {/* Sources RAG citées dans ce message */}
          {!isUser && msg.chunks?.length > 0 && (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {msg.chunks.map((c, ci) => (
                <span key={ci} style={{
                  fontSize: 10, color: C.teal, background: `${C.teal}11`,
                  border: `1px solid ${C.teal}33`, borderRadius: 4,
                  padding: "1px 6px", fontFamily: "monospace",
                }}>
                  📄 {c.ref} p.{c.page_start}
                </span>
              ))}
            </div>
          )}

          {msg.edits && (
            <div style={{ background: `${C.green}11`, border: `1px solid ${C.green}44`, borderRadius: 8, padding: "8px 12px", width: "100%" }}>
              <div style={{ fontSize: 11, color: C.green, marginBottom: 6, fontWeight: 700 }}>MODIFICATIONS PROPOSÉES</div>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>{msg.edits.summary}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {msg.edits.fiche && <span style={{ fontSize: 10, color: C.amber, background: `${C.amber}11`, borderRadius: 4, padding: "2px 6px" }}>📝 fiche.md</span>}
                {msg.edits.index && <span style={{ fontSize: 10, color: C.blue, background: `${C.blue}11`, borderRadius: 4, padding: "2px 6px" }}>📋 index.md</span>}
                {msg.edits.log   && <span style={{ fontSize: 10, color: C.purple, background: `${C.purple}11`, borderRadius: 4, padding: "2px 6px" }}>📒 log.md</span>}
              </div>
              <button onClick={() => applyEdits(msg.edits)} disabled={readOnly}
                style={{ ...btnStyle("primary"), marginTop: 8, width: "100%", justifyContent: "center", opacity: readOnly ? 0.4 : 1, cursor: readOnly ? "not-allowed" : "pointer" }}>
                {readOnly ? "🔒 Modifications désactivées" : <><Icon.check /> Appliquer les modifications</>}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg }}>
      {/* header */}
      <div style={{ padding: "8px 12px", background: C.surface, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <Icon.chat />
        <span style={{ fontFamily: "monospace", fontSize: 12, color: C.text }}>Assistant RCC-M</span>
        <RagIndicator status={ragStatus} count={lastChunks.length} />
        <span style={{ marginLeft: "auto", width: 8, height: 8, borderRadius: "50%", background: C.green, boxShadow: `0 0 6px ${C.green}` }} />
      </div>

      {/* messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 12px" }}>
        {messages.map((m, i) => renderMessage(m, i))}
        {loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {ragStatus === "loading" && (
              <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11, color: C.teal }}>
                <Icon.rag />
                <span>Interrogation de la base RCC-M…</span>
              </div>
            )}
            <div style={{ display: "flex", gap: 8, alignItems: "center", color: C.muted, fontSize: 12 }}>
              <div style={{ display: "flex", gap: 3 }}>
                {[0,1,2].map(i => (
                  <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: C.amber,
                    animation: `pulse 1s ease-in-out ${i*0.2}s infinite` }} />
                ))}
              </div>
              <span>Analyse en cours…</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* chunks drawer — contexte RAG injecté au dernier échange */}
      <ChunksDrawer
        chunks={lastChunks}
        ragStatus={loading && ragStatus === "loading" ? "loading" : (lastChunks.length > 0 ? "ok" : ragStatus)}
      />

      {/* suggestions */}
      {!loading && (
        <div style={{ padding: "8px 12px", display: "flex", gap: 6, flexWrap: "wrap", borderTop: `1px solid ${C.border}` }}>
          {(readOnly
            ? ["Résume cette fiche", "Quelles sont les exigences clés ?", "Détaille B5310 selon le RCC-M", "Vérifie la cohérence des liens"]
            : ["Met à jour le statut en VALIDÉ", "Ajoute une entrée dans log.md", "Détaille B5310 selon le RCC-M", "Met à jour les références"]
          ).map((s, i) => (
            <button key={i} onClick={() => setInput(s)} style={{
              background: "transparent", border: `1px solid ${C.border}`,
              color: C.muted, fontSize: 11, padding: "3px 10px", borderRadius: 12,
              cursor: "pointer", transition: "all .15s", fontFamily: "system-ui",
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = C.amber; e.currentTarget.style.color = C.amber; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; }}
            >{s}</button>
          ))}
        </div>
      )}

      {/* input */}
      <div style={{ padding: "10px 12px", background: C.surface, borderTop: `1px solid ${C.border}`, display: "flex", gap: 8, alignItems: "flex-end", flexShrink: 0 }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
          placeholder={readOnly ? "Posez une question sur cette fiche… (Entrée)" : "Décrivez la modification souhaitée… (Entrée)"}
          rows={2}
          style={{
            flex: 1, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8,
            color: C.text, padding: "8px 12px", resize: "none", fontFamily: "system-ui",
            fontSize: 13, outline: "none", lineHeight: 1.5,
          }}
          onFocus={e => e.target.style.borderColor = readOnly ? C.amber : C.blue}
          onBlur={e => e.target.style.borderColor = C.border}
        />
        <button onClick={sendMessage} disabled={loading || !input.trim()} style={{
          ...btnStyle("primary"), padding: "10px 14px",
          opacity: (!input.trim() || loading) ? 0.5 : 1,
        }}>
          <Icon.send />
        </button>
      </div>
    </div>
  );
}

// ─── OKF EDITOR PANEL ────────────────────────────────────────────────────────
function OKFPanel({ content, onChange, meta, readOnly }) {
  const [tab, setTab] = useState(readOnly ? "preview" : "edit");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    console.log('[OKFPanel] readOnly changed:', readOnly, 'current tab:', tab);
    if (readOnly) {
      setTab("preview");
    } else if (tab === "preview") {
      setTab("edit");
    }
  }, [readOnly, tab]);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const handleFileLoad = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => onChange(ev.target.result);
    reader.readAsText(file);
  };
  const handleSave = () => {
    const blob = new Blob([content], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${meta?.id || "fiche"}.md`;
    a.click();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg }}>
      <div style={{ padding: "8px 12px", background: C.surface, borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <Icon.file />
          <span style={{ fontFamily: "monospace", fontSize: 12, color: C.amber, fontWeight: 700 }}>{meta?.id || "fiche.md"}</span>
          {meta?.statut && <StatusBadge status={meta.statut} />}
          <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
            {!readOnly && (
              <label style={{ ...btnStyle("ghost"), cursor: "pointer", display: "flex", alignItems: "center", gap: 4, padding: "4px 8px" }}>
                <Icon.upload /><span style={{ fontSize: 11 }}>Ouvrir</span>
                <input type="file" accept=".md,.markdown" style={{ display: "none" }} onChange={handleFileLoad} />
              </label>
            )}
            {!readOnly && <button onClick={handleSave} style={btnStyle("ghost")}><Icon.save /></button>}
            <button onClick={handleCopy} style={btnStyle("ghost")}>{copied ? <Icon.check /> : <Icon.copy />}</button>
          </div>
        </div>
        {meta && (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {meta.ref_rccm && <span style={{ fontSize: 11, color: C.muted }}>RCC-M: <span style={{ color: C.blue }}>{meta.ref_rccm}</span></span>}
            {meta.pages && <span style={{ fontSize: 11, color: C.muted }}>Pages: <span style={{ color: C.amber }}>{meta.pages.raw}</span></span>}
            {meta.version && <span style={{ fontSize: 11, color: C.muted }}>v{meta.version}</span>}
            {meta.auteur && <span style={{ fontSize: 11, color: C.muted }}>{meta.auteur}</span>}
          </div>
        )}
        {meta?.liens && (
          <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 10, color: C.muted }}><Icon.link /> Liens:</span>
            {console.log('[OKFPanel] meta.liens:', meta.liens) || (meta.liens || "").replace(/[[\]]/g, "").split(",").map(l => (
              <span key={l} style={{ fontSize: 10, background: `${C.blue}11`, color: C.blue, borderRadius: 4, padding: "1px 6px", border: `1px solid ${C.blue}33` }}>{l.trim()}</span>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, background: C.surface, flexShrink: 0 }}>
        {(readOnly ? ["preview"] : ["edit", "preview"]).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "6px 16px", fontSize: 12, background: "transparent", border: "none",
            cursor: "pointer", fontFamily: "system-ui",
            color: tab === t ? C.blue : C.muted,
            borderBottom: tab === t ? `2px solid ${C.blue}` : "2px solid transparent",
            transition: "all .15s",
          }}>
            {t === "edit" ? "✏️ Édition" : "👁 Aperçu"}
          </button>
        ))}
        {readOnly && <span style={{ marginLeft: "auto", alignSelf: "center", marginRight: 12, fontSize: 10, color: C.muted, fontFamily: "monospace" }}>🔒 lecture seule</span>}
      </div>

      <div style={{ flex: 1, overflow: "hidden" }}>
        {tab === "edit" ? (
          <textarea value={content || ""} onChange={e => onChange(e.target.value)}
            style={{
              width: "100%", height: "100%", background: C.bg, border: "none",
              color: C.text, fontFamily: "monospace", fontSize: 12, lineHeight: 1.7,
              padding: "16px", resize: "none", outline: "none", boxSizing: "border-box", tabSize: 2,
            }}
            spellCheck={false} />
        ) : (
          <div style={{ height: "100%", overflowY: "auto", padding: "16px" }}>
            <MarkdownPreview content={content} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── SIDE FILES PANEL ────────────────────────────────────────────────────────
function SideFiles({ indexContent, logContent, onIndexChange, onLogChange, readOnly }) {
  const [active, setActive] = useState("index");
  const handleFileSave = (name, content) => {
    const blob = new Blob([content], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
  };
  const handleFileLoad = (setter) => (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setter(ev.target.result);
    reader.readAsText(file);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", borderTop: `1px solid ${C.border}` }}>
      <div style={{ display: "flex", background: C.surface, borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        {[["index", "📋 index.md"], ["log", "📒 log.md"]].map(([key, label]) => (
          <button key={key} onClick={() => setActive(key)} style={{
            flex: 1, padding: "5px 8px", fontSize: 11, background: "transparent",
            border: "none", cursor: "pointer", fontFamily: "monospace",
            color: active === key ? C.blue : C.muted,
            borderBottom: active === key ? `2px solid ${C.blue}` : "2px solid transparent",
          }}>{label}</button>
        ))}
        <div style={{ display: "flex", gap: 2, padding: "4px 6px" }}>
          {!readOnly && (
            <label style={{ ...btnStyle("ghost"), cursor: "pointer", padding: "2px 6px", fontSize: 10 }}>
              ↑ <input type="file" accept=".md" style={{ display: "none" }} onChange={handleFileLoad(active === "index" ? onIndexChange : onLogChange)} />
            </label>
          )}
          <button onClick={() => handleFileSave(active === "index" ? "index.md" : "log.md", active === "index" ? indexContent : logContent)}
            style={{ ...btnStyle("ghost"), padding: "2px 6px", fontSize: 10 }}>↓</button>
        </div>
      </div>
      <textarea
        value={active === "index" ? indexContent || "" : logContent || ""}
        onChange={e => !readOnly && (active === "index" ? onIndexChange : onLogChange)(e.target.value)}
        readOnly={readOnly}
        style={{
          flex: 1, background: readOnly ? `${C.surface}cc` : C.bg, border: "none", color: C.text,
          fontFamily: "monospace", fontSize: 11, lineHeight: 1.6,
          padding: "10px", resize: "none", outline: "none",
          cursor: readOnly ? "default" : "text",
        }}
        spellCheck={false}
      />
    </div>
  );
}

// ─── STYLE HELPERS ────────────────────────────────────────────────────────────
function btnStyle(variant) {
  const base = {
    display: "inline-flex", alignItems: "center", gap: 5,
    border: "1px solid", borderRadius: 6, cursor: "pointer",
    fontSize: 12, fontFamily: "system-ui", padding: "4px 10px",
    transition: "all .15s", whiteSpace: "nowrap",
  };
  if (variant === "primary")   return { ...base, background: C.amber, color: "#0d0d0d", borderColor: C.amber, fontWeight: 700 };
  if (variant === "secondary") return { ...base, background: C.surface, color: C.text, borderColor: C.border };
  return { ...base, background: "transparent", color: C.muted, borderColor: "transparent" };
}

// ─── MAIN APP ────────────────────────────────────────────────────────────────
export default function OKFWorkspace() {
  const [okfContent, setOkfContent] = useState(SAMPLE_OKF);
  const [indexContent, setIndexContent] = useState(SAMPLE_INDEX);
  const [logContent, setLogContent] = useState(SAMPLE_LOG);
  const [layout, setLayout] = useState("3col");
  const [readOnly, setReadOnly] = useState(false);

  // Error boundary-like logging
  useEffect(() => {
    const handleError = (event) => {
      console.error('[Global Error]', event.error?.message, event.error?.stack);
    };
    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', (e) => {
      console.error('[Unhandled Rejection]', e.reason?.message, e.reason?.stack);
    });
    return () => {
      window.removeEventListener('error', handleError);
    };
  }, []);

  const meta = parseFrontMatter(okfContent);
  console.log('[OKFWorkspace] readOnly:', readOnly, 'meta:', meta, 'okfContent length:', okfContent?.length);

  const handleApplyEdit = useCallback(({ fiche, index, log }) => {
    if (fiche) setOkfContent(fiche);
    if (index) setIndexContent(index);
    if (log)   setLogContent(log);
  }, []);

  const colW = {
    "3col":      ["1fr", "1fr", "1fr"],
    "focus-okf": ["2fr", "1.5fr", "0.5fr"],
    "focus-pdf": ["0.5fr", "2fr", "1fr"],
  }[layout];

  console.log('[OKFWorkspace] Rendering with readOnly:', readOnly, 'layout:', layout);
  try {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: C.bg, color: C.text, fontFamily: "system-ui" }}>
      {/* global header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12, padding: "0 16px",
        background: C.surface, borderBottom: `1px solid ${C.border}`,
        height: 44, flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 24, height: 24, borderRadius: 6, background: `${C.amber}22`, border: `1px solid ${C.amber}44`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 12 }}>⚛</span>
          </div>
          <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: C.amber }}>OKF Workspace</span>
          <span style={{ fontSize: 11, color: C.muted }}>— RCC-M</span>
        </div>

        {meta?.id && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8, padding: "2px 10px", background: `${C.blue}11`, borderRadius: 20, border: `1px solid ${C.blue}33` }}>
            <span style={{ fontSize: 11, color: C.blue, fontFamily: "monospace" }}>{meta.id}</span>
            {meta.statut && <StatusBadge status={meta.statut} />}
          </div>
        )}

        {/* RAG connection status */}
        <span style={{ fontSize: 10, fontFamily: "monospace", color: RAG_API_URL ? C.teal : C.muted }}>
          {RAG_API_URL ? "⬡ RAG connecté" : "⬡ RAG non configuré"}
        </span>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => {
            console.log('[Toggle] Current readOnly:', readOnly, '->', !readOnly);
            setReadOnly(r => !r);
          }} style={{
            display: "flex", alignItems: "center", gap: 6, padding: "4px 12px", borderRadius: 20,
            fontSize: 11, fontFamily: "monospace", cursor: "pointer", border: "1px solid", transition: "all .2s",
            background: readOnly ? `${C.amber}22` : "transparent",
            borderColor: readOnly ? C.amber : C.border,
            color: readOnly ? C.amber : C.muted,
          }}>
            <span style={{
              display: "inline-block", width: 28, height: 16, borderRadius: 8,
              background: readOnly ? C.amber : C.border,
              position: "relative", transition: "background .2s", flexShrink: 0,
            }}>
              <span style={{
                position: "absolute", top: 2, left: readOnly ? 14 : 2,
                width: 12, height: 12, borderRadius: "50%",
                background: "#fff", transition: "left .2s",
              }} />
            </span>
            {readOnly ? "🔒 Lecture" : "✏️ Édition"}
          </button>
          <div style={{ width: 1, height: 20, background: C.border }} />
          {[["3col", "⊞"], ["focus-okf", "⊟"], ["focus-pdf", "⊠"]].map(([k, icon]) => (
            <button key={k} onClick={() => setLayout(k)} title={k} style={{
              ...btnStyle("ghost"), padding: "4px 8px",
              color: layout === k ? C.blue : C.muted,
            }}>{icon}</button>
          ))}
        </div>
      </div>

      {/* 3-column grid */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: colW.join(" "), overflow: "hidden", transition: "grid-template-columns .3s" }}>
        <div style={{ display: "flex", flexDirection: "column", borderRight: `1px solid ${C.border}`, overflow: "hidden" }}>
          <div style={{ flex: "0 0 65%", overflow: "hidden" }}>
            <OKFPanel content={okfContent} onChange={setOkfContent} meta={meta} readOnly={readOnly} />
          </div>
          <div style={{ flex: 1, overflow: "hidden" }}>
            <SideFiles indexContent={indexContent} logContent={logContent}
              onIndexChange={setIndexContent} onLogChange={setLogContent} readOnly={readOnly} />
          </div>
        </div>
        <div style={{ borderRight: `1px solid ${C.border}`, overflow: "hidden" }}>
          <PDFPanel meta={meta} />
        </div>
        <div style={{ overflow: "hidden" }}>
          <ChatPanel
            okfContent={okfContent} indexContent={indexContent} logContent={logContent}
            onApplyEdit={handleApplyEdit} readOnly={readOnly} meta={meta}
          />
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: .3; transform: scale(.8); }
          50% { opacity: 1; transform: scale(1); }
        }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #484f58; }
      `}</style>
    </div>
  )} catch (error) {
    console.error('[OKFWorkspace] Render error:', error.message, error.stack);
    return <div style={{color: 'red', padding: '20px'}}>Erreur de rendu: {error.message}</div>;
  }
}
