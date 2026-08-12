import bpy
import json
import sys
from pathlib import Path


def arguments():
    values = sys.argv[sys.argv.index("--") + 1 :]
    return Path(values[0]), Path(values[1]), Path(values[2])


source, destination, report_path = arguments()
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=str(source), automatic_bone_orientation=False)

objects = list(bpy.context.scene.objects)
armatures = [item for item in objects if item.type == "ARMATURE"]
meshes = [item for item in objects if item.type == "MESH"]
bones = [bone.name for armature in armatures for bone in armature.data.bones]
lower_names = {name.lower(): name for name in bones}

finger_terms = ("thumb", "index", "middle", "ring", "pinky", "little")
finger_bones = [name for name in bones if any(term in name.lower() for term in finger_terms)]

# Remove imported lights/cameras/helpers; retain the complete skinned character.
for item in objects:
    item.select_set(item.type in {"MESH", "ARMATURE", "EMPTY"})

destination.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=str(destination),
    export_format="GLB",
    use_selection=True,
    export_apply=False,
    export_animations=False,
    export_skins=True,
    export_morph=True,
    export_materials="EXPORT",
    export_yup=True,
)

report = {
    "source": str(source),
    "output": str(destination),
    "armature_count": len(armatures),
    "mesh_count": len(meshes),
    "bone_count": len(bones),
    "finger_bone_count": len(finger_bones),
    "armatures": [item.name for item in armatures],
    "meshes": [item.name for item in meshes],
    "finger_bones": finger_bones,
    "all_bones": bones,
}
report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({key: report[key] for key in (
    "armature_count", "mesh_count", "bone_count", "finger_bone_count"
)}, indent=2))
