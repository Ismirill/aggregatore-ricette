# Foglio di confronto per immagini larghe: due per riga, con l'etichetta dello stile
import os,sys,glob
from PIL import Image,ImageDraw,ImageFont
D=os.path.dirname(os.path.abspath(__file__))+'/gen';pre=sys.argv[1];out=sys.argv[2]
W1=720;PAD=20;LBL=34
fs=sorted(glob.glob(f'{D}/{pre}-*.png'))
ims=[]
for f in fs:
    im=Image.open(f).convert('RGB');r=W1/im.width;ims.append((os.path.basename(f)[len(pre)+1:-4],im.resize((W1,int(im.height*r)))))
cols=2;rows=(len(ims)+1)//2;H1=max(i.height for _,i in ims) if ims else 300
sh=Image.new('RGB',(PAD+cols*(W1+PAD),PAD+rows*(H1+LBL+PAD)),'#ECEAE6');dr=ImageDraw.Draw(sh)
font=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',22)
for k,(name,im) in enumerate(ims):
    x=PAD+(k%cols)*(W1+PAD);y=PAD+(k//cols)*(H1+LBL+PAD)
    dr.text((x,y),f'{k+1}. {name}',fill='#222',font=font);sh.paste(im,(x,y+LBL))
sh.save(out,quality=88);print(out,len(ims))
