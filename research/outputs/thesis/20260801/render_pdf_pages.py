from pathlib import Path
import pypdfium2 as pdfium

pdf_path=Path("research/outputs/thesis/20260801/Combat_Cognition_Thesis_I.T.M.S.S.B.Thennakoon.pdf")
out=Path("research/outputs/thesis/20260801/rendered_pdf_final")
out.mkdir(parents=True,exist_ok=True)
doc=pdfium.PdfDocument(str(pdf_path))
for i,page in enumerate(doc):
    page.render(scale=1.25).to_pil().save(out/f"page-{i+1:03d}.png")
print("pages",len(doc))
