# Andamento del tono (Hz ogni 20 ms) e del volume in un tratto di un video: tono.py video.mp4 inizio durata
import sys, subprocess, wave, struct
v, ss, t = sys.argv[1], sys.argv[2], sys.argv[3]
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', ss, '-t', t, '-i', v, '-vn', '-ac', '1', '-ar', '16000', '/tmp/tono.wav'], check=True)
w = wave.open('/tmp/tono.wav'); sr = w.getframerate(); n = w.getnframes(); d = struct.unpack('<%dh' % n, w.readframes(n))
out = []
for i in range(0, n - int(.04 * sr), int(.02 * sr)):
    f = d[i:i + int(.04 * sr)]; e = sum(x * x for x in f) / len(f)
    if e < 2e5: out.append('%.2f:-' % (float(ss) + i / sr)); continue
    best = (0, 1)
    for lag in range(sr // 420, sr // 110):
        c = sum(f[j] * f[j + lag] for j in range(0, len(f) - lag))
        if c > best[0]: best = (c, lag)
    out.append('%.2f:%d/%d' % (float(ss) + i / sr, sr / best[1], int(10 * __import__('math').log10(e + 1))))
print(' '.join(out))
