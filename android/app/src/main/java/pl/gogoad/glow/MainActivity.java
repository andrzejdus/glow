package pl.gogoad.glow;

import android.graphics.Color;
import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import androidx.activity.SystemBarStyle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Draw behind transparent status and navigation bars on every Android version, with dark
        // icons and no contrast scrim. Without this, Android 12 and older keep a dark status bar
        // above the app while Capacitor still reports its height as a safe-area inset.
        SystemBarStyle bars = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT);
        EdgeToEdge.enable(this, bars, bars);
        super.onCreate(savedInstanceState);
    }
}
