export type TouchDesignerFamily = "TOP" | "CHOP" | "SOP" | "COMP" | "MAT" | "DAT" | "POP" | "OTHER";

export type TouchDesignerParameter = {
  name: string;
  value: string;
};

export type TouchDesignerNodeSnapshot = {
  id: string;
  path: string;
  name: string;
  family: TouchDesignerFamily;
  operatorType: string;
  networkPath: string;
  x: number;
  y: number;
  width: number;
  height: number;
  inputs: string[];
  parameters: TouchDesignerParameter[];
  parameterCount: number;
  signature?: string;
  annotation: { title: string; body: string } | null;
};

export type TouchDesignerEdgeSnapshot = {
  id: string;
  source: string;
  target: string;
  inputIndex: number;
  networkPath: string;
};

export type TouchDesignerNetworkSnapshot = {
  path: string;
  label: string;
  nodeIds: string[];
  edgeIds: string[];
  annotationCount: number;
};

export type TouchDesignerStructure = {
  id: string;
  nodeCount: number;
  edgeCount: number;
  familyCounts: Partial<Record<TouchDesignerFamily, number>>;
  nodes: TouchDesignerNodeSnapshot[];
  edges: TouchDesignerEdgeSnapshot[];
  networks: TouchDesignerNetworkSnapshot[];
};

export type TouchDesignerVersionDiff = {
  added: number;
  removed: number;
  changed: number;
  addedNodes: string[];
  removedNodes: string[];
  changedNodes: string[];
};

export type TouchDesignerVersionKind = "PRIMARY" | "STAGE" | "BACKUP";

export type TouchDesignerCaseVersion = {
  id: string;
  label: string;
  fileLabel: string;
  kind: TouchDesignerVersionKind;
  origin: "FILE" | "ARCHIVE";
  relativePath: string;
  modifiedAt: string;
  sizeBytes: number;
  structureId: string | null;
  status: "PARSED" | "UNREADABLE";
  issue: string | null;
  duplicateOfVersionId: string | null;
  diffFromPrevious: TouchDesignerVersionDiff | null;
};

export type TouchDesignerCase = {
  id: string;
  moduleId: string;
  title: string;
  relativeFolder: string;
  activeVersionId: string;
  versions: TouchDesignerCaseVersion[];
};

export type TouchDesignerModule = {
  id: string;
  sequence: number;
  title: string;
  cases: TouchDesignerCase[];
};

export type TouchDesignerCaseLibrary = {
  schemaVersion: 1;
  generatedAt: string;
  sourceLabel: string;
  totals: {
    modules: number;
    cases: number;
    versions: number;
    parsedVersions: number;
    backupVersions: number;
    duplicateVersions: number;
    structures: number;
  };
  modules: TouchDesignerModule[];
  issues: Array<{ relativePath: string; message: string }>;
};

export const EMPTY_VERSION_DIFF: TouchDesignerVersionDiff = {
  added: 0,
  removed: 0,
  changed: 0,
  addedNodes: [],
  removedNodes: [],
  changedNodes: [],
};
