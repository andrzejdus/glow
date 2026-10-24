package pl.gogoad.glow;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * Background recording: who owns the device right now, and the log the recorder writes.
 *
 * While Glow is on screen, the app's own connection (the web layer, through the Bluetooth plugin)
 * has the device to itself. Off screen the web layer stops running, so once the device is around
 * (the system's companion-device presence, or the app's own connection still up) RecorderService
 * connects by itself, alongside the app's connection if there is one (Android lets an app have
 * several connections to a device over one link), and logs what the device sends. The app replays
 * that log through its own drivers when it is back, so the protocols stay written once, in
 * TypeScript.
 *
 * Settings live in their own SharedPreferences file; the log lives in files/background/.
 */
final class Background {

    private static final String TAG = "GlowBackground";
    private static final String PREFS = "background";
    /** Above this the recorder starts no new recordings until the app has read the log. */
    private static final long LOG_LIMIT = 16L * 1024 * 1024;

    /** Guards the log files and the hand-over between the recorder and the app. */
    static final Object LOCK = new Object();

    /** What the recorder service should do right now. */
    enum Mode {
        /** Nothing: the service stops. */
        NONE,
        /** Connect and record. */
        RECORD,
    }

    private static boolean visible;
    private static boolean held;
    private static boolean present;
    /** The recorder now running, if any; the app takes the log over from it. */
    static Recorder recorder;

    private Background() {}

    static boolean supported() {
        // Device presence (CompanionDeviceService.onDeviceAppeared) came with Android 12.
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S;
    }

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean enabled(Context c) {
        return supported() && prefs(c).getBoolean("enabled", false) && address(c) != null;
    }

    static String address(Context c) {
        return prefs(c).getString("address", null);
    }

    static String name(Context c) {
        return prefs(c).getString("name", "");
    }

    static String kind(Context c) {
        return prefs(c).getString("kind", "");
    }

    /** The model name for notifications, as the app showed it when recording was switched on. */
    static String model(Context c) {
        return prefs(c).getString("model", "device");
    }

    static void save(Context c, boolean on, String address, String name, String kind, String model) {
        // commit, not apply: the service may read them right after.
        prefs(c).edit()
            .putBoolean("enabled", on)
            .putString("address", address)
            .putString("name", name)
            .putString("kind", kind)
            .putString("model", model)
            .commit();
    }

    static synchronized Mode mode(Context c) {
        if (!enabled(c) || visible) return Mode.NONE;
        // The app's connection in the background says the device is there, but the app no longer
        // hears it: Android stops the web layer of an app that is off screen.
        return present || held || (recorder != null && recorder.connected()) ? Mode.RECORD : Mode.NONE;
    }

    /** The app came on screen or went off it. */
    static void setVisible(Context c, boolean on) {
        synchronized (Background.class) {
            visible = on;
        }
        sync(c);
    }

    /** The app's own connection came up (true) or ended (false). */
    static void setHeld(Context c, boolean on, boolean stillPresent) {
        synchronized (Background.class) {
            held = on;
            if (!on && stillPresent) present = true;
        }
        sync(c);
    }

    /** The app is gone (activity destroyed or task swiped away): its connection went with it. */
    static void appGone(Context c) {
        synchronized (Background.class) {
            if (held) present = true;
            held = false;
            visible = false;
        }
        sync(c);
    }

    /** The system says the device came into range or left it. */
    static void setPresent(Context c, String address, boolean on) {
        String ours = address(c);
        if (ours == null || address == null || !ours.equalsIgnoreCase(address)) return;
        Log.i(TAG, "device " + (on ? "appeared" : "disappeared"));
        synchronized (Background.class) {
            present = on;
        }
        sync(c);
    }

    /** The recorder gave up on the device: gone, with any connection the app still thought it had. */
    static void gone(Context c) {
        synchronized (Background.class) {
            present = false;
            held = false;
        }
        sync(c);
    }

    /** On screen: the app takes over whatever the recorder had. */
    static synchronized boolean appHasIt() {
        return visible;
    }

    static synchronized boolean present() {
        return present;
    }

    /** Starts, changes or stops the service to match mode(). */
    static void sync(Context c) {
        Context app = c.getApplicationContext();
        Mode mode = mode(app);
        RecorderService running = RecorderService.instance;
        if (running != null) {
            running.post(running::sync);
            return;
        }
        if (mode == Mode.NONE) return;
        try {
            Intent intent = new Intent(app, RecorderService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) app.startForegroundService(intent);
            else app.startService(intent);
        } catch (RuntimeException e) {
            // ForegroundServiceStartNotAllowedException and the like: nothing to record with.
            Log.w(TAG, "cannot start the recorder", e);
        }
    }

    // The log. One line per entry: "<ms since epoch> <type> ...", see Recorder.

    private static File dir(Context c) {
        File d = new File(c.getFilesDir(), "background");
        //noinspection ResultOfMethodCallIgnored
        d.mkdirs();
        return d;
    }

    private static File current(Context c) {
        return new File(dir(c), "log.txt");
    }

    private static File taken(Context c) {
        return new File(dir(c), "taken.txt");
    }

    static boolean logFull(Context c) {
        return current(c).length() > LOG_LIMIT;
    }

    /** Appends lines to the log. Callers hold LOCK. */
    static void append(Context c, List<String> lines) {
        if (lines.isEmpty()) return;
        StringBuilder out = new StringBuilder();
        for (String line : lines) out.append(line).append('\n');
        try (OutputStream o = new FileOutputStream(current(c), true)) {
            o.write(out.toString().getBytes(StandardCharsets.UTF_8));
        } catch (IOException e) {
            Log.w(TAG, "cannot write the log", e);
        }
    }

    /**
     * Ends any recording (the app is taking the device over) and hands the log to the app. The log
     * stays on disk until done(), so a replay cut short by a crash is read again next time.
     */
    static String take(Context c) {
        synchronized (LOCK) {
            if (recorder != null) recorder.handOver();
            File now = current(c);
            File old = taken(c);
            if (now.exists()) {
                if (old.exists()) {
                    try (InputStream in = new FileInputStream(now); OutputStream o = new FileOutputStream(old, true)) {
                        copy(in, o);
                    } catch (IOException e) {
                        Log.w(TAG, "cannot move the log", e);
                        return "";
                    }
                    //noinspection ResultOfMethodCallIgnored
                    now.delete();
                } else if (!now.renameTo(old)) {
                    return "";
                }
            }
            if (!old.exists()) return "";
            try (InputStream in = new FileInputStream(old)) {
                ByteArrayOutputStream o = new ByteArrayOutputStream();
                copy(in, o);
                return o.toString(StandardCharsets.UTF_8.name());
            } catch (IOException e) {
                Log.w(TAG, "cannot read the log", e);
                return "";
            }
        }
    }

    /** The app has stored what it replayed. */
    static void done(Context c) {
        synchronized (LOCK) {
            //noinspection ResultOfMethodCallIgnored
            taken(c).delete();
        }
    }

    /** Switching background recording off drops what was not read yet. */
    static void clear(Context c) {
        synchronized (LOCK) {
            //noinspection ResultOfMethodCallIgnored
            current(c).delete();
            //noinspection ResultOfMethodCallIgnored
            taken(c).delete();
        }
    }

    private static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] buf = new byte[65536];
        for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
    }
}
