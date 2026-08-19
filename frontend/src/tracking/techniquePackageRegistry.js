const packages = [];

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
