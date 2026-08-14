import techniqueIndex from "../../../backend/data/techniques/index.json";

// Keep required package files as explicit Vite dependencies. A broad glob can
// retain a stale file list during HMR when a technique is migrated by deleting
// and recreating training-steps.json.
const requiredTechniqueFiles = {
  ...import.meta.glob(
    "../../../backend/data/techniques/*/catalog.json",
    { eager: true, import: "default" }
  ),
  ...import.meta.glob(
    "../../../backend/data/techniques/*/training-steps.json",
    { eager: true, import: "default" }
  )
};

const optionalTechniqueFiles = import.meta.glob(
  [
    "../../../backend/data/techniques/*/learning-content.json",
    "../../../backend/data/techniques/*/manifest.json",
    "../../../backend/data/techniques/*/states.json",
    "../../../backend/data/techniques/*/transitions.json",
    "../../../backend/data/techniques/*/errors.json",
    "../../../backend/data/techniques/*/modes.json"
  ],
  { eager: true, import: "default" }
);

const techniqueFiles = {
  ...optionalTechniqueFiles,
  ...requiredTechniqueFiles
};

const filesByTechnique = new Map();

Object.entries(techniqueFiles).forEach(([filePath, payload]) => {
  const match = filePath
    .replace(/\\/g, "/")
    .match(/\/data\/techniques\/([^/]+)\/([^/]+)\.json$/);
  if (!match) return;

  const [, techniqueId, fileName] = match;
  const files = filesByTechnique.get(techniqueId) || {};
  files[fileName] = payload;
  filesByTechnique.set(techniqueId, files);
});

function buildDataPackage(indexEntry) {
  const files = filesByTechnique.get(indexEntry.id);
  if (!files?.catalog || !files?.["training-steps"]) {
    throw new Error(
      `Technique package "${indexEntry.id}" requires catalog.json and training-steps.json`
    );
  }
  if (files.catalog.id !== indexEntry.id) {
    throw new Error(
      `Technique index id "${indexEntry.id}" does not match catalog id "${files.catalog.id}"`
    );
  }
  if (files["training-steps"].technique_id !== indexEntry.id) {
    throw new Error(
      `Technique "${indexEntry.id}" has a mismatched training-steps technique_id`
    );
  }

  const trackingFileNames = [
    "manifest",
    "states",
    "transitions",
    "errors",
    "modes"
  ];
  const trackingFileCount = trackingFileNames.filter((name) => files[name]).length;
  const embeddedTracking = files["training-steps"].temporal_runtime || null;
  if (trackingFileCount > 0 && trackingFileCount < trackingFileNames.length) {
    throw new Error(
      `Technique "${indexEntry.id}" has an incomplete temporal tracking package`
    );
  }

  return {
    index: indexEntry,
    catalog: files.catalog,
    trainingSteps: files["training-steps"],
    trackingSource:
      embeddedTracking ||
      (
        trackingFileCount === trackingFileNames.length
          ? Object.fromEntries(trackingFileNames.map((name) => [name, files[name]]))
          : null
      )
  };
}

const dataPackages = techniqueIndex.techniques
  .filter((entry) => entry.enabled !== false)
  .map(buildDataPackage);

const dataPackageRegistry = new Map(
  dataPackages.map((dataPackage) => [dataPackage.index.id, dataPackage])
);

export function getTechniqueDataPackage(techniqueId) {
  return dataPackageRegistry.get(String(techniqueId || "").trim().toLowerCase()) || null;
}

export function listTechniqueDataPackages() {
  return [...dataPackages];
}
