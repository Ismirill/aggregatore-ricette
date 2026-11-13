package it.ricette.aggregatore;

import com.google.mlkit.genai.common.DownloadCallback;
import com.google.mlkit.genai.common.FeatureStatus;
import com.google.mlkit.genai.prompt.Candidate;
import com.google.mlkit.genai.prompt.GenerateContentRequest;
import com.google.mlkit.genai.prompt.GenerateContentResponse;
import com.google.mlkit.genai.prompt.Generation;
import com.google.mlkit.genai.prompt.TextPart;
import com.google.mlkit.genai.prompt.java.GenerativeModelFutures;

import java.util.List;
import java.util.concurrent.TimeUnit;

// AI del telefono: Gemini Nano tramite ML Kit (AICore), gratis e senza internet, sui telefoni che lo hanno (Pixel 9 e 10,
// Galaxy recenti, Xiaomi 15, vivo X200…). La libreria richiede Android 8 (API 26): MainActivity usa questa classe solo da lì
// in su, così sui telefoni più vecchi non viene nemmeno caricata. Ogni metodo blocca: va chiamato fuori dal thread principale.
final class LocalAi {
    private static GenerativeModelFutures model;
    private static volatile boolean downloading;

    private static synchronized GenerativeModelFutures model() {
        if (model == null) model = GenerativeModelFutures.from(Generation.INSTANCE.getClient());
        return model;
    }

    // "available" | "downloadable" | "downloading" | "unavailable"
    static String status() throws Exception {
        int s = model().checkStatus().get(20, TimeUnit.SECONDS);
        if (s == FeatureStatus.AVAILABLE) return "available";
        if (s == FeatureStatus.DOWNLOADING || downloading) return "downloading";
        if (s == FeatureStatus.DOWNLOADABLE) return "downloadable";
        return "unavailable";
    }

    // Scarica il modello (lo gestisce AICore, di solito con il Wi-Fi): la pagina richiede lo stato più tardi
    static void download() {
        if (downloading) return;
        downloading = true;
        model().download(new DownloadCallback() {
            @Override public void onDownloadCompleted() { downloading = false; }
            @Override public void onDownloadFailed(com.google.mlkit.genai.common.GenAiException e) { downloading = false; }
        });
    }

    static String run(String prompt, int maxTokens) throws Exception {
        GenerateContentRequest.Builder b = new GenerateContentRequest.Builder(new TextPart(prompt));
        b.setTemperature(0.2f); // deve trascrivere la ricetta, non inventare
        b.setTopK(10);
        b.setMaxOutputTokens(Math.max(200, Math.min(maxTokens, 2000)));
        GenerateContentResponse r = model().generateContent(b.build()).get(90, TimeUnit.SECONDS);
        List<Candidate> c = r.getCandidates();
        if (c == null || c.isEmpty() || c.get(0).getText() == null) throw new Exception("risposta vuota");
        return c.get(0).getText();
    }
}
