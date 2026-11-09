#!/usr/bin/env python3
"""Personaggi di Gnamina con MiniMax H3 (testo→immagine) su ComfyUI del PC con GPU.
Flusso ricavato dal modello ufficiale image_minimax_h3_t2i (ComfyUI 0.43), appiattito in formato API, con la LoRA turbo a 8 passi.
Uso: python3 h3_gen.py [--n 2] [--size 1024] [--steps 8] [--host URL] [idea ...]
"""
import json, os, sys, time, urllib.request, urllib.parse, uuid, argparse
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = HERE + '/gen'; os.makedirs(OUT, exist_ok=True)
sys.path.insert(0, HERE)
from comfy_gen import PROMPTS, STYLE  # stesse sei idee e stesso stile

ap = argparse.ArgumentParser()
ap.add_argument('--host', default='http://192.168.1.36:8188'); ap.add_argument('--n', type=int, default=2)
ap.add_argument('--size', type=int, default=1024); ap.add_argument('--w', type=int, default=0); ap.add_argument('--h', type=int, default=0); ap.add_argument('--steps', type=int, default=8)
ap.add_argument('--turbo', default='minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors')
ap.add_argument('--prefix', default='h3'); ap.add_argument('--seed', type=int, default=None); ap.add_argument('--prompts', help='file JSON {nome: prompt} al posto delle idee predefinite'); ap.add_argument('--style', default=None); ap.add_argument('ideas', nargs='*')
a = ap.parse_args(); H = a.host.rstrip('/')
if a.prompts:
    PROMPTS = json.load(open(a.prompts))
if a.style is not None: STYLE = a.style

def get(p):
    with urllib.request.urlopen(H + p, timeout=120) as r: return json.loads(r.read())
def post(p, body):
    req = urllib.request.Request(H + p, json.dumps(body).encode(), {'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=120) as r: return json.loads(r.read())

def workflow(prompt, seed):
    return {
      'unet': {'class_type': 'UNETLoader', 'inputs': {'unet_name': 'minimax_h3_fl2va_pruned_int8_convrot.safetensors', 'weight_dtype': 'default'}},
      'lora': {'class_type': 'LoraLoaderModelOnly', 'inputs': {'model': ['unet', 0], 'lora_name': a.turbo, 'strength_model': 1.0}},
      'att':  {'class_type': 'ModelAttentionBackend', 'inputs': {'model': ['lora', 0], 'attention': 'comfy kitchen attention'}},
      'clip': {'class_type': 'CLIPLoader', 'inputs': {'clip_name': 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors', 'type': 'minimax', 'device': 'default'}},
      'vae':  {'class_type': 'VAELoader', 'inputs': {'vae_name': 'minimax_h3_video_vae_fp16.safetensors'}},
      'cond': {'class_type': 'CLIPTextEncode', 'inputs': {'clip': ['clip', 0], 'text': prompt}},
      'lat':  {'class_type': 'EmptyLatentImage', 'inputs': {'width': a.w or a.size, 'height': a.h or a.size, 'batch_size': 1}},
      'guide': {'class_type': 'BasicGuider', 'inputs': {'model': ['att', 0], 'conditioning': ['cond', 0]}},
      'noise': {'class_type': 'RandomNoise', 'inputs': {'noise_seed': seed}},
      'samp': {'class_type': 'KSamplerSelect', 'inputs': {'sampler_name': 'res_multistep'}},
      'sig':  {'class_type': 'BasicScheduler', 'inputs': {'model': ['att', 0], 'scheduler': 'simple', 'steps': a.steps, 'denoise': 1.0}},
      'run':  {'class_type': 'SamplerCustomAdvanced', 'inputs': {'noise': ['noise', 0], 'guider': ['guide', 0], 'sampler': ['samp', 0], 'sigmas': ['sig', 0], 'latent_image': ['lat', 0]}},
      'sep':  {'class_type': 'LTXVSeparateAVLatent', 'inputs': {'av_latent': ['run', 0]}},
      'dec':  {'class_type': 'VAEDecode', 'inputs': {'samples': ['sep', 0], 'vae': ['vae', 0]}},
      'save': {'class_type': 'SaveImage', 'inputs': {'filename_prefix': 'gnamina', 'images': ['dec', 0]}},
    }

ideas = a.ideas or list(PROMPTS); client = str(uuid.uuid4())
for idea in ideas:
    if idea not in PROMPTS: print('idea sconosciuta:', idea); continue
    for k in range(a.n):
        seed = (a.seed + k * 7919) if a.seed is not None else (int(time.time() * 1000) + k * 7919) % (2**53)
        try: pid = post('/prompt', {'prompt': workflow(PROMPTS[idea] + STYLE, seed), 'client_id': client})['prompt_id']
        except urllib.error.HTTPError as e: print('rifiutato:', e.read().decode()[:600]); sys.exit(1)
        t0 = time.time()
        while True:
            h = get(f'/history/{pid}')
            if pid in h: break
            if time.time() - t0 > 900: sys.exit('timeout')
            time.sleep(2)
        st = h[pid].get('status', {}); imgs = [im for o in h[pid].get('outputs', {}).values() for im in o.get('images', [])]
        if not imgs: print(f'[{idea} {k+1}] nessuna immagine: {st.get("status_str")} {str(st.get("messages"))[:400]}', flush=True); continue
        im = imgs[0]; q = urllib.parse.urlencode({'filename': im['filename'], 'subfolder': im.get('subfolder', ''), 'type': im.get('type', 'output')})
        data = urllib.request.urlopen(H + '/view?' + q, timeout=120).read()
        path = f'{OUT}/{a.prefix}-{idea}-{k+1}.png'; open(path, 'wb').write(data)
        print(f'[{idea} {k+1}] ok {time.time()-t0:.0f}s seed {seed} -> {os.path.basename(path)}', flush=True)
