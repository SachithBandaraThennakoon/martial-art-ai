from pathlib import Path
from PIL import Image, ImageDraw

folder=Path("research/outputs/thesis/20260801/rendered_pdf_final")
out=Path("research/outputs/thesis/20260801/contact_sheets_final")
out.mkdir(parents=True,exist_ok=True)
files=sorted(folder.glob("page-*.png"))
for start in range(0,len(files),4):
    group=files[start:start+4]
    panels=[]
    for f in group:
        im=Image.open(f).convert("RGB")
        im.thumbnail((620,880))
        canvas=Image.new("RGB",(640,920),"white")
        canvas.paste(im,((640-im.width)//2,30))
        ImageDraw.Draw(canvas).text((12,8),f.stem,fill="black")
        panels.append(canvas)
    sheet=Image.new("RGB",(640*len(panels),920),"white")
    for i,panel in enumerate(panels):sheet.paste(panel,(640*i,0))
    sheet.save(out/f"contact-{start//4+1:02d}.jpg",quality=92)
print("sheets",(len(files)+3)//4)
