#!/bin/bash
# trascrive l'audio di un video con il servizio di dettatura di Gnamina
ffmpeg -v error -y -i "$1" -vn -ac 1 -ar 16000 -c:a libmp3lame -b:a 48k /tmp/gn-aud.mp3
python3 -c "
import base64,json,urllib.request
b=base64.b64encode(open('/tmp/gn-aud.mp3','rb').read()).decode()
r=urllib.request.Request('https://ricette-ai.ricettedelcuore.workers.dev/dictate',json.dumps({'audio':b,'mime':'audio/mpeg','plain':True}).encode(),{'Content-Type':'application/json','Origin':'https://gnamina.it','User-Agent':'Gnamina/1.0 (https://gnamina.it/)'})
print(json.loads(urllib.request.urlopen(r,timeout=60).read()))"
