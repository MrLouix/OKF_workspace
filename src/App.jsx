import { useEffect, useCallback } from "react";
import { C, RAG_API_URL, SAMPLE_GENERIC_INDEX, SAMPLE_GENERIC_LOG } from "./constants";
import { exportAllAsZIP } from "./utils/bundleStorage";
import { useBundle } from "./hooks/useBundle";
import Header from "./components/Header";
import PDFPanel from "./components/PDFPanel";
import OKFPanel from "./components/OKFPanel";
import ChatPanel from "./components/ChatPanel";
import SideFiles from "./components/SideFiles";
import InitializerModal from "./components/InitializerModal";

// ─── MAIN APP ────────────────────────────────────────────────────────────────
// Thin composition root: all state lives in useBundle(), all presentation
// lives in src/components/*. See docs/spec_okf_workspace_generic.md.
export default function OKFWorkspace() {
  const bundle = useBundle();
  const {
    bundleConfig, okfFiles, activeOKF, pdfFiles, activePDFId, activePDFRef,
    currentPage, indexContent, logContent, layout, readOnly, showInitializer, meta,
    setBundleConfig, setOkfFiles, setPdfFiles, setActiveOKFId, setActivePDFId,
    setCurrentPage, setIndexContent, setLogContent, setLayout, setReadOnly, setShowInitializer,
    setActivePDFById, saveOKFFile, applyEdits, initWithSampleData, saveBundle, loadBundle, addPDF,
  } = bundle;

  // Seed the workspace with the sample bundle on first load so there is
  // something to show out of the box; "New Bundle" in the header still
  // opens InitializerModal to create a fresh one on demand.
  useEffect(() => {
    if (!bundleConfig) {
      initWithSampleData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOKFContentChange = useCallback((newContent) => {
    if (!activeOKF) return;
    saveOKFFile({ ...activeOKF, content: newContent });
  }, [activeOKF, saveOKFFile]);

  const handleExportAllAsZIP = useCallback(() => {
    exportAllAsZIP(bundleConfig, okfFiles, indexContent, logContent);
  }, [bundleConfig, okfFiles, indexContent, logContent]);

  const handleCreateBundle = useCallback(({ bundleConfig: newBundle, okfFiles: newOkfFiles, pdfFiles: newPdfFiles }) => {
    setBundleConfig(newBundle);
    setOkfFiles(newOkfFiles);
    setActiveOKFId(newOkfFiles[0]?.id || null);
    setPdfFiles(newPdfFiles);
    // Leave activePDFId unset — PDFPanel selects the new bundle's first PDF automatically.
    setActivePDFId(null);
    setIndexContent(SAMPLE_GENERIC_INDEX);
    setLogContent(SAMPLE_GENERIC_LOG);
    setShowInitializer(false);
  }, [setBundleConfig, setOkfFiles, setActiveOKFId, setPdfFiles, setActivePDFId, setIndexContent, setLogContent, setShowInitializer]);

  const colW = {
    "3col":      ["1fr", "1fr", "1fr"],
    "focus-okf": ["2fr", "1.5fr", "0.5fr"],
    "focus-pdf": ["0.5fr", "2fr", "1fr"],
  }[layout];

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100vh", background: C.bg, color: C.text, fontFamily: "system-ui" }}>
      <Header
        meta={meta}
        bundleConfig={bundleConfig}
        setShowInitializer={setShowInitializer}
        readOnly={readOnly}
        setReadOnly={setReadOnly}
        setLayout={setLayout}
        layout={layout}
        RAG_API_URL={RAG_API_URL}
        onSaveBundle={saveBundle}
        onLoadBundle={loadBundle}
      />

      {/* 3-column grid */}
      <div data-testid="layout-grid" style={{ flex: 1, display: "grid", width: "100%", gridTemplateColumns: colW.join(" "), overflow: "hidden", transition: "grid-template-columns .3s" }}>
        <div style={{ display: "flex", flexDirection: "column", width: "100%", borderRight: `1px solid ${C.border}`, overflow: "hidden" }}>
          <div style={{ flex: "0 0 65%", width: "100%", overflow: "hidden" }}>
            <OKFPanel
              content={activeOKF?.content}
              onChange={handleOKFContentChange}
              meta={meta}
              readOnly={readOnly}
              activeOKF={activeOKF}
              bundleConfig={bundleConfig}
            />
          </div>
          <div style={{ flex: 1, width: "100%", overflow: "hidden" }}>
            <SideFiles
              indexContent={indexContent}
              logContent={logContent}
              okfContent={activeOKF?.content || ''}
              meta={meta}
              bundleConfig={bundleConfig}
              onIndexChange={setIndexContent}
              onLogChange={setLogContent}
              onOKFChange={handleOKFContentChange}
              onExportZIP={handleExportAllAsZIP}
              readOnly={readOnly}
            />
          </div>
        </div>

        <div style={{ width: "100%", borderRight: `1px solid ${C.border}`, overflow: "hidden" }}>
          <PDFPanel
            bundleConfig={bundleConfig}
            pdfFiles={pdfFiles}
            activePDFId={activePDFId}
            setActivePDFById={setActivePDFById}
            currentPage={currentPage}
            setCurrentPage={setCurrentPage}
            activePDFRef={activePDFRef}
            meta={meta}
            addPDF={addPDF}
          />
        </div>

        <div style={{ width: "100%", overflow: "hidden" }}>
          {/* ChatPanel renders its own ChunksDrawer and drives RAG retrieval internally */}
          <ChatPanel
            okfContent={activeOKF?.content || ""}
            indexContent={indexContent}
            logContent={logContent}
            onApplyEdit={applyEdits}
            readOnly={readOnly}
            meta={meta}
            bundleConfig={bundleConfig}
            activeOKF={activeOKF}
          />
        </div>
      </div>

      <InitializerModal
        isOpen={showInitializer}
        onClose={() => setShowInitializer(false)}
        onCreate={handleCreateBundle}
      />

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: .3; transform: scale(.8); }
          50% { opacity: 1; transform: scale(1); }
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; width: 100%; height: 100%; }
        #root { width: 100%; height: 100%; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #484f58; }
      `}</style>
    </div>
  );
}
