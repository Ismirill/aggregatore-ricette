package it.ricette.aggregatore;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

// Avviso di scadenza della dispensa, programmato dalla pagina con AndroidShare.notesSet: resta valido anche dopo il riavvio
public class NoteWorker extends Worker {
    public NoteWorker(@NonNull Context c, @NonNull WorkerParameters p) { super(c, p); }

    @NonNull
    @Override
    public Result doWork() {
        try {
            Context c = getApplicationContext();
            if (Build.VERSION.SDK_INT >= 33 && c.checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) return Result.success();
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(new NotificationChannel("scadenze", "Scadenze della dispensa", NotificationManager.IMPORTANCE_DEFAULT));
            Intent i = new Intent(c, MainActivity.class).putExtra("gnOpen", "disp")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            int fl = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
            PendingIntent pi = PendingIntent.getActivity(c, 1, i, fl);
            String body = getInputData().getString("body");
            NotificationCompat.Builder b = new NotificationCompat.Builder(c, "scadenze")
                .setSmallIcon(R.drawable.ic_stat_gnamina)
                .setContentTitle(getInputData().getString("title"))
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setColor(0xFFD22701)
                .setContentIntent(pi)
                .setAutoCancel(true);
            nm.notify(4100, b.build());
        } catch (Throwable ignored) {}
        return Result.success();
    }
}
