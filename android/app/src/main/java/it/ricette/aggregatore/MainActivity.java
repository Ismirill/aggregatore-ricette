package it.ricette.aggregatore;

import android.content.Intent;
import android.os.Bundle;
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
    private static final int SAVE_FILE = 7331;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getBridge().getWebView().addJavascriptInterface(new ShareBridge(), "AndroidShare");
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

    class ShareBridge {
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

        // Apre un indirizzo nel browser di sistema (l'accesso Google/Apple/Facebook non è permesso dentro la WebView)
        @JavascriptInterface
        public void open(String url) {
            if (url == null || !url.startsWith("https://")) return;
            Intent i = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url));
            runOnUiThread(() -> startActivity(i));
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
