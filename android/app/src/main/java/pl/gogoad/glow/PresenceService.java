package pl.gogoad.glow;

import android.companion.AssociationInfo;
import android.companion.CompanionDeviceManager;
import android.companion.CompanionDeviceService;
import android.companion.DevicePresenceEvent;
import android.net.MacAddress;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.annotation.RequiresApi;

/**
 * The system binds this when the associated device comes into Bluetooth range and unbinds it when
 * the device leaves, even while Glow is closed (Android 12+). Android versions call different
 * methods for the same news, so each one reports to Background.setPresent(), which is idempotent.
 */
@RequiresApi(api = Build.VERSION_CODES.S)
public class PresenceService extends CompanionDeviceService {

    @Override
    @SuppressWarnings("deprecation") // Android 12 calls this one
    public void onDeviceAppeared(@NonNull String address) {
        Background.setPresent(this, address, true);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onDeviceDisappeared(@NonNull String address) {
        Background.setPresent(this, address, false);
    }

    @Override
    @RequiresApi(api = Build.VERSION_CODES.TIRAMISU)
    public void onDeviceAppeared(@NonNull AssociationInfo info) {
        Background.setPresent(this, address(info), true);
    }

    @Override
    @RequiresApi(api = Build.VERSION_CODES.TIRAMISU)
    public void onDeviceDisappeared(@NonNull AssociationInfo info) {
        Background.setPresent(this, address(info), false);
    }

    @Override
    @RequiresApi(api = Build.VERSION_CODES.BAKLAVA)
    public void onDevicePresenceEvent(@NonNull DevicePresenceEvent event) {
        boolean on;
        switch (event.getEvent()) {
            case DevicePresenceEvent.EVENT_BLE_APPEARED:
            case DevicePresenceEvent.EVENT_BT_CONNECTED:
                on = true;
                break;
            case DevicePresenceEvent.EVENT_BLE_DISAPPEARED:
            case DevicePresenceEvent.EVENT_BT_DISCONNECTED:
                on = false;
                break;
            default:
                return;
        }
        CompanionDeviceManager cdm = getSystemService(CompanionDeviceManager.class);
        if (cdm == null) return;
        for (AssociationInfo info : cdm.getMyAssociations()) {
            if (info.getId() == event.getAssociationId()) Background.setPresent(this, address(info), on);
        }
    }

    @RequiresApi(api = Build.VERSION_CODES.TIRAMISU)
    private static String address(AssociationInfo info) {
        MacAddress mac = info.getDeviceMacAddress();
        return mac == null ? null : mac.toString();
    }
}
