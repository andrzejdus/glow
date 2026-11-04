package pl.gogoad.glow;

import android.text.format.DateFormat;
import androidx.core.text.util.LocalePreferences;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Arrays;
import java.util.Calendar;
import java.util.List;

/**
 * The phone's own clock, calendar and temperature preferences. The WebView's Intl only knows the
 * language and region, so Android's "Use 24-hour format" switch and the regional preferences
 * (first day of week, temperature unit) never reach the page without this.
 */
@CapacitorPlugin(name = "Locale")
public class LocalePlugin extends Plugin {

    // In the order of JavaScript's Date.getDay(): Sunday is 0.
    private static final List<String> DAYS = Arrays.asList(
        LocalePreferences.FirstDayOfWeek.SUNDAY,
        LocalePreferences.FirstDayOfWeek.MONDAY,
        LocalePreferences.FirstDayOfWeek.TUESDAY,
        LocalePreferences.FirstDayOfWeek.WEDNESDAY,
        LocalePreferences.FirstDayOfWeek.THURSDAY,
        LocalePreferences.FirstDayOfWeek.FRIDAY,
        LocalePreferences.FirstDayOfWeek.SATURDAY
    );

    @PluginMethod
    public void get(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("is24Hour", DateFormat.is24HourFormat(getContext()));
        ret.put("firstDayOfWeek", firstDayOfWeek());
        // The unit chosen in Android's regional preferences (Android 14+), else the one the phone's
        // language and region imply. Settings › App in Glow overrides either.
        // Kelvin is a choice Android offers but Glow does not show; Celsius is its nearest.
        ret.put("temperatureUnit", LocalePreferences.TemperatureUnit.FAHRENHEIT.equals(LocalePreferences.getTemperatureUnit()) ? "F" : "C");
        call.resolve(ret);
    }

    /**
     * 0 for Sunday to 6 for Saturday: the user's regional preference (Android 14+), else what the
     * phone's language and region imply. Settings › App in Glow overrides either.
     */
    private static int firstDayOfWeek() {
        int day = DAYS.indexOf(LocalePreferences.getFirstDayOfWeek());
        return day >= 0 ? day : Calendar.getInstance().getFirstDayOfWeek() - Calendar.SUNDAY;
    }
}
