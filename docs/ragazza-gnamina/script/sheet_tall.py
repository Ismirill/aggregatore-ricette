# Foglio di confronto per immagini verticali: tre per riga, con il nome
import os,sys,glob
from PIL import Image,ImageDraw,ImageFont
D=os.path.dirname(os.path.abspath(__file__))+'/gen';pre=sys.argv[1];out=sys.argv[2];cols=int(sys.argv[3]) if len(sys.argv)>3 else 3
W1=420;PAD=18;LBL=32
ims=[(os.path.basename(f)[len(pre)+1:-4],Image.open(f).convert('RGB')) for f in sorted(glob.glob(f'{D}/{pre}-*.png'))]
ims=[(n,i.resize((W1,int(i.height*W1/i.width)))) for n,i in ims]
rows=(len(ims)+cols-1)//cols;H1=max(i.height for _,i in ims)
sh=Image.new('RGB',(PAD+cols*(W1+PAD),PAD+rows*(H1+LBL+PAD)),'#ECEAE6');dr=ImageDraw.Draw(sh)
font=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',20)
for k,(n,im) in enumerate(ims):
    x=PAD+(k%cols)*(W1+PAD);y=PAD+(k//cols)*(H1+LBL+PAD);dr.text((x,y+4),f'{k+1}. {n}',fill='#222',font=font);sh.paste(im,(x,y+LBL))
sh.save(out,quality=86);print(out,len(ims))
