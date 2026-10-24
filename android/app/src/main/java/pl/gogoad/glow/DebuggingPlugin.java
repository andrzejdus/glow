package pl.gogoad.glow;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.webkit.WebView;
import com.getcapacitor.CapConfig;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The "Debugging from a computer" switch in Settings. When it is on, a computer with adb access to
 * the phone can open DevTools on the WebView and read Capacitor's log, in release builds too, so a
 * problem can be watched in the app that showed it, with its own data.
 *
 * The flag lives in its own SharedPreferences file: app updates keep it, only uninstalling or
 * clearing the app's storage resets it.
 */
@CapacitorPlugin(name = "Debugging")
public class DebuggingPlugin extends Plugin {

    private static final String PREFS = "debugging";
    private static final String KEY = "enabled";

    static boolean isEnabled(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY, false);
    }

    static boolean isDebugBuild(Context context) {
        return (context.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    /**
     * Capacitor's config with WebView debugging and logging forced on. Capacitor reads both only
     * when the bridge starts, so MainActivity hands this over before it does. Null if the bundled
     * config cannot be read, which leaves Capacitor to load it as usual.
     */
    @SuppressWarnings("deprecation") // the only constructor that takes a JSON config with the app's own values
    static CapConfig debuggingConfig(Context context) {
        try (InputStream in = context.getAssets().open("capacitor.config.json")) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
            JSONObject json = new JSONObject(out.toString(StandardCharsets.UTF_8.name()));
            JSONObject android = json.optJSONObject("android");
            if (android == null) json.put("android", android = new JSONObject());
            android.put("webContentsDebuggingEnabled", true);
            android.put("loggingBehavior", "production");
            return new CapConfig(context.getAssets(), json);
        } catch (IOException | JSONException e) {
            return null;
        }
    }

    @PluginMethod
    public void get(PluginCall call) {
        call.resolve(state());
    }

    @PluginMethod
    public void set(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        // commit, not apply: the value has to be on disk even if the app is swiped away right after.
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY, on).commit();
        // DevTools follows at once; Capacitor's log follows the next time the app starts.
        boolean inspectable = on || isDebugBuild(getContext());
        getActivity().runOnUiThread(() -> WebView.setWebContentsDebuggingEnabled(inspectable));
        call.resolve(state());
    }

    private JSObject state() {
        JSObject ret = new JSObject();
        ret.put("enabled", isEnabled(getContext()));
        ret.put("debugBuild", isDebugBuild(getContext()));
        return ret;
    }
}
