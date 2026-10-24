package pl.gogoad.glow;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.BluetoothStatusCodes;
import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.util.Log;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * Connects to the device by itself and logs what it reports, for the app to replay through its own
 * drivers later (see src/lib/replay.ts). It reads, subscribes and polls the way the drivers in
 * src/lib/devices do on connect, so the replayed drivers find every value they ask for; it never
 * writes anything that changes the device.
 *
 * Only the time around heating is kept: the last PRE_MS while the heater is off, and everything
 * from heater on until COOL_MS after heater off. A device that stays connected for hours (Permanent
 * Bluetooth) costs a few lines per session, not a line a second.
 *
 * Log lines, one per entry, the time in ms since the epoch first:
 *   t B address kind name    a recording starts
 *   t V service char hex     a value as it stood when the recording starts
 *   t S                      the values are complete: the app starts its driver here
 *   t R service char hex     a value read
 *   t N service char hex     a notification
 *   t F                      a round of re-reads is complete (the app calls the driver's refresh())
 *   t E reason               the recording ends: idle (cooled down), lost (link gone), app (the app
 *                            took over), off (switched off)
 */
@SuppressLint("MissingPermission") // The app has BLUETOOTH_CONNECT before recording can be switched on.
final class Recorder {

    interface Events {
        /** Connected, recording or waiting changed. */
        void changed();
        /** The recorder gave up (no device, bootloader, Bluetooth off); it is closed. */
        void ended();
    }

    private static final String TAG = "GlowRecorder";

    /** The app shows 10 s before heater on; a little more covers its rounding. */
    private static final long PRE_MS = 15_000;
    /** The app shows up to 2 minutes of cool-down after heater off. */
    private static final long COOL_MS = 125_000;
    private static final long TICK_MS = 1000;
    private static final long REFRESH_MS = 30_000;
    private static final long IDLE_REFRESH_MS = 300_000;
    /** VENTY/VEAZY answer only when asked: the drivers poll the status every second. */
    private static final long POLL_MS = 1000;
    private static final long IDLE_POLL_MS = 5000;
    private static final long OP_TIMEOUT_MS = 5000;
    private static final long CONNECT_TIMEOUT_MS = 15_000;
    /** Waiting this long for a device that does not answer, the recorder leaves it to the system's next sighting. */
    private static final long WAIT_MS = 120_000;

    private static final UUID CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");

    // CRAFTY / CRAFTY+ (src/lib/devices/crafty.ts)
    private static String crafty(int id) {
        return String.format(Locale.ROOT, "%08x-4c45-4b43-4942-265a524f5453", id);
    }

    private static final String C_CONTROL = crafty(0x01);
    private static final String C_INFO = crafty(0x02);
    private static final String C_SYSTEM = crafty(0x03);
    private static final int CRAFTY_HEATER = 1 << 4;

    // VENTY / VEAZY (src/lib/devices/qvap.ts)
    private static final String Q_SERVICE = "00000000-5354-4f52-5a26-4249434b454c";
    private static final String Q_CONTROL = "00000001-5354-4f52-5a26-4249434b454c";
    private static final String GAP = "00001800-0000-1000-8000-00805f9b34fb";
    private static final String GAP_NAME = "00002a00-0000-1000-8000-00805f9b34fb";
    private static final int Q_STATUS = 0x01;
    private static final int Q_FIRMWARE = 0x02;
    private static final int Q_USAGE = 0x04;
    private static final int Q_IDENTITY = 0x05;
    private static final int Q_UI = 0x06;
    private static final int Q_ADVERTISING = 0x1d;
    private static final int Q_USAGE_EVERY = 31;

    // VOLCANO HYBRID (src/lib/devices/volcano.ts)
    private static String volcano(String prefix) {
        return prefix + "-5354-4f52-5a26-4249434b454c";
    }

    private static final String V_DEVICE = volcano("10100000");
    private static final String V_CONTROL = volcano("10110000");
    private static final int VOLCANO_HEATER = 0x0020;

    private final Context context;
    private final Handler handler;
    private final Events events;
    private final String address;
    private final String kind;
    private final String name;
    private final boolean qvap;

    private BluetoothGatt gatt;
    private volatile boolean connected;
    private boolean stopped;
    /** The values the drivers read on connect are all in: a recording can start. */
    private boolean ready;
    private final ArrayDeque<Op> ops = new ArrayDeque<>();
    private Op op;
    /** VENTY/VEAZY: the firmware answer, which has to say the application runs before anything else goes out. */
    private byte[] firmware;
    private boolean awaitingFirmware;
    private long lastPoll;
    private long lastRefresh;
    private int polls;

    // Guarded by Background.LOCK: the app takes the log over from another thread.
    private boolean handedOver;
    private boolean recording;
    private boolean heater;
    private long offAt;
    private final Map<String, Entry> latest = new LinkedHashMap<>();
    /** Values as they stood PRE_MS ago. */
    private final Map<String, Entry> base = new LinkedHashMap<>();
    /** Everything from the last PRE_MS. */
    private final ArrayDeque<Entry> ring = new ArrayDeque<>();

    Recorder(Context context, Handler handler, Events events) {
        this.context = context.getApplicationContext();
        this.handler = handler;
        this.events = events;
        this.address = Background.address(context);
        this.kind = Background.kind(context);
        this.name = Background.name(context);
        this.qvap = kind.equals("venty") || kind.equals("veazy");
    }

    boolean connected() {
        return connected;
    }

    boolean recording() {
        synchronized (Background.LOCK) {
            return recording;
        }
    }

    void start() {
        handler.post(() -> connect(false));
    }

    /** Closes the connection; a recording in progress ends with `reason` ("app": the app takes over). */
    void stop(String reason) {
        handler.post(() -> close(reason));
    }

    /** The app takes the device over: the recording ends here, and nothing more is logged. */
    void handOver() {
        synchronized (Background.LOCK) {
            if (recording) end(System.currentTimeMillis(), "app");
            handedOver = true;
        }
        handler.post(() -> close("app"));
    }

    // The connection.

    private void connect(boolean auto) {
        if (stopped) return;
        BluetoothManager manager = (BluetoothManager) context.getSystemService(Context.BLUETOOTH_SERVICE);
        BluetoothAdapter adapter = manager == null ? null : manager.getAdapter();
        if (adapter == null || !adapter.isEnabled() || address == null) {
            giveUp("Bluetooth is off");
            return;
        }
        try {
            BluetoothDevice device = adapter.getRemoteDevice(address);
            // A direct connection first; if the device does not answer, wait for it in the background.
            gatt = device.connectGatt(context, auto, callback, BluetoothDevice.TRANSPORT_LE);
        } catch (RuntimeException e) {
            giveUp("cannot connect: " + e);
            return;
        }
        if (!auto) handler.postDelayed(connectTimeout, CONNECT_TIMEOUT_MS);
        else handler.postDelayed(waitTimeout, WAIT_MS);
    }

    private final Runnable waitTimeout = () -> {
        if (!connected && !stopped) giveUp("the device did not come back");
    };

    private final Runnable connectTimeout = () -> {
        if (connected || stopped) return;
        Log.i(TAG, "no answer, waiting for the device");
        if (gatt != null) gatt.close();
        gatt = null;
        connect(true);
    };

    private void giveUp(String why) {
        Log.i(TAG, why);
        close("off");
        events.ended();
    }

    private void close(String reason) {
        if (stopped) return;
        stopped = true;
        handler.removeCallbacksAndMessages(null);
        synchronized (Background.LOCK) {
            if (recording && !handedOver) end(System.currentTimeMillis(), reason);
        }
        if (gatt != null) {
            gatt.disconnect();
            gatt.close();
            gatt = null;
        }
        connected = false;
    }

    private void onConnected() {
        connected = true;
        handler.removeCallbacks(connectTimeout);
        handler.removeCallbacks(waitTimeout);
        events.changed();
        // A moment for the link to settle before discovery, as many stacks need.
        handler.postDelayed(() -> {
            if (gatt != null && !stopped) gatt.discoverServices();
        }, 300);
    }

    private void onDisconnected() {
        boolean was = connected;
        connected = false;
        ready = false;
        ops.clear();
        op = null;
        firmware = null;
        awaitingFirmware = false;
        handler.removeCallbacks(tick);
        handler.removeCallbacks(connectTimeout);
        handler.removeCallbacks(waitTimeout);
        handler.removeCallbacks(firmwareTimeout);
        synchronized (Background.LOCK) {
            if (recording && !handedOver) end(System.currentTimeMillis(), "lost");
            heater = false;
            latest.clear();
            base.clear();
            ring.clear();
        }
        if (gatt != null) gatt.close();
        gatt = null;
        if (stopped) return;
        if (was) events.changed();
        // Still in range (Permanent Bluetooth, or the link just dropped): wait for it. Otherwise the
        // system tells the app when it is back.
        if (Background.present()) connect(true);
        else {
            close("lost");
            events.ended();
        }
    }

    private void discovered() {
        if (qvap) qvapConnect();
        else if (kind.equals("volcano")) volcanoConnect();
        else craftyConnect();
        queue(() -> {
            ready = true;
            long now = System.currentTimeMillis();
            lastRefresh = now;
            lastPoll = now;
            synchronized (Background.LOCK) {
                if (heater && !recording) begin(now);
            }
            events.changed();
            handler.postDelayed(tick, TICK_MS);
            return false;
        });
    }

    // What each family reads on connect: the reads and subscriptions of the driver's start().

    private void craftyConnect() {
        for (String[] c : new String[][] {
            { C_CONTROL, crafty(0x11) }, { C_SYSTEM, crafty(0x1c3) }, { C_CONTROL, crafty(0x71) },
            { C_CONTROL, crafty(0x41) }, { C_SYSTEM, crafty(0x93) }, { C_SYSTEM, crafty(0x63) },
        }) subscribe(c[0], c[1]);
        for (String[] c : new String[][] {
            { C_CONTROL, crafty(0x21) }, { C_INFO, crafty(0x52) }, { C_CONTROL, crafty(0x11) },
            { C_CONTROL, crafty(0x31) }, { C_INFO, crafty(0x32) }, { C_SYSTEM, crafty(0x1c3) },
            { C_SYSTEM, crafty(0x23) }, { C_SYSTEM, crafty(0x1e3) }, { C_INFO, crafty(0x72) },
            { C_CONTROL, crafty(0x51) }, { C_CONTROL, crafty(0x61) }, { C_CONTROL, crafty(0x71) },
            { C_CONTROL, crafty(0x41) }, { C_SYSTEM, crafty(0xb3) }, { C_SYSTEM, crafty(0xe3) },
            { C_SYSTEM, crafty(0x93) }, { C_SYSTEM, crafty(0x63) },
        }) read(c[0], c[1]);
    }

    /** The driver's refresh(), plus the status that legacy firmware does not notify. */
    private void craftyRefresh() {
        for (String[] c : new String[][] {
            { C_CONTROL, crafty(0x21) }, { C_CONTROL, crafty(0x31) }, { C_SYSTEM, crafty(0x23) },
            { C_SYSTEM, crafty(0x1e3) }, { C_CONTROL, crafty(0x51) }, { C_CONTROL, crafty(0x41) },
            { C_SYSTEM, crafty(0xb3) }, { C_SYSTEM, crafty(0xe3) }, { C_SYSTEM, crafty(0x93) },
            { C_SYSTEM, crafty(0x63) },
        }) read(c[0], c[1]);
    }

    private void volcanoConnect() {
        String[][] subs = {
            { V_DEVICE, volcano("1010000d") }, { V_CONTROL, volcano("10110003") }, { V_CONTROL, volcano("10110001") },
            { V_CONTROL, volcano("1011000c") }, { V_CONTROL, volcano("10110015") }, { V_CONTROL, volcano("10110016") },
            { V_DEVICE, volcano("1010000c") },
        };
        for (String[] c : subs) subscribe(c[0], c[1]);
        for (String[] c : new String[][] {
            { V_DEVICE, volcano("1010000d") }, { V_CONTROL, volcano("10110003") }, { V_CONTROL, volcano("10110001") },
            { V_DEVICE, volcano("10100008") }, { V_DEVICE, volcano("10100003") }, { V_DEVICE, volcano("10100004") },
            { V_CONTROL, volcano("1011000c") }, { V_CONTROL, volcano("10110015") }, { V_CONTROL, volcano("10110016") },
            { V_DEVICE, volcano("1010000c") }, { V_DEVICE, volcano("1010000e") }, { V_CONTROL, volcano("1011000d") },
            { V_CONTROL, volcano("10110005") },
        }) read(c[0], c[1]);
    }

    private void volcanoRefresh() {
        for (String[] c : new String[][] {
            { V_DEVICE, volcano("1010000e") }, { V_CONTROL, volcano("1011000d") }, { V_CONTROL, volcano("10110005") },
            { V_CONTROL, volcano("10110015") }, { V_CONTROL, volcano("10110016") },
        }) read(c[0], c[1]);
    }

    /**
     * Like the driver: nothing but the firmware query goes out until the answer says the application
     * runs. In the bootloader, command 0x01 writes a firmware page.
     */
    private void qvapConnect() {
        subscribe(Q_SERVICE, Q_CONTROL);
        read(GAP, GAP_NAME);
        queue(() -> {
            firmware = null;
            return false;
        });
        write(Q_SERVICE, Q_CONTROL, qvapRequest(Q_FIRMWARE));
        // The answer may come before the write is confirmed.
        queue(() -> {
            if (firmware != null) return !checkFirmware();
            awaitingFirmware = true;
            handler.postDelayed(firmwareTimeout, OP_TIMEOUT_MS);
            return true;
        });
        for (int cmd : new int[] { Q_ADVERTISING, Q_STATUS, Q_USAGE, Q_IDENTITY }) write(Q_SERVICE, Q_CONTROL, qvapRequest(cmd));
        write(Q_SERVICE, Q_CONTROL, qvapUi());
    }

    private final Runnable firmwareTimeout = () -> giveUp("no firmware answer");

    private void onQvapFrame(byte[] v) {
        if (ready || v.length == 0 || (v[0] & 0xff) != Q_FIRMWARE) return;
        firmware = v;
        if (!awaitingFirmware) return;
        awaitingFirmware = false;
        handler.removeCallbacks(firmwareTimeout);
        if (checkFirmware()) next();
    }

    /** False (and the recorder closed) when the device is in its bootloader. */
    private boolean checkFirmware() {
        if (firmware.length >= 2 && (firmware[1] & 0x01) != 0) return true;
        giveUp("firmware update mode");
        return false;
    }

    private static byte[] qvapRequest(int cmd) {
        byte[] frame = new byte[20];
        frame[0] = (byte) cmd;
        return frame;
    }

    private static byte[] qvapUi() {
        byte[] frame = new byte[7];
        frame[0] = Q_UI;
        return frame;
    }

    // The heater, from whatever the device reported.

    /** True or false when this entry tells, null when it does not. */
    private Boolean heaterOf(Entry e) {
        byte[] v = e.value;
        if (qvap) {
            if (!e.chr.equals(Q_CONTROL) || v.length < 12 || (v[0] & 0xff) != Q_STATUS) return null;
            return (v[11] & 0xff) != 0;
        }
        if (kind.equals("volcano")) {
            if (!e.chr.equals(volcano("1010000c"))) return null;
            return (uintLE(v) & VOLCANO_HEATER) != 0;
        }
        if (!e.chr.equals(crafty(0x93))) return null;
        return (uintLE(v) & CRAFTY_HEATER) != 0;
    }

    private static long uintLE(byte[] v) {
        long out = 0;
        for (int i = Math.min(v.length, 4) - 1; i >= 0; i--) out = out * 256 + (v[i] & 0xff);
        return out;
    }

    // Polling and re-reads.

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            if (stopped || !connected) return;
            long now = System.currentTimeMillis();
            boolean busy;
            synchronized (Background.LOCK) {
                trim(now);
                if (recording && !heater && now - offAt > COOL_MS) end(now, "idle");
                busy = recording || heater;
            }
            if (op == null && ops.isEmpty()) {
                if (qvap && now - lastPoll >= (busy ? POLL_MS : IDLE_POLL_MS)) {
                    lastPoll = now;
                    polls++;
                    write(Q_SERVICE, Q_CONTROL, qvapRequest(polls % Q_USAGE_EVERY == 0 ? Q_USAGE : Q_STATUS));
                } else if (now - lastRefresh >= (busy ? REFRESH_MS : IDLE_REFRESH_MS)) {
                    lastRefresh = now;
                    if (qvap) {
                        write(Q_SERVICE, Q_CONTROL, qvapRequest(Q_USAGE));
                        write(Q_SERVICE, Q_CONTROL, qvapUi());
                    } else if (kind.equals("volcano")) volcanoRefresh();
                    else craftyRefresh();
                    queue(() -> {
                        record(new Entry(System.currentTimeMillis(), 'F', null, null, null));
                        return false;
                    });
                }
            }
            handler.postDelayed(this, TICK_MS);
        }
    };

    // The log.

    private void record(Entry e) {
        synchronized (Background.LOCK) {
            if (handedOver || stopped) return;
            if (e.key != null) latest.put(e.key, e);
            if (recording) Background.append(context, Collections.singletonList(e.line()));
            else {
                ring.add(e);
                trim(e.t);
            }
            Boolean on = e.value == null ? null : heaterOf(e);
            if (on == null) return;
            if (on && !heater) {
                heater = true;
                if (ready && !recording) begin(e.t);
            } else if (!on && heater) {
                heater = false;
                offAt = e.t;
            }
        }
        events.changed();
    }

    /** Moves what is older than PRE_MS out of the ring into the values as they stood. */
    private void trim(long now) {
        while (!ring.isEmpty() && ring.peekFirst().t < now - PRE_MS) {
            Entry old = ring.pollFirst();
            if (old.key != null) base.put(old.key, old);
        }
    }

    /** Starts a recording with the values from PRE_MS ago and the readings since. Holds LOCK. */
    private void begin(long now) {
        if (Background.logFull(context)) {
            Log.w(TAG, "log full until the app reads it");
            return;
        }
        long t0 = ring.isEmpty() ? now : ring.peekFirst().t;
        // Each value as it stood at t0: the one before the ring if there is one, else its first in it.
        Map<String, Entry> head = new LinkedHashMap<>(base);
        for (Entry e : ring) if (e.key != null && !head.containsKey(e.key)) head.put(e.key, e);
        List<String> lines = new ArrayList<>();
        lines.add(t0 + " B " + address + " " + kind + " " + name);
        for (Entry e : head.values()) lines.add(t0 + " V " + e.service + " " + e.chr + " " + hex(e.value));
        lines.add(t0 + " S");
        for (Entry e : ring) lines.add(e.line());
        ring.clear();
        Background.append(context, lines);
        recording = true;
        Log.i(TAG, "recording");
    }

    /** Holds LOCK. */
    private void end(long now, String reason) {
        Background.append(context, Collections.singletonList(now + " E " + reason));
        recording = false;
        base.clear();
        base.putAll(latest);
        ring.clear();
        Log.i(TAG, "recording ended: " + reason);
    }

    private final class Entry {

        final long t;
        final char type;
        final String service;
        final String chr;
        final byte[] value;
        /** One value per characteristic; VENTY/VEAZY frames share one, so one per command there. */
        final String key;

        Entry(long t, char type, String service, String chr, byte[] value) {
            this.t = t;
            this.type = type;
            this.service = service;
            this.chr = chr;
            this.value = value;
            if (chr == null) key = null;
            else if (qvap && chr.equals(Q_CONTROL) && value.length > 0) key = chr + "/" + (value[0] & 0xff);
            else key = chr;
        }

        String line() {
            return chr == null ? t + " " + type : t + " " + type + " " + service + " " + chr + " " + hex(value);
        }
    }

    private static String hex(byte[] v) {
        if (v == null || v.length == 0) return "-";
        StringBuilder out = new StringBuilder(v.length * 2);
        for (byte b : v) out.append(String.format(Locale.ROOT, "%02x", b));
        return out.toString();
    }

    // GATT operations, one at a time: Android drops overlapping ones.

    private interface Op {
        /** Starts the operation; true when a callback will finish it, false when it is already done. */
        boolean run();
    }

    private void queue(Op o) {
        ops.add(o);
        if (op == null) next();
    }

    private final Runnable opTimeout = this::next;

    private void next() {
        handler.removeCallbacks(opTimeout);
        op = null;
        while (!ops.isEmpty() && !stopped && gatt != null) {
            Op o = ops.poll();
            boolean waits;
            try {
                waits = o.run();
            } catch (RuntimeException e) {
                Log.w(TAG, "GATT operation failed", e);
                waits = false;
            }
            if (waits) {
                op = o;
                if (!awaitingFirmware) handler.postDelayed(opTimeout, OP_TIMEOUT_MS);
                return;
            }
        }
    }

    private BluetoothGattCharacteristic characteristic(String service, String chr) {
        if (gatt == null) return null;
        BluetoothGattService s = gatt.getService(UUID.fromString(service));
        return s == null ? null : s.getCharacteristic(UUID.fromString(chr));
    }

    private void read(String service, String chr) {
        queue(() -> {
            BluetoothGattCharacteristic c = characteristic(service, chr);
            return c != null && gatt.readCharacteristic(c);
        });
    }

    @SuppressWarnings("deprecation") // the pre-Android 13 calls, for Android 12
    private void write(String service, String chr, byte[] value) {
        queue(() -> {
            BluetoothGattCharacteristic c = characteristic(service, chr);
            if (c == null) return false;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                return gatt.writeCharacteristic(c, value, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) == BluetoothStatusCodes.SUCCESS;
            }
            c.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
            c.setValue(value);
            return gatt.writeCharacteristic(c);
        });
    }

    @SuppressWarnings("deprecation")
    private void subscribe(String service, String chr) {
        queue(() -> {
            BluetoothGattCharacteristic c = characteristic(service, chr);
            if (c == null) return false;
            int props = c.getProperties();
            byte[] value = (props & BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0
                ? BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                : (props & BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0
                    ? BluetoothGattDescriptor.ENABLE_INDICATION_VALUE
                    : null;
            BluetoothGattDescriptor d = c.getDescriptor(CCCD);
            if (value == null || d == null || !gatt.setCharacteristicNotification(c, true)) return false;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                return gatt.writeDescriptor(d, value) == BluetoothStatusCodes.SUCCESS;
            }
            d.setValue(value);
            return gatt.writeDescriptor(d);
        });
    }

    private void onRead(BluetoothGattCharacteristic c, byte[] value, int status) {
        if (status == BluetoothGatt.GATT_SUCCESS && value != null) {
            record(new Entry(System.currentTimeMillis(), 'R', c.getService().getUuid().toString(), c.getUuid().toString(), value));
        }
        done();
    }

    /** A read or write answered; one that comes after its timeout must not finish the next one. */
    private void done() {
        if (op != null && !awaitingFirmware) next();
    }

    private void onNotify(BluetoothGattCharacteristic c, byte[] value) {
        if (value == null) return;
        record(new Entry(System.currentTimeMillis(), 'N', c.getService().getUuid().toString(), c.getUuid().toString(), value));
        if (qvap) onQvapFrame(value);
    }

    // Every callback runs on the recorder's own thread.
    private final BluetoothGattCallback callback = new BluetoothGattCallback() {
        @Override
        public void onConnectionStateChange(BluetoothGatt g, int status, int state) {
            handler.post(() -> {
                if (g != gatt) return;
                if (state == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) onConnected();
                else if (state == BluetoothProfile.STATE_DISCONNECTED || status != BluetoothGatt.GATT_SUCCESS) onDisconnected();
            });
        }

        @Override
        public void onServicesDiscovered(BluetoothGatt g, int status) {
            handler.post(() -> {
                if (g != gatt) return;
                if (status == BluetoothGatt.GATT_SUCCESS) discovered();
                else g.disconnect();
            });
        }

        @Override
        public void onCharacteristicRead(BluetoothGatt g, BluetoothGattCharacteristic c, byte[] value, int status) {
            handler.post(() -> onRead(c, value, status));
        }

        @Override
        @SuppressWarnings("deprecation") // Android 12 calls this one
        public void onCharacteristicRead(BluetoothGatt g, BluetoothGattCharacteristic c, int status) {
            byte[] value = c.getValue();
            handler.post(() -> onRead(c, value, status));
        }

        @Override
        public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic c, byte[] value) {
            handler.post(() -> onNotify(c, value));
        }

        @Override
        @SuppressWarnings("deprecation") // Android 12 calls this one
        public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic c) {
            byte[] value = c.getValue();
            handler.post(() -> onNotify(c, value));
        }

        @Override
        public void onCharacteristicWrite(BluetoothGatt g, BluetoothGattCharacteristic c, int status) {
            handler.post(Recorder.this::done);
        }

        @Override
        public void onDescriptorWrite(BluetoothGatt g, BluetoothGattDescriptor d, int status) {
            handler.post(Recorder.this::done);
        }
    };
}
