from pathlib import Path

from docx import Document
from docx.oxml.ns import qn


DOCX = Path(__file__).with_name("Combat_Cognition_Thesis_I.T.M.S.S.B.Thennakoon.docx")

DECLARATION_OLD = (
    "Candidate:I.T.M.S.S.B.Thennakoon\n"
    "Registrationnumber:DTS2401\n"
    "Signature:______________________________\n"
    "Date: ______________________________"
)
DECLARATION_NEW = (
    "Candidate: I.T.M.S.S.B. Thennakoon\n"
    "Registration number: DTS2401\n"
    "Signature: ______________________________\n"
    "Date: ______________________________"
)

A4_START = "The publication-ready supplementary appendix contains"
A4_NEW = (
    "The publication-ready supplementary appendix contains 51 distinct, "
    "account-name-masked screenshots retained after review of all 78 supplied "
    "images. They document visible controls, state transitions and diagnostic "
    "outputs in the P001 jab-only laptop-camera case. They are observational "
    "implementation evidence, not independent measurements of accuracy, "
    "effectiveness, causal reasoning or human-equivalent cognition. To avoid "
    "duplicating the same screenshots inside the report, the curated images are "
    "provided through the repository link below."
)

ALT_TEXT = [
    "Combat Cognition architecture and evidence flow, showing implemented perception, L1-L4 context, situation-awareness gates, deterministic coaching and the planned non-operational LLM boundary.",
    "Line chart comparing normalized ACP-STGAT, last-pose and constant-velocity prediction error across the 30-frame forecast horizon.",
    "Confusion matrix for the generated-bootstrap temporal phase-classifier evaluation, with generator-defined phase classes.",
    "Practice-42 post-session timeline showing three completed jab repetition clusters and selected movement phases.",
]


document = Document(DOCX)

for paragraph in document.paragraphs:
    if paragraph.text == DECLARATION_OLD:
        paragraph.text = DECLARATION_NEW
    elif paragraph.text.startswith(A4_START):
        paragraph.text = A4_NEW

for hyperlink in document._element.xpath(".//w:hyperlink"):
    text_nodes = hyperlink.xpath(".//w:t")
    if not text_nodes:
        continue
    current = "".join(node.text or "" for node in text_nodes)
    if "/research/Appendix/A" not in current:
        continue
    appendix_id = current.split("/research/Appendix/", 1)[1].split("-", 1)[0]
    text_nodes[0].text = f"Open Appendix {appendix_id} evidence folder on GitHub"
    for node in text_nodes[1:]:
        node.text = ""

doc_properties = document._element.xpath(".//wp:docPr")
if len(doc_properties) != len(ALT_TEXT):
    raise RuntimeError(f"Expected {len(ALT_TEXT)} figures, found {len(doc_properties)}")
for properties, description in zip(doc_properties, ALT_TEXT):
    properties.set("descr", description)
    properties.set("title", description.split(",", 1)[0])

document.save(DOCX)
print(DOCX)
