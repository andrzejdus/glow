package pl.gogoad.glow;

import android.graphics.Color;
import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import androidx.activity.SystemBarStyle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // After super: BridgeActivity first swaps the launch (splash) theme for AppTheme.NoActionBar.
        // Enabling edge-to-edge before that builds the window with the splash theme, which adds an
        // action bar with the splash drawable as its background over the top of the page.
        super.onCreate(savedInstanceState);
        // Transparent status and navigation bars with no contrast scrim on every Android version,
        // dark icons in light mode and light icons in dark mode; the page pads itself with the
        // safe-area insets Capacitor injects.
        SystemBarStyle bars = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT);
        EdgeToEdge.enable(this, bars, bars);
    }
}
