package pl.gogoad.glow;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONException;

/**
 * The session log on disk (src/lib/sessionStore.ts): files/sessions/&lt;device&gt;/&lt;name&gt;.json, one
 * file for a device's list of sessions ("index") and one per session with its chart. Capacitor's
 * Preferences keeps everything in one SharedPreferences file and rewrites all of it on every
 * change, which the samples of a running session would do every few seconds.
 *
 * App-private storage only (no permission). A file is written next to its place and renamed over
 * it, so an app killed mid-write leaves the old file or the new one, never half of one.
 * Capacitor runs plugin calls one at a time off the main thread, so file access needs no locks.
 */
@CapacitorPlugin(name = "SessionFiles")
public class SessionFilesPlugin extends Plugin {

    /** Names the app makes: the device's address with anything but letters, digits, - and _ as %XX. */
    private static final Pattern SEGMENT = Pattern.compile("[A-Za-z0-9_%-]{1,200}");
    private static final String EXT = ".json";
    private static final String TMP = ".tmp";

    private File root() {
        return new File(getContext().getFilesDir(), "sessions");
    }

    private File file(PluginCall call, String dev, String name) {
        if (dev == null || name == null || !SEGMENT.matcher(dev).matches() || !SEGMENT.matcher(name).matches()) {
            call.reject("Bad name");
            return null;
        }
        return new File(new File(root(), dev), name + EXT);
    }

    @PluginMethod
    public void read(PluginCall call) {
        File f = file(call, call.getString("dev"), call.getString("name"));
        if (f == null) return;
        JSObject ret = new JSObject();
        // No such file: no "data", which the app reads as nothing stored.
        if (!f.isFile()) {
            call.resolve(ret);
            return;
        }
        try (InputStream in = new FileInputStream(f)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream((int) f.length());
            byte[] buf = new byte[16384];
            for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
            ret.put("data", out.toString(StandardCharsets.UTF_8.name()));
            call.resolve(ret);
        } catch (IOException e) {
            call.reject("Read failed", e);
        }
    }

    @PluginMethod
    public void write(PluginCall call) {
        File f = file(call, call.getString("dev"), call.getString("name"));
        if (f == null) return;
        String data = call.getString("data");
        if (data == null) {
            call.reject("No data");
            return;
        }
        File dir = f.getParentFile();
        if (dir != null && !dir.isDirectory() && !dir.mkdirs()) {
            call.reject("Cannot create " + dir.getName());
            return;
        }
        File tmp = new File(dir, f.getName() + TMP);
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(data.getBytes(StandardCharsets.UTF_8));
            // On disk before the rename, so the rename never points at a file still in the page cache.
            out.getFD().sync();
        } catch (IOException e) {
            tmp.delete();
            call.reject("Write failed", e);
            return;
        }
        if (!tmp.renameTo(f)) {
            tmp.delete();
            call.reject("Rename failed");
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String dev = call.getString("dev");
        JSArray names = call.getArray("names");
        if (dev == null || !SEGMENT.matcher(dev).matches() || names == null) {
            call.reject("Bad names");
            return;
        }
        try {
            for (int i = 0; i < names.length(); i++) {
                File f = file(call, dev, names.getString(i));
                if (f == null) return;
                f.delete();
            }
        } catch (JSONException e) {
            call.reject("Bad names", e);
            return;
        }
        // Gone with its last file, so a device with nothing kept leaves nothing behind.
        File dir = new File(root(), dev);
        String[] left = dir.list();
        if (left != null && left.length == 0) dir.delete();
        call.resolve();
    }

    /** Every file with its size, for Settings › Session history and the clean-up. */
    @PluginMethod
    public void list(PluginCall call) {
        JSONArray files = new JSONArray();
        File[] devs = root().listFiles(File::isDirectory);
        if (devs != null) {
            for (File dir : devs) {
                File[] in = dir.listFiles((d, n) -> n.endsWith(EXT));
                if (in == null) continue;
                for (File f : in) {
                    JSObject o = new JSObject();
                    o.put("dev", dir.getName());
                    o.put("name", f.getName().substring(0, f.getName().length() - EXT.length()));
                    o.put("bytes", f.length());
                    files.put(o);
                }
            }
        }
        JSObject ret = new JSObject();
        ret.put("files", files);
        call.resolve(ret);
    }
}
