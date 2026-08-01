from __future__ import annotations

import html
import io
from pathlib import Path

from docx import Document
from docx.document import Document as _Document
from docx.oxml.table import CT_Tbl
from docx.oxml.text.paragraph import CT_P
from docx.table import Table, _Cell
from docx.text.paragraph import Paragraph
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    Image,
    PageBreak,
    PageTemplate,
    Paragraph as RLParagraph,
    Spacer,
    Table as RLTable,
    TableStyle,
)
from reportlab.pdfgen import canvas
from PIL import Image as PILImage


ROOT = Path(__file__).resolve().parents[4]
INPUT = ROOT / "research/outputs/thesis/20260801/Combat_Cognition_Thesis_I.T.M.S.S.B.Thennakoon.docx"
OUTPUT = ROOT / "research/outputs/thesis/20260801/Combat_Cognition_Thesis_I.T.M.S.S.B.Thennakoon.pdf"


def roman(n: int) -> str:
    vals = [(1000,"m"),(900,"cm"),(500,"d"),(400,"cd"),(100,"c"),(90,"xc"),(50,"l"),(40,"xl"),(10,"x"),(9,"ix"),(5,"v"),(4,"iv"),(1,"i")]
    out=[]
    for value,symbol in vals:
        while n>=value:
            out.append(symbol); n-=value
    return "".join(out)


class NumberedCanvas(canvas.Canvas):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,**kwargs)
        self._states=[]
        self.main_start=None

    def showPage(self):
        self._states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total=len(self._states)
        main_start=self.main_start
        for state in self._states:
            self.__dict__.update(state)
            page=self._pageNumber
            if page>1:
                label=str(page-main_start+1) if main_start and page>=main_start else roman(page)
                self.setFont("Times-Roman",9)
                self.drawCentredString(A4[0]/2,12*mm,label)
            super().showPage()
        super().save()


class MainStart(Flowable):
    def wrap(self,*args): return (0,0)
    def draw(self):
        self.canv.main_start=self.canv.getPageNumber()


class ThesisDocTemplate(BaseDocTemplate):
    def __init__(self,filename,**kwargs):
        super().__init__(filename,**kwargs)
        frame=Frame(40*mm,25*mm,A4[0]-55*mm,A4[1]-50*mm,id="normal",leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0)
        self.addPageTemplates(PageTemplate(id="thesis",frames=[frame]))
        self._bookmark=0

    def afterFlowable(self,flowable):
        if isinstance(flowable,RLParagraph) and getattr(flowable,"toc_level",None) is not None:
            level=flowable.toc_level
            text=flowable.getPlainText().replace("\n"," ")
            self._bookmark+=1
            key=f"h{self._bookmark}"
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(text,key,level=level,closed=False)
            self.notify("TOCEntry",(level,text,self.page,key))


styles=getSampleStyleSheet()
body=ParagraphStyle("ThesisBody",fontName="Times-Roman",fontSize=12,leading=18,alignment=TA_JUSTIFY,firstLineIndent=7.5*mm,spaceAfter=6)
center=ParagraphStyle("Center",parent=body,alignment=TA_CENTER,firstLineIndent=0)
h1=ParagraphStyle("H1",fontName="Times-Bold",fontSize=14,leading=18,alignment=TA_CENTER,spaceBefore=0,spaceAfter=18,keepWithNext=True)
h2=ParagraphStyle("H2",fontName="Times-Bold",fontSize=12,leading=18,alignment=TA_LEFT,spaceBefore=10,spaceAfter=6,keepWithNext=True)
h3=ParagraphStyle("H3",fontName="Times-BoldItalic",fontSize=12,leading=18,alignment=TA_LEFT,spaceBefore=6,spaceAfter=6,keepWithNext=True)
caption=ParagraphStyle("Caption",fontName="Times-Italic",fontSize=10,leading=13,alignment=TA_CENTER,spaceBefore=3,spaceAfter=8)
small=ParagraphStyle("Small",fontName="Times-Roman",fontSize=9,leading=11,spaceAfter=0)
ref_style=ParagraphStyle("Ref",fontName="Times-Roman",fontSize=10,leading=12,leftIndent=7.5*mm,firstLineIndent=-7.5*mm,spaceAfter=6)
bullet=ParagraphStyle("Bullet",fontName="Times-Roman",fontSize=12,leading=18,leftIndent=12.5*mm,firstLineIndent=-6*mm,bulletIndent=6*mm,spaceAfter=3)


def iter_blocks(parent):
    if isinstance(parent,_Document): parent_elm=parent.element.body
    elif isinstance(parent,_Cell): parent_elm=parent._tc
    else: raise ValueError
    for child in parent_elm.iterchildren():
        if isinstance(child,CT_P): yield Paragraph(child,parent)
        elif isinstance(child,CT_Tbl): yield Table(child,parent)


def p_has_page_break(p):
    return bool(p._p.xpath('.//w:br[@w:type="page"]')) or bool(p._p.xpath('./w:pPr/w:sectPr'))


def rich_text(p):
    chunks=[]
    for run in p.runs:
        text=html.escape(run.text).replace("\n","<br/>")
        if not text: continue
        if run.bold: text=f"<b>{text}</b>"
        if run.italic: text=f"<i>{text}</i>"
        chunks.append(text)
    return "".join(chunks) or html.escape(p.text)


def paragraph_images(doc,p):
    images=[]
    for blip in p._p.xpath('.//a:blip'):
        rid=blip.get(qn('r:embed'))
        if rid and rid in doc.part.rels:
            blob=doc.part.rels[rid].target_part.blob
            images.append(blob)
    return images


from docx.oxml.ns import qn


docx=Document(INPUT)
story=[]
toc_inserted=False
main_marked=False
for block in iter_blocks(docx):
    if isinstance(block,Paragraph):
        text=block.text.strip()
        if p_has_page_break(block):
            story.append(PageBreak())
        imgs=paragraph_images(docx,block)
        for blob in imgs:
            pil=PILImage.open(io.BytesIO(blob))
            w,h=pil.size
            maxw=154*mm; maxh=180*mm
            scale=min(maxw/w,maxh/h)
            story.append(Image(io.BytesIO(blob),width=w*scale,height=h*scale))
        if not text:
            if imgs: story.append(Spacer(1,3*mm))
            continue
        style_name=block.style.name if block.style else "Normal"
        upper=text.upper()
        if upper=="TABLE OF CONTENTS":
            para=RLParagraph(upper,h1); para.toc_level=None; story.append(para); toc_inserted=True; continue
        if "Update table of contents" in text: continue
        if "\t" in text:
            label,page=text.rsplit("\t",1)
            idx=RLTable([[RLParagraph(html.escape(label),ParagraphStyle("IndexLine",fontName="Times-Roman",fontSize=11,leading=14)),RLParagraph(html.escape(page),ParagraphStyle("IndexPage",fontName="Times-Roman",fontSize=11,leading=14,alignment=TA_CENTER))]],colWidths=[140*mm,14*mm],hAlign="LEFT")
            idx.setStyle(TableStyle([("VALIGN",(0,0),(-1,-1),"TOP"),("BOTTOMPADDING",(0,0),(-1,-1),4)]))
            story.append(idx)
            continue
        if style_name=="Heading 1":
            if text.startswith("CHAPTER 1") and not main_marked:
                story.append(MainStart()); main_marked=True
            para=RLParagraph(rich_text(block),h1); para.toc_level=0; story.append(para)
        elif style_name=="Heading 2":
            para=RLParagraph(rich_text(block),h2); para.toc_level=1; story.append(para)
        elif style_name=="Heading 3":
            para=RLParagraph(rich_text(block),h3); para.toc_level=2; story.append(para)
        elif style_name=="Caption": story.append(RLParagraph(rich_text(block),caption))
        elif style_name.startswith("List Bullet"):
            story.append(RLParagraph(rich_text(block),bullet,bulletText="•"))
        elif style_name.startswith("List Number"):
            story.append(RLParagraph(rich_text(block),bullet,bulletText="-"))
        else:
            is_center=block.alignment==1
            sty=center if is_center else (ref_style if len(text)>80 and (text.startswith(tuple("ABCDEFGHIJKLMNOPQRSTUVWXYZ")) and "(" in text[:50] and style_name=="Normal" and block.paragraph_format.left_indent) else body)
            story.append(RLParagraph(rich_text(block),sty))
    else:
        data=[]
        for row in block.rows:
            data.append([RLParagraph(html.escape(cell.text).replace("\n","<br/>"),small) for cell in row.cells])
        if not data: continue
        cols=len(data[0]); total=154*mm
        widths=[total/cols]*cols
        t=RLTable(data,colWidths=widths,repeatRows=1,hAlign="LEFT")
        t.setStyle(TableStyle([
            ("GRID",(0,0),(-1,-1),0.4,colors.HexColor("#8A8A8A")),
            ("BACKGROUND",(0,0),(-1,0),colors.HexColor("#D9E2F3")),
            ("FONTNAME",(0,0),(-1,0),"Times-Bold"),
            ("VALIGN",(0,0),(-1,-1),"MIDDLE"),
            ("LEFTPADDING",(0,0),(-1,-1),4),("RIGHTPADDING",(0,0),(-1,-1),4),("TOPPADDING",(0,0),(-1,-1),4),("BOTTOMPADDING",(0,0),(-1,-1),4),
        ])); story.append(t); story.append(Spacer(1,4*mm))

pdf=ThesisDocTemplate(str(OUTPUT),pagesize=A4,leftMargin=40*mm,rightMargin=15*mm,topMargin=25*mm,bottomMargin=25*mm,title="Combat Cognition Thesis",author="I.T.M.S.S.B. Thennakoon")
pdf.build(story,canvasmaker=NumberedCanvas)
print(OUTPUT)
