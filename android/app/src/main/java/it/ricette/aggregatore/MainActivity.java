package it.ricette.aggregatore;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import java.util.Locale;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import com.getcapacitor.BridgeActivity;
import org.json.JSONObject;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends BridgeActivity {
    // Ultimo link condiviso verso l'app, letto dalla pagina con AndroidShare.take()
    private String pendingShare;
    // Contenuto del file di backup in attesa che l'utente scelga dove salvarlo
    private String pendingFile;
    private static final int SAVE_FILE = 7331, REC_VIDEO = 7332, PICK_VIDEO = 7333, GOOGLE_SIGNIN = 7334, MIC_PERM = 7335;
    // «Cucina con me»: riconoscimento vocale nativo (il WebView non ha il Web Speech API); i risultati vanno alla pagina con window.onSpeech(testo)
    private SpeechRecognizer recognizer;
    private boolean listenOn;
    // Voce dell'app (il WebView non ha speechSynthesis): TextToSpeech di Android in italiano; a fine frase chiama window.onSpoken(id)
    private TextToSpeech tts;
    private boolean ttsReady;
    private final Handler ui = new Handler(Looper.getMainLooper());
    // File in cui la fotocamera scrive il video della ricetta (cartella cache dell'app, condiviso con YouTube tramite FileProvider)
    private android.net.Uri pendingVideo;
    // Video con il marchio ricevuto dalla pagina a pezzi (base64) in un file della cache: poi si condivide o si salva nella Galleria
    private java.io.File vidFile;
    private java.io.OutputStream vidOut;
    private String vidMime = "video/mp4";

    // Aggiornamento dell'app: l'APK nuovo si scarica dentro l'app (DownloadManager) e alla fine si apre l'installazione di Android
    private long apkDl = -1;
    private android.content.BroadcastReceiver apkRx;

    // Cancella gli APK scaricati per l'aggiornamento: all'avvio (la versione nuova è già installata) e prima di un nuovo download
    private void cleanApks() {
        try {
            java.io.File d = getExternalFilesDir(android.os.Environment.DIRECTORY_DOWNLOADS);
            java.io.File[] fs = d == null ? null : d.listFiles();
            if (fs != null) for (java.io.File f : fs) if (f.getName().toLowerCase().endsWith(".apk")) f.delete();
        } catch (Exception ignored) {}
    }

    private void installApk(long id) {
        try {
            android.app.DownloadManager dm = (android.app.DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            android.net.Uri u = dm.getUriForDownloadedFile(id);
            if (u == null) { js("window.onApkState&&onApkState('error','download non riuscito')"); return; }
            Intent i = new Intent(Intent.ACTION_VIEW).setDataAndType(u, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            js("window.onApkState&&onApkState('done')");
            startActivity(i);
        } catch (Exception e) {
            js("window.onApkState&&onApkState('error','" + String.valueOf(e.getMessage()).replace("'", "") + "')");
        }
    }

    private void js(String code) {
        getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript(code, null));
    }

    private void closeVid() {
        try { if (vidOut != null) vidOut.close(); } catch (Exception ignored) {}
        vidOut = null;
    }

    private static void copy(java.io.File f, java.io.OutputStream os) throws java.io.IOException {
        try (java.io.InputStream in = new java.io.FileInputStream(f); java.io.OutputStream o = os) {
            byte[] b = new byte[65536];
            int n;
            while ((n = in.read(b)) > 0) o.write(b, 0, n);
        }
    }

    // Salva il video nella Galleria (cartella Movies/Gnamina): dalla Android 10 con MediaStore senza permessi, prima scrivendo nella memoria condivisa
    private boolean saveToGallery(java.io.File f, String mime) {
        try {
            android.content.ContentValues v = new android.content.ContentValues();
            v.put(android.provider.MediaStore.Video.Media.DISPLAY_NAME, f.getName());
            v.put(android.provider.MediaStore.Video.Media.MIME_TYPE, mime);
            if (android.os.Build.VERSION.SDK_INT < 29) {
                java.io.File dir = new java.io.File(android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_MOVIES), "Gnamina");
                dir.mkdirs();
                java.io.File dst = new java.io.File(dir, f.getName());
                copy(f, new java.io.FileOutputStream(dst));
                android.media.MediaScannerConnection.scanFile(this, new String[]{dst.getAbsolutePath()}, new String[]{mime}, null);
                return true;
            }
            v.put(android.provider.MediaStore.Video.Media.RELATIVE_PATH, android.os.Environment.DIRECTORY_MOVIES + "/Gnamina");
            v.put(android.provider.MediaStore.Video.Media.IS_PENDING, 1);
            android.net.Uri u = getContentResolver().insert(android.provider.MediaStore.Video.Media.getContentUri(android.provider.MediaStore.VOLUME_EXTERNAL_PRIMARY), v);
            if (u == null) return false;
            copy(f, getContentResolver().openOutputStream(u));
            v.clear();
            v.put(android.provider.MediaStore.Video.Media.IS_PENDING, 0);
            getContentResolver().update(u, v, null, null);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    // Passa il video al menu di condivisione (TikTok, Instagram, Facebook, YouTube, WhatsApp…) con la didascalia come testo
    private boolean shareVideoFile(java.io.File f, String mime, String caption) {
        return shareFileTo(f, mime, caption, null, null);
    }

    // Condivide un file (video o foto): con «pkg» va dritto nell'app scelta (Instagram, TikTok, YouTube, Facebook); se non è installata, il menu di condivisione
    private boolean shareFileTo(java.io.File f, String mime, String caption, String pkg, String appName) {
        try {
            android.net.Uri u = androidx.core.content.FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", f);
            Intent s = new Intent(Intent.ACTION_SEND);
            s.setType(mime);
            s.putExtra(Intent.EXTRA_STREAM, u);
            if (caption != null && !caption.isEmpty()) s.putExtra(Intent.EXTRA_TEXT, caption);
            s.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startTo(s, pkg, appName, "Pubblica il video");
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    // Avvia l'intent nell'app indicata; se manca, apre il menu di condivisione e avvisa la pagina
    private void startTo(Intent s, String pkg, String appName, String chooserTitle) {
        runOnUiThread(() -> {
            if (pkg != null && !pkg.isEmpty()) {
                try {
                    Intent d = new Intent(s);
                    d.setPackage(pkg);
                    startActivity(d);
                    js("window.onShareTo&&onShareTo(true,'" + String.valueOf(appName).replace("'", "") + "')");
                    return;
                } catch (Exception e) { /* app non installata: menu di condivisione */ }
                js("window.onShareTo&&onShareTo(false,'" + String.valueOf(appName).replace("'", "") + "')");
            }
            startActivity(Intent.createChooser(s, chooserTitle));
        });
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getBridge().getWebView().addJavascriptInterface(new ShareBridge(), "AndroidShare");
        getBridge().getWebView().addJavascriptInterface(new SpeechBridge(), "AndroidSpeech");
        tts = new TextToSpeech(this, status -> {
            if (status != TextToSpeech.SUCCESS) return;
            int r = tts.setLanguage(Locale.ITALIAN);
            ttsReady = r != TextToSpeech.LANG_MISSING_DATA && r != TextToSpeech.LANG_NOT_SUPPORTED;
            pickVoice();
            tts.setPitch(1.0f);
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                public void onStart(String id) {}
                public void onDone(String id) { js("window.onSpoken&&onSpoken(" + JSONObject.quote(id) + ")"); }
                public void onError(String id) { js("window.onSpoken&&onSpoken(" + JSONObject.quote(id) + ")"); }
            });
        });
        cleanApks(); // l'APK dell'aggiornamento appena installato non serve più
        handleShare(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleShare(intent);
        getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript("window.onShared&&window.onShared()", null));
    }

    private void handleShare(Intent intent) {
        if (intent == null) return;
        try {
            JSONObject o = new JSONObject();
            if (Intent.ACTION_SEND.equals(intent.getAction())) {
                o.put("text", intent.getStringExtra(Intent.EXTRA_TEXT));
                o.put("title", intent.getStringExtra(Intent.EXTRA_SUBJECT));
            } else if (Intent.ACTION_VIEW.equals(intent.getAction()) && intent.getData() != null) {
                // link gnamina://accedi?codice=... dal browser, dopo l'accesso con Google/Apple/Facebook
                o.put("url", intent.getData().toString());
            } else return;
            pendingShare = o.toString();
        } catch (Exception ignored) {}
    }

    // Esito del selettore «salva con nome» di Android: scrive il backup dove l'utente ha scelto (Drive, telefono, Download)
    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == GOOGLE_SIGNIN) {
            // Esito del foglio Google: il token ID va alla pagina, che apre la sessione Firebase; codice 12501 = annullato, 10 = app non registrata in Firebase
            try {
                com.google.android.gms.auth.api.signin.GoogleSignInAccount a = com.google.android.gms.auth.api.signin.GoogleSignIn.getSignedInAccountFromIntent(data).getResult(com.google.android.gms.common.api.ApiException.class);
                String t = a == null ? null : a.getIdToken();
                js("window.onGoogleToken&&onGoogleToken('" + (t == null ? "" : t) + "','" + (t == null ? "notoken" : "") + "')");
            } catch (com.google.android.gms.common.api.ApiException e) {
                js("window.onGoogleToken&&onGoogleToken('','" + e.getStatusCode() + "')");
            } catch (Exception e) {
                js("window.onGoogleToken&&onGoogleToken('','x')");
            }
            return;
        }
        if (requestCode == REC_VIDEO || requestCode == PICK_VIDEO) {
            // Video registrato o scelto: lo si passa all'app YouTube (o al menu di condivisione), che lo carica sul canale dell'utente
            android.net.Uri v = data != null && data.getData() != null ? data.getData() : requestCode == REC_VIDEO ? pendingVideo : null;
            pendingVideo = null;
            if (resultCode != RESULT_OK || v == null) return;
            Intent s = new Intent(Intent.ACTION_SEND);
            s.setType("video/*");
            s.putExtra(Intent.EXTRA_STREAM, v);
            s.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            try { getPackageManager().getPackageInfo("com.google.android.youtube", 0); s.setPackage("com.google.android.youtube"); } catch (Exception ignored) {}
            try { startActivity(s.getPackage() != null ? s : Intent.createChooser(s, "Carica il video")); } catch (Exception e) {
                s.setPackage(null);
                startActivity(Intent.createChooser(s, "Carica il video"));
            }
            getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript("window.onVideoShared&&onVideoShared()", null));
            return;
        }
        if (requestCode != SAVE_FILE) return;
        String text = pendingFile;
        pendingFile = null;
        if (resultCode != RESULT_OK || data == null || data.getData() == null || text == null) return;
        String msg;
        try (OutputStream os = getContentResolver().openOutputStream(data.getData(), "wt")) {
            os.write(text.getBytes(StandardCharsets.UTF_8));
            msg = "Backup salvato";
        } catch (Exception e) {
            msg = "Salvataggio non riuscito";
        }
        final String m = msg;
        getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript("window.toast&&toast('" + m + "')", null));
    }

    // --- Cucina con me: ascolto continuo con il riconoscimento di Android (si riavvia da solo dopo ogni frase) ---
    private void startListen() {
        listenOn = true;
        if (androidx.core.content.ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            androidx.core.app.ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.RECORD_AUDIO}, MIC_PERM); // minSdk 22: le versioni di androidx
            return;
        }
        if (recognizer == null) {
            recognizer = SpeechRecognizer.createSpeechRecognizer(this);
            recognizer.setRecognitionListener(new RecognitionListener() {
                public void onReadyForSpeech(Bundle b) {}
                public void onBeginningOfSpeech() {}
                public void onRmsChanged(float v) {}
                public void onBufferReceived(byte[] b) {}
                public void onEndOfSpeech() {}
                public void onPartialResults(Bundle b) {}
                public void onEvent(int t, Bundle b) {}
                public void onError(int e) {
                    if (listenOn) ui.postDelayed(MainActivity.this::listenOnce, e == SpeechRecognizer.ERROR_RECOGNIZER_BUSY ? 1200 : 500);
                }
                public void onResults(Bundle b) {
                    java.util.ArrayList<String> r = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    if (r != null && !r.isEmpty() && r.get(0) != null) js("window.onSpeech&&onSpeech(" + JSONObject.quote(r.get(0)) + ")");
                    if (listenOn) ui.postDelayed(MainActivity.this::listenOnce, 250);
                }
            });
        }
        muteBeeps(true);
        listenOnce();
    }

    private void listenOnce() {
        if (!listenOn || recognizer == null) return;
        try {
            Intent it = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            it.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            it.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "it-IT");
            it.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "it-IT");
            it.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
            it.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            recognizer.startListening(it);
        } catch (Exception e) {
            if (listenOn) ui.postDelayed(MainActivity.this::listenOnce, 1500);
        }
    }

    // La voce italiana di qualità più alta tra quelle installate (quelle «di rete» di Google sono le più naturali); a parità, quella che non ha bisogno di connessione
    private void pickVoice() {
        if (tts == null) return;
        try {
            Voice best = null;
            java.util.Set<Voice> all = tts.getVoices();
            if (all != null) for (Voice v : all) {
                if (v.getLocale() == null || !"it".equals(v.getLocale().getLanguage())) continue;
                if (v.getFeatures() != null && v.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)) continue;
                if (best == null || v.getQuality() > best.getQuality() || (v.getQuality() == best.getQuality() && best.isNetworkConnectionRequired() && !v.isNetworkConnectionRequired())) best = v;
            }
            if (best != null) { tts.setVoice(best); ttsReady = true; }
        } catch (Exception ignored) {}
    }

    @Override
    public void onResume() {
        super.onResume();
        if (tts != null && ttsReady) { pickVoice(); js("window.onVoiceChanged&&onVoiceChanged()"); } // tornati dalle impostazioni: magari c'è una voce migliore
    }

    private void stopListen() {
        listenOn = false;
        if (recognizer != null) try { recognizer.cancel(); } catch (Exception ignored) {}
        muteBeeps(false);
    }

    // Android suona un «bip» a ogni avvio dell'ascolto: mentre si cucina stiamo zitti (la voce dell'app usa il canale della musica, che resta acceso)
    private void muteBeeps(boolean on) {
        try {
            AudioManager am = (AudioManager) getSystemService(AUDIO_SERVICE);
            int dir = on ? AudioManager.ADJUST_MUTE : AudioManager.ADJUST_UNMUTE;
            am.adjustStreamVolume(AudioManager.STREAM_NOTIFICATION, dir, 0);
            am.adjustStreamVolume(AudioManager.STREAM_SYSTEM, dir, 0);
        } catch (Exception ignored) {}
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == MIC_PERM) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) { if (listenOn) startListen(); }
            else { listenOn = false; js("window.toast&&toast('Microfono non permesso: usa i pulsanti')"); }
        }
    }

    @Override
    public void onDestroy() {
        if (tts != null) try { tts.stop(); tts.shutdown(); } catch (Exception ignored) {}
        tts = null;
        stopListen();
        if (recognizer != null) try { recognizer.destroy(); } catch (Exception ignored) {}
        recognizer = null;
        super.onDestroy();
    }

    class SpeechBridge {
        @JavascriptInterface
        public boolean canSpeak() {
            return ttsReady;
        }

        // Legge un testo; a fine lettura la pagina riceve onSpoken(id). Una nuova frase interrompe la precedente
        @JavascriptInterface
        public void say(String text, String id) {
            if (!ttsReady || tts == null) { js("window.onSpoken&&onSpoken(" + JSONObject.quote(id) + ")"); return; }
            runOnUiThread(() -> { try { tts.setSpeechRate(1.12f); tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, id); } catch (Exception e) { js("window.onSpoken&&onSpoken(" + JSONObject.quote(id) + ")"); } });
        }

        // Stato della voce in uso: pronta, nome, qualità (100 bassissima … 500 altissima), se serve la rete
        @JavascriptInterface
        public String voiceInfo() {
            try {
                JSONObject o = new JSONObject();
                o.put("ready", ttsReady);
                Voice v = tts != null ? tts.getVoice() : null;
                if (v != null) { o.put("name", v.getName()); o.put("quality", v.getQuality()); o.put("network", v.isNetworkConnectionRequired()); }
                return o.toString();
            } catch (Exception e) { return "{}"; }
        }

        // Apre la schermata del motore vocale per scaricare le voci (poi le impostazioni della sintesi vocale, se quella non c'è)
        @JavascriptInterface
        public void improveVoice() {
            runOnUiThread(() -> {
                try {
                    Intent i = new Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA);
                    String eng = tts != null ? tts.getDefaultEngine() : null;
                    if (eng != null) i.setPackage(eng);
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(i);
                } catch (Exception e) {
                    try {
                        Intent i = new Intent("com.android.settings.TTS_SETTINGS");
                        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(i);
                    } catch (Exception e2) {
                        js("window.toast&&toast('Apri Impostazioni del telefono → Sintesi vocale')");
                    }
                }
            });
        }

        @JavascriptInterface
        public void stopSay() {
            runOnUiThread(() -> { if (tts != null) try { tts.stop(); } catch (Exception ignored) {} });
        }

        @JavascriptInterface
        public boolean available() {
            return SpeechRecognizer.isRecognitionAvailable(MainActivity.this);
        }

        @JavascriptInterface
        public void start() {
            runOnUiThread(MainActivity.this::startListen);
        }

        @JavascriptInterface
        public void stop() {
            runOnUiThread(MainActivity.this::stopListen);
        }
    }

    class ShareBridge {
        // Schermo acceso finché si cucina («Cucina con me»)
        @JavascriptInterface
        public void keepAwake(boolean on) {
            runOnUiThread(() -> {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }

        @JavascriptInterface
        public String take() {
            String s = pendingShare;
            pendingShare = null;
            return s;
        }

        // Condivide un testo (es. la lista della spesa) con il menu di condivisione di Android
        @JavascriptInterface
        public void send(String title, String text) {
            Intent i = new Intent(Intent.ACTION_SEND);
            i.setType("text/plain");
            i.putExtra(Intent.EXTRA_SUBJECT, title);
            i.putExtra(Intent.EXTRA_TEXT, text);
            runOnUiThread(() -> startActivity(Intent.createChooser(i, title)));
        }

        // Condivide un testo direttamente in un'app (pacchetto Android), es. Facebook; se manca, il menu di condivisione
        @JavascriptInterface
        public void shareTo(String pkg, String appName, String title, String text) {
            Intent i = new Intent(Intent.ACTION_SEND);
            i.setType("text/plain");
            i.putExtra(Intent.EXTRA_SUBJECT, title);
            i.putExtra(Intent.EXTRA_TEXT, text);
            startTo(i, pkg, appName, title);
        }

        // Come videoEnd, ma il file va dritto nell'app scelta (Instagram, TikTok, YouTube, Facebook)
        @JavascriptInterface
        public void videoEndTo(String pkg, String appName, String caption) {
            final boolean ready = vidOut != null && vidFile != null;
            closeVid();
            final java.io.File f = vidFile;
            final String m = vidMime, c = caption;
            new Thread(() -> {
                boolean ok = ready && shareFileTo(f, m, c, pkg, appName);
                js("window.onVideoDone&&onVideoDone(" + ok + ",'share')");
            }).start();
        }

        // Accesso con Google dentro l'app: foglio nativo di scelta dell'account (Google Play Services), poi il token ID va a Firebase dalla pagina
        @JavascriptInterface
        public void googleSignIn(String webClientId) {
            if (webClientId == null || webClientId.isEmpty()) { js("window.onGoogleToken&&onGoogleToken('','config')"); return; }
            runOnUiThread(() -> {
                try {
                    com.google.android.gms.auth.api.signin.GoogleSignInOptions o = new com.google.android.gms.auth.api.signin.GoogleSignInOptions.Builder(com.google.android.gms.auth.api.signin.GoogleSignInOptions.DEFAULT_SIGN_IN)
                        .requestIdToken(webClientId).requestEmail().build();
                    com.google.android.gms.auth.api.signin.GoogleSignInClient c = com.google.android.gms.auth.api.signin.GoogleSignIn.getClient(MainActivity.this, o);
                    c.signOut().addOnCompleteListener(t -> startActivityForResult(c.getSignInIntent(), GOOGLE_SIGNIN));
                } catch (Exception e) {
                    js("window.onGoogleToken&&onGoogleToken('','" + String.valueOf(e.getMessage()).replace("'", "") + "')");
                }
            });
        }

        // Scarica l'APK della versione nuova dentro l'app e, finito il download, apre l'installazione (niente browser)
        @JavascriptInterface
        public void updateApk(String url, String name) {
            if (url == null || !url.startsWith("https://")) return;
            runOnUiThread(() -> {
                try {
                    android.app.DownloadManager dm = (android.app.DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                    String fn = (name == null || name.isEmpty() ? "Gnamina.apk" : name).replaceAll("[^\\w.-]", "_");
                    cleanApks();
                    android.app.DownloadManager.Request r = new android.app.DownloadManager.Request(android.net.Uri.parse(url))
                        .setTitle(fn).setMimeType("application/vnd.android.package-archive")
                        .setNotificationVisibility(android.app.DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                        .setDestinationInExternalFilesDir(MainActivity.this, android.os.Environment.DIRECTORY_DOWNLOADS, fn);
                    if (apkRx == null) {
                        apkRx = new android.content.BroadcastReceiver() {
                            @Override public void onReceive(android.content.Context c, Intent i) {
                                long id = i.getLongExtra(android.app.DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                                if (id == apkDl) installApk(id);
                            }
                        };
                        android.content.IntentFilter f = new android.content.IntentFilter(android.app.DownloadManager.ACTION_DOWNLOAD_COMPLETE);
                        if (android.os.Build.VERSION.SDK_INT >= 33) registerReceiver(apkRx, f, android.content.Context.RECEIVER_EXPORTED);
                        else registerReceiver(apkRx, f);
                    }
                    apkDl = dm.enqueue(r);
                    js("window.onApkState&&onApkState('started')");
                } catch (Exception e) {
                    js("window.onApkState&&onApkState('error','" + String.valueOf(e.getMessage()).replace("'", "") + "')");
                }
            });
        }

        // Apre un indirizzo nel browser di sistema (l'accesso Google/Apple/Facebook non è permesso dentro la WebView)
        @JavascriptInterface
        public void open(String url) {
            if (url == null || !url.startsWith("https://")) return;
            Intent i = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url));
            runOnUiThread(() -> startActivity(i));
        }

        // Registra il video di una ricetta con la fotocamera: il file resta nella cache dell'app e dopo viene passato a YouTube
        @JavascriptInterface
        public void recordVideo() {
            try {
                java.io.File dir = new java.io.File(getCacheDir(), "video");
                dir.mkdirs();
                for (java.io.File old : dir.listFiles() != null ? dir.listFiles() : new java.io.File[0]) old.delete(); // un video alla volta
                java.io.File f = new java.io.File(dir, "ricetta-" + System.currentTimeMillis() + ".mp4");
                pendingVideo = androidx.core.content.FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".fileprovider", f);
                Intent i = new Intent(android.provider.MediaStore.ACTION_VIDEO_CAPTURE);
                i.putExtra(android.provider.MediaStore.EXTRA_OUTPUT, pendingVideo);
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                runOnUiThread(() -> startActivityForResult(i, REC_VIDEO));
            } catch (Exception e) {
                getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript("window.toast&&toast('Fotocamera non disponibile')", null));
            }
        }

        // Sceglie un video già presente sul telefono, da passare a YouTube
        @JavascriptInterface
        public void pickVideo() {
            Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("video/*");
            runOnUiThread(() -> startActivityForResult(i, PICK_VIDEO));
        }

        // Video con il marchio: inizio (nome e tipo), pezzi in base64, fine con l'azione «share» (menu di condivisione) o «save» (Galleria)
        @JavascriptInterface
        public void videoBegin(String name, String mime) {
            closeVid();
            try {
                java.io.File dir = new java.io.File(getCacheDir(), "video");
                dir.mkdirs();
                for (java.io.File old : dir.listFiles() != null ? dir.listFiles() : new java.io.File[0]) old.delete(); // un video alla volta
                String n = name == null || name.isEmpty() ? "gnamina.mp4" : name.replaceAll("[^A-Za-z0-9._-]", "-");
                vidFile = new java.io.File(dir, n);
                vidOut = new java.io.BufferedOutputStream(new java.io.FileOutputStream(vidFile));
                vidMime = mime == null || mime.isEmpty() ? "video/mp4" : mime;
            } catch (Exception e) {
                vidOut = null;
            }
        }

        @JavascriptInterface
        public void videoChunk(String b64) {
            if (vidOut == null) return;
            try { vidOut.write(android.util.Base64.decode(b64, android.util.Base64.DEFAULT)); } catch (Exception e) { closeVid(); }
        }

        @JavascriptInterface
        public void videoEnd(String action, String caption) {
            final boolean ready = vidOut != null && vidFile != null;
            closeVid();
            final java.io.File f = vidFile;
            final String a = "save".equals(action) ? "save" : "share", m = vidMime, c = caption;
            new Thread(() -> {
                boolean ok = ready && (a.equals("save") ? saveToGallery(f, m) : shareVideoFile(f, m, c));
                js("window.onVideoDone&&onVideoDone(" + ok + ",'" + a + "')");
            }).start();
        }

        // Salva un file di testo con il selettore di Android: l'utente sceglie Google Drive, la memoria del telefono o Download
        @JavascriptInterface
        public void saveFile(String name, String text) {
            pendingFile = text;
            Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("application/json");
            i.putExtra(Intent.EXTRA_TITLE, name);
            runOnUiThread(() -> startActivityForResult(i, SAVE_FILE));
        }
    }
}
