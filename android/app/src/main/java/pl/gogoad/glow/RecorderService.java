package pl.gogoad.glow;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import androidx.core.app.NotificationCompat;

/**
 * The foreground service behind background recording. Android shows its notification for as long
 * as it runs: while it records, and while it waits for the device to answer.
 */
public class RecorderService extends Service {

    private static final String CHANNEL = "background";
    private static final int NOTIFICATION = 1;

    /** The running service, so the app's calls reach it without another start. */
    static volatile RecorderService instance;

    private final Handler main = new Handler(Looper.getMainLooper());
    private HandlerThread thread;
    private Recorder recorder;
    private String shown = "";
    private boolean stopping;

    void post(Runnable r) {
        main.post(r);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        thread = new HandlerThread("glow-recorder");
        thread.start();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Started again while stopping: Android keeps this instance, so it carries on.
        instance = this;
        stopping = false;
        // Within seconds of startForegroundService(), whatever happens next.
        show(true);
        sync();
        // Restarted by the system after it killed Glow: sync() works out again whether to record.
        return START_STICKY;
    }

    /** Does what Background.mode() says. */
    void sync() {
        Background.Mode mode = Background.mode(this);
        if (mode != Background.Mode.RECORD && recorder != null) {
            // On screen again, or connected by itself: the app carries the session on.
            recorder.stop(Background.appHasIt() ? "app" : "off");
            recorder = null;
            synchronized (Background.LOCK) {
                Background.recorder = null;
            }
        }
        if (mode == Background.Mode.NONE) {
            stopping = true;
            // A start from now on goes through startForegroundService() again.
            instance = null;
            stopForeground(Service.STOP_FOREGROUND_REMOVE);
            stopSelf();
            return;
        }
        if (recorder == null) {
            recorder = new Recorder(this, new Handler(thread.getLooper()), events);
            synchronized (Background.LOCK) {
                Background.recorder = recorder;
            }
            recorder.start();
        }
        show(false);
    }

    private final Recorder.Events events = new Recorder.Events() {
        @Override
        public void changed() {
            post(() -> show(false));
        }

        @Override
        public void ended() {
            post(() -> {
                recorder = null;
                synchronized (Background.LOCK) {
                    Background.recorder = null;
                }
                // Gone until the system sees it again.
                Background.gone(RecorderService.this);
            });
        }
    };

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Swiped away from the recent apps: the app's own connection went with its screen.
        Background.appGone(this);
    }

    @Override
    public void onDestroy() {
        if (recorder != null) recorder.stop("off");
        recorder = null;
        synchronized (Background.LOCK) {
            Background.recorder = null;
        }
        if (instance == this) instance = null;
        // Let the recorder close its connection first.
        Handler h = new Handler(thread.getLooper());
        h.post(thread::quitSafely);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void show(boolean starting) {
        // A change reported after the service was told to stop would leave a stray notification.
        if (stopping) return;
        String model = Background.model(this);
        String title;
        String text;
        if (recorder != null && recorder.recording()) {
            title = "Recording a session";
            text = "The " + model + " is heating. Glow records it in the background.";
        } else if (recorder != null && recorder.connected()) {
            title = "Connected to the " + model;
            text = "Glow records sessions in the background.";
        } else {
            title = "Waiting for the " + model;
            text = "Glow records sessions in the background.";
        }
        if (!starting && (title + text).equals(shown)) return;
        shown = title + text;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Background recording", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Shown while Glow records sessions with the app closed.");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_glow)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(tap)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build();
        if (starting) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);
            } else {
                startForeground(NOTIFICATION, n);
            }
        } else {
            nm.notify(NOTIFICATION, n);
        }
    }
}
