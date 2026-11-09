#!/usr/bin/env python3
"""Mascotte di Gnamina: riferimento → video con audio nativo (MiniMax H3 «Reference to Video», LoRA turbo 4 passi + realism).
Flusso appiattito dal template ufficiale video_minimax_h3_r2v e dai flussi Polaris dell'utente.
Uso: python3 h3_r2v.py --ref volto.png [--ref altra.png] --prompt testo.txt --out vid/x.mp4 [--w 768 --h 1024 --dur 5 --seed 1 --realism 0.7]
"""
import json, os, sys, time, urllib.request, urllib.parse, uuid, argparse, mimetypes

ap = argparse.ArgumentParser()
ap.add_argument('--host', default='http://192.168.1.36:8188')
ap.add_argument('--ref', action='append', required=True, help='immagini di riferimento, in ordine <Picture 1>, <Picture 2>…'); ap.add_argument('--realism', type=float, default=0.7); ap.add_argument('--refsize', default='match')
ap.add_argument('--prompt', required=True, help='file di testo con la descrizione di scena, movimento e audio')
ap.add_argument('--out', required=True)
ap.add_argument('--w', type=int, default=576); ap.add_argument('--h', type=int, default=768)
ap.add_argument('--dur', type=float, default=5); ap.add_argument('--seed', type=int, default=1)
ap.add_argument('--steps', type=int, default=4); ap.add_argument('--noturbo', action='store_true')
ap.add_argument('--model', default='minimax_h3_ref2va_pruned_int8_convrot.safetensors'); ap.add_argument('--sched', default='simple')
a = ap.parse_args(); H = a.host.rstrip('/')

def get(p):
    with urllib.request.urlopen(H + p, timeout=120) as r: return json.loads(r.read())
def post(p, body):
    req = urllib.request.Request(H + p, json.dumps(body).encode(), {'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=120) as r: return json.loads(r.read())
def upload(path):
    b = uuid.uuid4().hex; name = os.path.basename(path)
    ct = mimetypes.guess_type(path)[0] or 'image/png'
    body = (f'--{b}\r\nContent-Disposition: form-data; name="image"; filename="{name}"\r\nContent-Type: {ct}\r\n\r\n').encode() + open(path, 'rb').read() + \
           (f'\r\n--{b}\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n--{b}--\r\n').encode()
    req = urllib.request.Request(H + '/upload/image', body, {'Content-Type': f'multipart/form-data; boundary={b}'})
    with urllib.request.urlopen(req, timeout=120) as r: return json.loads(r.read())['name']

# lunghezza valida: multiplo di 17 fotogrammi + 5, a 24 fps (stessa formula del template)
n = max(5, round(a.dur * 24)); length = n + (5 - n % 17) % 17

refs = [upload(p) for p in a.ref]
base = 'unet' if a.noturbo else 'lora'
model = 'real' if a.realism > 0 else base
wf = {
  'unet': {'class_type': 'UNETLoader', 'inputs': {'unet_name': a.model, 'weight_dtype': 'default'}},
  'lora': {'class_type': 'LoraLoaderModelOnly', 'inputs': {'model': ['unet', 0], 'lora_name': 'minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors', 'strength_model': 1.0}},
  'real': {'class_type': 'LoraLoaderModelOnly', 'inputs': {'model': [base, 0], 'lora_name': 'h3-realism-people-t2v-i2v-r2v.safetensors', 'strength_model': a.realism}},
  'clip': {'class_type': 'CLIPLoader', 'inputs': {'clip_name': 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors', 'type': 'minimax', 'device': 'default'}},
  'vae':  {'class_type': 'VAELoader', 'inputs': {'vae_name': 'minimax_h3_video_vae_fp16.safetensors'}},
  'avae': {'class_type': 'VAELoader', 'inputs': {'vae_name': 'minimax_h3_audio_vae_fp32.safetensors'}},
  'r2v':  {'class_type': 'MiniMaxH3ReferenceToVideo', 'inputs': {'clip': ['clip', 0], 'vae': ['vae', 0], 'audio_vae': ['avae', 0],
            'prompt': open(a.prompt).read(), 'width': a.w, 'height': a.h, 'length': length, 'ref_image_size': a.refsize}},
  'guide': {'class_type': 'BasicGuider', 'inputs': {'model': [model, 0], 'conditioning': ['r2v', 0]}},
  'noise': {'class_type': 'RandomNoise', 'inputs': {'noise_seed': a.seed}},
  'samp': {'class_type': 'KSamplerSelect', 'inputs': {'sampler_name': 'res_multistep'}},
  'sig':  {'class_type': 'BasicScheduler', 'inputs': {'model': [model, 0], 'scheduler': a.sched, 'steps': a.steps, 'denoise': 1.0}},
  'run':  {'class_type': 'SamplerCustomAdvanced', 'inputs': {'noise': ['noise', 0], 'guider': ['guide', 0], 'sampler': ['samp', 0], 'sigmas': ['sig', 0], 'latent_image': ['r2v', 1]}},
  'dec':  {'class_type': 'VAEDecode', 'inputs': {'samples': ['run', 0], 'vae': ['vae', 0]}},
  'adec': {'class_type': 'VAEDecodeAudio', 'inputs': {'samples': ['run', 0], 'vae': ['avae', 0]}},
  'vid':  {'class_type': 'CreateVideo', 'inputs': {'images': ['dec', 0], 'audio': ['adec', 0], 'fps': 24}},
  'save': {'class_type': 'SaveVideo', 'inputs': {'video': ['vid', 0], 'filename_prefix': 'video/gnamina', 'format': 'auto', 'codec': 'auto'}},
}
if a.noturbo: del wf['lora']
if a.realism <= 0: del wf['real']
for k, r in enumerate(refs, 1):
    wf[f'ref{k}'] = {'class_type': 'LoadImage', 'inputs': {'image': r}}
    wf['r2v']['inputs'][f'ref_images.ref_image_{k}'] = [f'ref{k}', 0]

try: pid = post('/prompt', {'prompt': wf, 'client_id': str(uuid.uuid4())})['prompt_id']
except urllib.error.HTTPError as e: sys.exit('rifiutato: ' + e.read().decode()[:1500])
t0 = time.time()
while True:
    h = get(f'/history/{pid}')
    if pid in h: break
    if time.time() - t0 > 3600: sys.exit('timeout')
    time.sleep(3)
st = h[pid].get('status', {})
files = [f for o in h[pid].get('outputs', {}).values() for v in o.values() if isinstance(v, list) for f in v if isinstance(f, dict) and 'filename' in f]
if not files: sys.exit(f'nessun video: {st.get("status_str")} {str(st.get("messages"))[-1500:]}')
f = files[0]; q = urllib.parse.urlencode({'filename': f['filename'], 'subfolder': f.get('subfolder', ''), 'type': f.get('type', 'output')})
os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
open(a.out, 'wb').write(urllib.request.urlopen(H + '/view?' + q, timeout=300).read())
print(f'ok {time.time()-t0:.0f}s {length} fotogrammi -> {a.out}')
