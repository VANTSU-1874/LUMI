# Design QA

- Source visual truth: `C:\Users\18437\AppData\Local\Temp\teaching-canvas-pan-zoom.png`
- Supporting source states: `C:\Users\18437\AppData\Local\Temp\all-cases-node-workspace-desktop.png`, `C:\Users\18437\AppData\Local\Temp\interactive-case-lab-desktop.png`
- Implementation route: `/student` → `节点画布`
- Intended viewport: desktop 1440 × 900; responsive reflow below 1280 px
- State: sound-driven visual plan with suggested nodes, completed demo network, selected-node inspector, live preview
- Implementation screenshot: unavailable in this run because the selected in-app browser is blocked by the environment network policy for both the quick-tunnel URL and loopback URL.

## Full-view comparison evidence

Blocked. The source captures were opened and inspected, but a same-viewport implementation capture could not be produced through the selected browser. Build success, unit tests, API tests, and HTTP health are not substitutes for visual comparison.

## Focused region comparison evidence

Blocked for the same reason. The intended focused regions are:

1. Seven-family node palette and search.
2. React Flow canvas with suggested/placed node states and parameter-export edge.
3. Context-aware Agent panel and selected-node explanation.
4. Browser-native audio-reactive preview and fidelity labels.

## Findings

- [P1] Rendered desktop composition has not been visually verified.
  - Impact: three-column density, canvas width, and right-panel scroll behavior may need adjustment after the user opens the preview.
  - Fix: capture the implementation at 1440 × 900 in the selected browser and compare it with the source design.
- [P1] Primary drag/connect/microphone interactions have not been exercised in a live browser in this run.
  - Impact: interaction behavior is covered by implementation and automated non-browser checks, but pointer geometry and microphone permission UX still need live confirmation.
  - Fix: manually test palette drag, same-family wire, CHOP parameter Export, node deletion, save/restore, simulated audio, and microphone fallback.

## Required fidelity surfaces

- Fonts and typography: implemented with the existing project font stack and hierarchy; rendered fidelity not verified.
- Spacing and layout rhythm: reuses existing dark-green course workspace tokens; rendered fidelity not verified.
- Colors and visual tokens: reuses the current mint, amber, ink, and family-specific node colors; rendered fidelity not verified.
- Image quality and asset fidelity: no new image assets were invented; the live preview is a labeled browser runtime rather than a claimed TouchDesigner render.
- Copy and content: the UI explicitly separates Agent suggestions, student-owned nodes, browser-runnable nodes, structure-only nodes, ordinary wires, and cross-family parameter Export.

## Comparison history

- Initial architecture audit found that the case library and node canvas had overlapping read-only responsibilities and that generic simulated effects were presented without a reliable node-to-output relationship.
- The implementation replaces the old node-canvas entry with a general authoring workspace and retains the case library as a read-only version/structure surface.
- Post-fix visual evidence is still blocked pending a browser screenshot.

## Case-library annotation pass

- The read-only case canvas now preserves author-created `.toe` annotation regions as solid `原工程注释` frames.
- Nodes that are not covered by the source annotations are grouped from their operator role and original network position into dashed `教学分组 · 系统整理` frames.
- Generated copy explains the branch as input/material, interaction/control, core processing, 3D/rendering, or result/output and lists representative Chinese operator names.
- A visible source legend and an on/off control prevent generated teaching notes from being mistaken for the original author's notes or permanently cluttering the graph.
- Automated component coverage verifies source labels, generated explanations, and the visibility control; rendered comparison remains blocked by the browser policy noted above.
- After review exposed annotation collisions, the case canvas changed from per-column compression to a global two-dimensional grid that preserves the source `.toe` vertical bands. Horizontal and vertical gutters now reserve space for the full annotation card instead of only the node itself.

final result: blocked
