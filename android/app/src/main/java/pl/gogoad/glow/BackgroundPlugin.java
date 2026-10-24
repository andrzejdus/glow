package pl.gogoad.glow;

import android.Manifest;
import android.app.Activity;
import android.companion.AssociationInfo;
import android.companion.AssociationRequest;
import android.companion.BluetoothLeDeviceFilter;
import android.companion.CompanionDeviceManager;
import android.content.Intent;
import android.content.IntentSender;
import android.bluetooth.le.ScanFilter;
import android.net.MacAddress;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.annotation.RequiresApi;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.List;
import java.util.Locale;

/**
 * Settings › App › "Record in the background", and the hand-over between the app's own connection
 * and RecorderService (see Background).
 *
 * Switching it on asks Android to associate Glow with the device (the system's "Allow Glow to
 * manage …?" dialog). The association is what lets Android wake Glow when the device comes into
 * range, and lets Glow start its recorder from the background.
 */
@CapacitorPlugin(
    name = "Background",
    requestCodes = { BackgroundPlugin.REQUEST_ASSOCIATE },
    permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class BackgroundPlugin extends Plugin {

    static final int REQUEST_ASSOCIATE = 7301;
    private static final String TAG = "GlowBackground";

    private PluginCall associating;

    @Override
    protected void handleOnStart() {
        Background.setVisible(getContext(), true);
    }

    @Override
    protected void handleOnStop() {
        Background.setVisible(getContext(), false);
    }

    @Override
    protected void handleOnDestroy() {
        Background.appGone(getContext());
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(state());
    }

    /** Associates the device (system dialog), then starts watching for it. */
    @PluginMethod
    public void enable(PluginCall call) {
        if (!Background.supported()) {
            call.reject("Needs Android 12 or newer");
            return;
        }
        String address = call.getString("id");
        if (address == null || !address.matches("(?i)([0-9a-f]{2}:){5}[0-9a-f]{2}")) {
            call.reject("No device to record");
            return;
        }
        String ours = Background.address(getContext());
        if (ours != null && !ours.equalsIgnoreCase(address)) forget();
        if (associated(address)) {
            finishEnable(call);
            return;
        }
        associate(call, address.toUpperCase(Locale.ROOT));
    }

    @PluginMethod
    public void disable(PluginCall call) {
        forget();
        call.resolve(state());
    }

    /**
     * The app's own connection is up: any recording ends, and the log goes to the app to replay.
     * Calling it again later hands over what was recorded meanwhile, if anything.
     */
    @PluginMethod
    public void hold(PluginCall call) {
        Background.setHeld(getContext(), true, true);
        String log = Background.take(getContext());
        JSObject ret = new JSObject();
        ret.put("log", log);
        call.resolve(ret);
    }

    /** The app has stored what it replayed. */
    @PluginMethod
    public void done(PluginCall call) {
        Background.done(getContext());
        call.resolve();
    }

    /** The app's own connection ended; `present`: the device is still around (the app let it go). */
    @PluginMethod
    public void release(PluginCall call) {
        Background.setHeld(getContext(), false, Boolean.TRUE.equals(call.getBoolean("present", false)));
        call.resolve();
    }

    private JSObject state() {
        JSObject ret = new JSObject();
        ret.put("supported", Background.supported());
        ret.put("enabled", Background.enabled(getContext()));
        String address = Background.address(getContext());
        if (address != null) ret.put("id", address);
        return ret;
    }

    @RequiresApi(api = Build.VERSION_CODES.S)
    @SuppressWarnings("deprecation") // getAssociations(), for Android 12
    private boolean associated(String address) {
        CompanionDeviceManager cdm = getContext().getSystemService(CompanionDeviceManager.class);
        if (cdm == null) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            for (AssociationInfo info : cdm.getMyAssociations()) {
                MacAddress mac = info.getDeviceMacAddress();
                if (mac != null && mac.toString().equalsIgnoreCase(address)) return true;
            }
            return false;
        }
        for (String a : cdm.getAssociations()) if (a.equalsIgnoreCase(address)) return true;
        return false;
    }

    @RequiresApi(api = Build.VERSION_CODES.S)
    @SuppressWarnings("deprecation") // the Android 12 form of associate()
    private void associate(PluginCall call, String address) {
        CompanionDeviceManager cdm = getContext().getSystemService(CompanionDeviceManager.class);
        if (cdm == null) {
            call.reject("This phone cannot watch for devices");
            return;
        }
        // The one device Glow is connected to, by its address: the dialog asks about that one alone.
        BluetoothLeDeviceFilter filter = new BluetoothLeDeviceFilter.Builder()
            .setScanFilter(new ScanFilter.Builder().setDeviceAddress(address).build())
            .build();
        AssociationRequest request = new AssociationRequest.Builder().addDeviceFilter(filter).setSingleDevice(true).build();
        associating = call;
        CompanionDeviceManager.Callback callback = new CompanionDeviceManager.Callback() {
            @Override
            @SuppressWarnings("deprecation") // Android 12 calls this one
            public void onDeviceFound(@NonNull IntentSender sender) {
                launch(sender);
            }

            @Override
            public void onAssociationPending(@NonNull IntentSender sender) {
                launch(sender);
            }

            @Override
            public void onFailure(CharSequence error) {
                PluginCall c = associating;
                associating = null;
                if (c != null) c.reject(error == null ? "The device was not found. Switch it on and try again." : error.toString());
            }
        };
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            cdm.associate(request, getContext().getMainExecutor(), callback);
        } else {
            cdm.associate(request, callback, new Handler(Looper.getMainLooper()));
        }
    }

    private void launch(IntentSender sender) {
        try {
            getActivity().startIntentSenderForResult(sender, REQUEST_ASSOCIATE, null, 0, 0, 0);
        } catch (IntentSender.SendIntentException e) {
            PluginCall c = associating;
            associating = null;
            if (c != null) c.reject("Could not ask Android: " + e.getMessage());
        }
    }

    @Override
    protected void handleOnActivityResult(int requestCode, int resultCode, Intent data) {
        super.handleOnActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_ASSOCIATE) return;
        PluginCall call = associating;
        associating = null;
        if (call == null) return;
        if (resultCode != Activity.RESULT_OK) {
            JSObject ret = state();
            ret.put("cancelled", true);
            call.resolve(ret);
            return;
        }
        finishEnable(call);
    }

    /** Associated: remember the device, watch for it, and ask to show the recording notification. */
    @SuppressWarnings("deprecation") // startObservingDevicePresence(String): the request form needs Android 16
    private void finishEnable(PluginCall call) {
        String address = call.getString("id", "").toUpperCase(Locale.ROOT);
        Background.save(getContext(), true, address, call.getString("name", ""), call.getString("kind", ""), call.getString("model", "device"));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            CompanionDeviceManager cdm = getContext().getSystemService(CompanionDeviceManager.class);
            try {
                cdm.startObservingDevicePresence(address);
            } catch (Exception e) {
                Log.w(TAG, "cannot watch for the device", e);
                call.reject("Android would not watch for the device: " + e.getMessage());
                return;
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "notificationsAnswered");
            return;
        }
        Background.sync(getContext());
        call.resolve(state());
    }

    @PermissionCallback
    private void notificationsAnswered(PluginCall call) {
        // Recording works either way; without the permission Android only hides its notification.
        Background.sync(getContext());
        call.resolve(state());
    }

    /** Stops watching, drops the association and anything not replayed yet. */
    @SuppressWarnings("deprecation") // the String forms, for Android 12
    private void forget() {
        String address = Background.address(getContext());
        Background.save(getContext(), false, address, Background.name(getContext()), Background.kind(getContext()), Background.model(getContext()));
        Background.sync(getContext());
        Background.clear(getContext());
        if (address == null || !Background.supported()) return;
        CompanionDeviceManager cdm = getContext().getSystemService(CompanionDeviceManager.class);
        if (cdm == null) return;
        try {
            cdm.stopObservingDevicePresence(address);
        } catch (Exception e) {
            // Not watched, or no longer associated.
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            List<AssociationInfo> all = cdm.getMyAssociations();
            for (AssociationInfo info : all) {
                MacAddress mac = info.getDeviceMacAddress();
                if (mac != null && mac.toString().equalsIgnoreCase(address)) cdm.disassociate(info.getId());
            }
        } else {
            try {
                cdm.disassociate(address);
            } catch (Exception e) {
                // Already gone.
            }
        }
    }
}
