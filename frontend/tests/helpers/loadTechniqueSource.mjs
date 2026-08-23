import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function loadTechniqueTrainingConfig(techniqueRoot, techniqueId) {
  const directory = path.join(techniqueRoot, techniqueId);
  let trainingSteps;
  try {
    trainingSteps = await readJson(path.join(directory, "training-steps.json"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const snapshotRoot = path.join(
      path.dirname(techniqueRoot),
      "system-catalog",
      "techniques"
    );
    const filenames = await readdir(snapshotRoot);
    const suffix = `--${techniqueId}.json`;
    const filename = filenames.find((name) => name === `${techniqueId}.json` || name.endsWith(suffix));
    if (!filename) throw error;
    const snapshot = await readJson(path.join(snapshotRoot, filename));
    trainingSteps = snapshot.training_config;
  }
  return trainingSteps;
}

export async function loadTechniqueSource(techniqueRoot, techniqueId) {
  const trainingSteps = await loadTechniqueTrainingConfig(techniqueRoot, techniqueId);
  if (trainingSteps.temporal_runtime) {
    return trainingSteps.temporal_runtime;
  }
  const directory = path.join(techniqueRoot, techniqueId);
  const names = ["manifest", "states", "transitions", "errors", "modes"];
  return Object.fromEntries(
    await Promise.all(
      names.map(async (name) => [
        name,
        await readJson(path.join(directory, `${name}.json`))
      ])
    )
  );
}
