#!/usr/bin/env python3
"""Genera i personaggi di Gnamina con ComfyUI sul PC con GPU (cachyos-pc, RTX 5080).

Uso:  python3 comfy_gen.py [--host http://cachyos-pc.homenet.telecomitalia.it:8188] [--ckpt nome.safetensors] [--n 2] [--size 1024] [nome-idea ...]
Senza argomenti genera tutte le idee, 2 immagini ciascuna, e scrive i file in gen/comfy-<idea>-<k>.png.
Il modello si sceglie da solo tra quelli installati (preferenza: FLUX schnell, poi FLUX dev, poi SDXL); con --list li elenca soltanto.
"""
import json, os, sys, time, urllib.request, urllib.parse, uuid, argparse

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = HERE + '/gen'; os.makedirs(OUT, exist_ok=True)
STYLE = ' Flat vector mascot illustration for an app icon, character centered and filling the frame, bold clean outlines, warm palette of tomato red, cream, basil green and cocoa brown, friendly, modern, professional branding quality, no text, plain background.'
PROMPTS = {
 'pomodorina': 'Gnamina, a cute round tomato character with a cheerful girl face, rosy cheeks, a small green leaf as a hair tuft, winking and licking her lips after a bite, on a cream background.',
 'nonna': 'Gnamina, a warm smiling Italian grandmother chef, bust portrait, grey hair in a bun, red apron, holding a wooden spoon, kind eyes, on a cream background.',
 'cuoca': 'Gnamina, a young Italian woman chef with a red bandana and dark curly hair, big happy smile, eyes closed in delight while tasting from a spoon, bust portrait on a cream background.',
 'gnocco': 'Gnamina, a chubby little dumpling (gnocco) character with a sweet face and tiny arms, happily hugging a cherry tomato, on a tomato-red background.',
 'piattino': 'Gnamina, a cream dinner plate with a cute face, a bite taken out of its rim, happy half-closed eyes and a small smiling mouth, on a tomato-red background.',
 'bambina': 'Gnamina, a little girl with red pigtails and a chef hat, round face, freckles, holding a fork with a twirl of spaghetti, big smile, bust portrait on a cream background.',
}
NEG = 'blurry, photo, photorealistic, 3d render, text, letters, watermark, signature, deformed, extra fingers, ugly, low quality'

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--host', default=os.environ.get('COMFY_URL', 'http://cachyos-pc.homenet.telecomitalia.it:8188'))
    ap.add_argument('--ckpt'); ap.add_argument('--n', type=int, default=2); ap.add_argument('--size', type=int, default=1024)
    ap.add_argument('--list', action='store_true'); ap.add_argument('ideas', nargs='*')
    a = ap.parse_args(); H = a.host.rstrip('/')

    def get(path):
        with urllib.request.urlopen(H + path, timeout=60) as r: return json.loads(r.read())
    def post(path, body):
        req = urllib.request.Request(H + path, json.dumps(body).encode(), {'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=60) as r: return json.loads(r.read())

    info = get('/object_info/CheckpointLoaderSimple')
    ckpts = info['CheckpointLoaderSimple']['input']['required']['ckpt_name'][0]
    if a.list or not ckpts:
        print('Checkpoint installati:'); [print(' -', c) for c in ckpts]; sys.exit(0 if ckpts else 'nessun checkpoint')
    def pick():
        if a.ckpt: return a.ckpt
        for pat in ('schnell', 'flux', 'xl', 'sdxl', 'juggernaut', 'dreamshaper'):
            for c in ckpts:
                if pat in c.lower(): return c
        return ckpts[0]
    ckpt = pick(); flux = 'flux' in ckpt.lower() or 'schnell' in ckpt.lower()
    # FLUX schnell: 4 passi, cfg 1, niente prompt negativo. SDXL e simili: 28 passi, cfg 6
    steps, cfg, sampler, sched = (4, 1.0, 'euler', 'simple') if 'schnell' in ckpt.lower() else (20, 1.0, 'euler', 'simple') if flux else (28, 6.0, 'dpmpp_2m', 'karras')
    print(f'Modello: {ckpt}  ({steps} passi, cfg {cfg})  ->  {H}')

    def workflow(prompt, seed):
        return {
          '1': {'class_type': 'CheckpointLoaderSimple', 'inputs': {'ckpt_name': ckpt}},
          '2': {'class_type': 'CLIPTextEncode', 'inputs': {'text': prompt, 'clip': ['1', 1]}},
          '3': {'class_type': 'CLIPTextEncode', 'inputs': {'text': '' if flux else NEG, 'clip': ['1', 1]}},
          '4': {'class_type': 'EmptyLatentImage', 'inputs': {'width': a.size, 'height': a.size, 'batch_size': 1}},
          '5': {'class_type': 'KSampler', 'inputs': {'seed': seed, 'steps': steps, 'cfg': cfg, 'sampler_name': sampler, 'scheduler': sched, 'denoise': 1.0,
                 'model': ['1', 0], 'positive': ['2', 0], 'negative': ['3', 0], 'latent_image': ['4', 0]}},
          '6': {'class_type': 'VAEDecode', 'inputs': {'samples': ['5', 0], 'vae': ['1', 2]}},
          '7': {'class_type': 'SaveImage', 'inputs': {'filename_prefix': 'gnamina', 'images': ['6', 0]}},
        }

    ideas = a.ideas or list(PROMPTS)
    client = str(uuid.uuid4())
    for idea in ideas:
        if idea not in PROMPTS: print('idea sconosciuta:', idea); continue
        for k in range(a.n):
            seed = int(time.time() * 1000) % (2**32) + k
            pid = post('/prompt', {'prompt': workflow(PROMPTS[idea] + STYLE, seed), 'client_id': client})['prompt_id']
            t0 = time.time()
            while True:  # attesa della coda
                h = get(f'/history/{pid}')
                if pid in h: break
                if time.time() - t0 > 600: sys.exit('timeout')
                time.sleep(1.5)
            outs = h[pid].get('outputs', {}); st = h[pid].get('status', {})
            imgs = [im for o in outs.values() for im in o.get('images', [])]
            if not imgs: print(f'[{idea} {k+1}] nessuna immagine: {st.get("status_str")} {str(st.get("messages"))[:200]}'); continue
            im = imgs[0]
            q = urllib.parse.urlencode({'filename': im['filename'], 'subfolder': im.get('subfolder', ''), 'type': im.get('type', 'output')})
            data = urllib.request.urlopen(H + '/view?' + q, timeout=120).read()
            path = f'{OUT}/comfy-{idea}-{k+1}.png'; open(path, 'wb').write(data)
            print(f'[{idea} {k+1}] ok {time.time()-t0:.0f}s seed {seed} -> {os.path.basename(path)}', flush=True)
    print('Fatto. Foglio: python3 sheet.py comfy')


if __name__ == '__main__':
    main()
