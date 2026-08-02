from pathlib import Path

from docx import Document
from docx.oxml.ns import qn


DOCX = Path(__file__).with_name("Combat_Cognition_Thesis_I.T.M.S.S.B.Thennakoon.docx")

OLD_HEADINGS = [
    "Appendix A4: Software Verification",
    "Appendix A5: P001 Protocol and Curated Evidence",
    "Appendix A6: Database Export and Failure Evidence",
    "Appendix A7: Literature and Claim Audit",
    "Appendix A8: Evaluation Actions and Evidence Locks",
    "Appendix A9: System Interface and Functional Evidence",
]

NEW_SPEC = [
    (5, "Appendix A4: System Interface and Functional Evidence", "A9-System-Interface-and-Functional-Evidence", "A4-System-Interface-and-Functional-Evidence"),
    (1, "Appendix A5: P001 Protocol and Curated Evidence", "A5-P001-Protocol-and-Curated-Evidence", "A5-P001-Protocol-and-Curated-Evidence"),
    (0, "Appendix A6: Software Verification", "A4-Software-Verification", "A6-Software-Verification"),
    (2, "Appendix A7: Database Export and Failure Evidence", "A6-Database-Export-and-Failure-Evidence", "A7-Database-Export-and-Failure-Evidence"),
    (3, "Appendix A8: Literature and Claim Audit", "A7-Literature-and-Claim-Audit", "A8-Literature-and-Claim-Audit"),
    (4, "Appendix A9: Evaluation Actions and Evidence Locks", "A8-Evaluation-Actions-and-Evidence-Locks", "A9-Evaluation-Actions-and-Evidence-Locks"),
]


def element_text(element):
    return "".join(element.xpath(".//w:t/text()"))


def replace_in_element(element, old, new):
    for text_node in element.xpath(".//w:t"):
        if text_node.text:
            text_node.text = text_node.text.replace(old, new)


document = Document(DOCX)
body = document._element.body
children = list(body)
starts = []
for heading in OLD_HEADINGS:
    starts.append(next(i for i, child in enumerate(children) if element_text(child).strip() == heading))

blocks = []
for position, start in enumerate(starts):
    end = starts[position + 1] if position + 1 < len(starts) else next(
        (i for i in range(start + 1, len(children)) if children[i].tag == qn("w:sectPr")),
        len(children),
    )
    blocks.append(children[start:end])

for block in blocks:
    for element in block:
        body.remove(element)

section_properties = body.find(qn("w:sectPr"))
for old_index, new_heading, old_folder, new_folder in NEW_SPEC:
    block = blocks[old_index]
    old_heading = OLD_HEADINGS[old_index]
    old_id = old_heading.split(":", 1)[0].replace("Appendix ", "")
    new_id = new_heading.split(":", 1)[0].replace("Appendix ", "")
    for element in block:
        replace_in_element(element, old_heading, new_heading)
        replace_in_element(element, f"Supplementary evidence ({old_id})", f"Supplementary evidence ({new_id})")
        replace_in_element(element, old_folder, new_folder)
        if section_properties is None:
            body.append(element)
        else:
            section_properties.addprevious(element)

# Update the Chapter 4 prose reference outside the moved appendix blocks.
for element in body:
    if "Representative anonymized frames are preserved in Appendix A9" in element_text(element):
        replace_in_element(element, "Appendix A9", "Appendix A4")

# Update external hyperlink relationship targets.
folder_map = {old: new for _, _, old, new in NEW_SPEC}
for relationship in document.part.rels.values():
    if not relationship.reltype.endswith("/hyperlink"):
        continue
    target = relationship.target_ref
    for old_folder, new_folder in folder_map.items():
        target = target.replace(old_folder, new_folder)
    relationship._target = target

document.save(DOCX)
print(DOCX)
