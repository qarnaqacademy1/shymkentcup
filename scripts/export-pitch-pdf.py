"""Portable PDF of slide renders; editable source is docs/pitch-deck.pptx.

Uses ReportLab because the bundled Artifact Tool PDF export lacks its Helvetica
module in this Windows runtime. Do not misrepresent the PDF as editable text.
"""
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
root=Path(__file__).resolve().parents[1]
output=root/'docs/pitch-deck-v3.1.pdf'
c=canvas.Canvas(str(output),pagesize=(960,540))
c.setTitle('Nazar / Назар — внимание по твоим правилам')
for i in range(1,13):
    c.drawImage(ImageReader(str(root/f'artifacts/pitch-v31/slide-{i}.png')),0,0,960,540)
    c.showPage()
c.save()
print(output)

