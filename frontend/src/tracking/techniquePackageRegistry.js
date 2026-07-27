import { listTechniqueDataPackages } from "../data/techniqueDataRegistry.js";
import { createTechniquePackage } from "./techniquePackage.js";

const packages = listTechniqueDataPackages()
  .filter((dataPackage) => dataPackage.trackingSource)
  .map((dataPackage) => {
    const techniquePackage = createTechniquePackage(dataPackage.trackingSource);
    if (techniquePackage.id !== dataPackage.index.id) {
      throw new Error(
        `Tracking package "${techniquePackage.id}" does not match index id "${dataPackage.index.id}"`
      );
    }
    if (
      dataPackage.index.tracking_version &&
      techniquePackage.version !== dataPackage.index.tracking_version
    ) {
      throw new Error(
        `Tracking package "${techniquePackage.id}" version does not match the index`
      );
    }
    return techniquePackage;
  });

const registry = new Map(packages.map((techniquePackage) => [
  techniquePackage.id,
  techniquePackage
]));

export function getTrackingTechniquePackage(techniqueId) {
  return registry.get(String(techniqueId || "").trim().toLowerCase()) || null;
}

export function hasTrackingTechniquePackage(techniqueId) {
  return registry.has(String(techniqueId || "").trim().toLowerCase());
}

export function listTrackingTechniquePackages() {
  return packages.map((techniquePackage) => ({
    id: techniquePackage.id,
    version: techniquePackage.version,
    displayName: techniquePackage.manifest.display_name,
    trackingProfile: techniquePackage.manifest.tracking_profile
  }));
}
