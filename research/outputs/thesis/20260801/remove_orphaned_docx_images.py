from pathlib import Path, PurePosixPath
from tempfile import NamedTemporaryFile
from zipfile import ZIP_DEFLATED, ZipFile
import xml.etree.ElementTree as ET


DOCX = Path(__file__).with_name("Combat_Cognition_Thesis_I.T.M.S.S.B.Thennakoon.docx")
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
IMAGE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
DOC_RELS = "word/_rels/document.xml.rels"
DOC_XML = "word/document.xml"


with ZipFile(DOCX, "r") as source:
    payloads = {name: source.read(name) for name in source.namelist()}

document_xml = payloads[DOC_XML]
relationships = ET.fromstring(payloads[DOC_RELS])
removed_targets = set()

for relationship in list(relationships):
    if relationship.get("Type") != IMAGE_REL:
        continue
    relationship_id = relationship.get("Id")
    if relationship_id.encode("utf-8") not in document_xml:
        target = relationship.get("Target")
        if target:
            removed_targets.add(str(PurePosixPath("word") / target))
        relationships.remove(relationship)

payloads[DOC_RELS] = ET.tostring(relationships, encoding="utf-8", xml_declaration=True)

# Preserve an image if another relationship part still references its filename.
all_other_relationships = b"\n".join(
    data for name, data in payloads.items()
    if name.endswith(".rels") and name != DOC_RELS
)
for target in list(removed_targets):
    filename = PurePosixPath(target).name.encode("utf-8")
    if filename not in all_other_relationships:
        payloads.pop(target, None)

with NamedTemporaryFile(delete=False, suffix=".docx", dir=DOCX.parent) as temporary:
    temporary_path = Path(temporary.name)

with ZipFile(temporary_path, "w", ZIP_DEFLATED) as destination:
    for name, data in payloads.items():
        destination.writestr(name, data)

temporary_path.replace(DOCX)
print(f"Removed {len(removed_targets)} orphaned image relationships from {DOCX}")
