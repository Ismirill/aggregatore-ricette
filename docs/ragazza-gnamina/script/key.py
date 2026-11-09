# Scontorno dal verde chroma (solo PIL): alfa dalla dominanza del verde, poi despill. Uso: key.py in.png out.png [#fbf5e9 per comporre su sfondo]
import sys
from PIL import Image, ImageFilter
src = Image.open(sys.argv[1]).convert('RGB'); px = []
for r, g, b in src.getdata():
    m = max(r, b); dom = g - m
    a = 255 if dom <= 18 else 0 if dom >= 70 else int(255 * (70 - dom) / 52)
    if g > m + 6: g = m + 6
    px.append((r, g, b, a))
o = Image.new('RGBA', src.size); o.putdata(px)
al = o.getchannel('A').filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.7)); o.putalpha(al)
if len(sys.argv) > 3:
    bg = Image.new('RGBA', o.size, sys.argv[3]); bg.alpha_composite(o); bg.convert('RGB').save(sys.argv[2])
else:
    o.crop(o.getbbox()).save(sys.argv[2])
print('ok', sys.argv[2])
