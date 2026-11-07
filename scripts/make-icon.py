from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
def make(size,filename):
    im=Image.new('RGB',(size,size),'#286447');d=ImageDraw.Draw(im)
    font=ImageFont.truetype('C:/Windows/Fonts/segoeuib.ttf',int(size*.64))
    d.text((size*.28,size*.02),'n',font=font,fill='#f5f7ed')
    d.ellipse((size*.69,size*.24,size*.78,size*.33),fill='#b9cf9e')
    Path(filename).parent.mkdir(parents=True,exist_ok=True);im.save(filename)
make(128,'apps/extension/public/icon.png')
for n in [192,512]:make(n,f'apps/web/public/icons/icon-{n}.png')
make(512,'apps/web/public/icons/maskable-512.png')
make(180,'apps/web/public/icons/apple-180.png')
