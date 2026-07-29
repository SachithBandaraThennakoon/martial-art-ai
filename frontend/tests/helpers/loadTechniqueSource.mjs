import { readFile } from "node:fs/promises";
import path from "node:path";

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function loadTechniqueSource(techniqueRoot, techniqueId) {
  const directory = path.join(techniqueRoot, techniqueId);
  const trainingSteps = await readJson(
    path.join(directory, "training-steps.json")
  );
  if (trainingSteps.temporal_runtime) {
    return trainingSteps.temporal_runtime;
  }
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
