import type { DeviceDriver, DeviceKind, DeviceState, DiagnosticValue, HeatMode, SettingDef } from './types';

// A simulated device: lets the app be tried, and checked, without hardware.

const portableSettings: SettingDef[] = [
  { key: 'permanentBluetooth', group: 'connection', label: 'Permanent Bluetooth', type: 'toggle',
    description: 'Keeps your device ready to connect at any time. Uses a small amount of battery, even when powered off.' },
  { key: 'chargeOptimization', group: 'battery', label: 'Charge current optimization', type: 'toggle',
    description: 'Slower charging to reduce battery aging.' },
  { key: 'chargeLimit', group: 'battery', label: 'Charge voltage limit', type: 'toggle',
    description: 'Stops at about 90% to reduce battery aging.' },
  { key: 'permanentBoost', group: 'boost', label: 'Permanent Boost', type: 'toggle',
    description: 'Turns off the 90 s timeout of Boost and Superboost.' },
  { key: 'vibration', group: 'device', label: 'Vibration', type: 'toggle' },
  { key: 'brightness', group: 'device', label: 'LED brightness', type: 'range', min: 10, max: 100, step: 10, unit: '%' },
  { key: 'autoShutoff', group: 'device', label: 'Automatic shutoff', type: 'range', min: 30, max: 300, step: 10, unit: 's', defaultValue: 120 },
];

// The CRAFTY+ list, as its driver shows it.
const craftySettings: SettingDef[] = [
  { key: 'permanentBluetooth', group: 'connection', label: 'Permanent Bluetooth', type: 'toggle',
    description: 'Keeps the device ready to connect at any time. Uses a little battery, even while it is off.' },
  { key: 'chargeIndicator', group: 'battery', label: 'Charge indicator lamp', type: 'toggle' },
  { key: 'vibration', group: 'device', label: 'Vibration', type: 'toggle' },
  { key: 'ledBrightness', group: 'device', label: 'LED brightness', type: 'range', min: 0, max: 100, step: 10, unit: '%' },
  { key: 'autoShutoff', group: 'device', label: 'Automatic shutoff', type: 'range', min: 30, max: 300, step: 30, unit: 's', defaultValue: 120 },
];

const volcanoSettings: SettingDef[] = [
  { key: 'vibration', group: 'device', label: 'Vibration', type: 'toggle' },
  { key: 'displayOnCooling', group: 'device', label: 'Display on cooling', type: 'toggle' },
  { key: 'brightness', group: 'device', label: 'LED brightness', type: 'range', min: 10, max: 100, step: 10, unit: '%' },
  { key: 'autoShutoff', group: 'device', label: 'Automatic shutoff', type: 'range', min: 60, max: 21600, step: 60, unit: 's' },
];

export function createDemoDriver(kind: DeviceKind): DeviceDriver {
  const isVolcano = kind === 'volcano';
  let emit: (patch: Partial<DeviceState>) => void = () => {};
  let timer: ReturnType<typeof setInterval> | undefined;
  const s = {
    current: isVolcano ? 168 : 142,
    target: isVolcano ? 185 : 180,
    mode: 'normal' as HeatMode,
    heater: true,
    pump: false,
    minutes: isVolcano ? 811 * 60 + 42 : 142 * 60 + 18,
    battery: 78,
  };
  const offsets = { boost: 10, superboost: kind === 'crafty' ? 25 : 15 };
  // Like the real ones, a demo VENTY/VEAZY reports no live temperature, only "ready".
  const live = kind !== 'venty' && kind !== 'veazy';
  const goal = () => Math.min(isVolcano ? 230 : 210, s.target + (s.mode === 'boost' ? offsets.boost : s.mode === 'superboost' ? offsets.superboost : 0));

  const tick = () => {
    const g = s.heater ? goal() : 24;
    const k = s.heater ? (s.current < g ? 0.06 : 0.2) : 0.01;
    s.current += (g - s.current) * k + (s.heater && s.current < g ? 0.08 : 0);
    if (s.heater) s.minutes += 0.5 / 60;
    emit({
      ...(live ? { currentTemp: Math.round(s.current * 10) / 10 } : {}),
      operatingMinutes: s.minutes,
      tempReached: s.heater && Math.abs(goal() - s.current) < 1,
    });
  };

  const driver: DeviceDriver = {
    kind,
    capabilities: {
      pump: isVolcano,
      battery: !isVolcano,
      boost: !isVolcano,
      superBoost: !isVolcano,
      findMy: !isVolcano,
      heaterToggle: true,
    },
    settingDefs: isVolcano ? volcanoSettings : kind === 'crafty' ? craftySettings : portableSettings,

    async start(onChange) {
      emit = onChange;
      onChange({
        model: isVolcano ? 'VOLCANO HYBRID' : kind === 'crafty' ? 'CRAFTY+' : 'VENTY',
        serial: isVolcano ? 'VH 4C19E0' : kind === 'crafty' ? 'CP1A7E52' : 'VY 08A3F2',
        firmware: isVolcano ? '2.2.7' : kind === 'crafty' ? 'V03.24' : '2.4.1',
        firmwareBle: isVolcano ? '1.4.0' : kind === 'crafty' ? 'V2.0.3' : '1.9.0',
        currentTemp: live ? s.current : undefined,
        targetTemp: s.target,
        minTemp: 40,
        maxTemp: isVolcano ? 230 : 210,
        boostOffset: isVolcano ? undefined : offsets.boost,
        superBoostOffset: isVolcano ? undefined : offsets.superboost,
        mode: s.mode,
        heaterOn: s.heater,
        pumpOn: isVolcano ? false : undefined,
        battery: isVolcano ? undefined : s.battery,
        charging: false,
        operatingMinutes: s.minutes,
        autoShutoffSec: isVolcano ? 1800 : 120,
        unit: 'C',
        settings: isVolcano
          ? { vibration: true, displayOnCooling: false, brightness: 70, autoShutoff: 1800 }
          : kind === 'crafty'
            ? { permanentBluetooth: true, chargeIndicator: true, vibration: true, ledBrightness: 70, autoShutoff: 120 }
            : { permanentBluetooth: true, chargeOptimization: false, chargeLimit: true, permanentBoost: false,
                vibration: true, brightness: 70, autoShutoff: 120 },
      });
      timer = setInterval(tick, 500);
    },
    async stop() {
      clearInterval(timer);
    },
    async setTargetTemp(c) {
      s.target = c;
      emit({ targetTemp: c });
    },
    async setHeater(on) {
      s.heater = on;
      emit({ heaterOn: on });
    },
    async setMode(mode) {
      s.mode = mode;
      emit({ mode });
    },
    async setBoostOffsets(boost, superBoost) {
      offsets.boost = boost;
      if (kind === 'crafty') offsets.superboost = boost + 15;
      else if (superBoost !== undefined) offsets.superboost = superBoost;
      emit({ boostOffset: offsets.boost, superBoostOffset: offsets.superboost });
    },
    async setPump(on) {
      s.pump = on;
      emit({ pumpOn: on });
    },
    async setSetting(key, value) {
      emit({ settings: { [key]: value }, ...(key === 'autoShutoff' ? { autoShutoffSec: Number(value) } : {}) });
    },
    async findMyDevice() {},
  };
  // Plausible CRAFTY registers; an imaginary charger flips bit 6 of the battery status every 10 s.
  const diagnostics = async (): Promise<DiagnosticValue[]> => [
    { label: 'Project status', source: '0x0093', value: (s.heater ? 0x10 : 0) | (s.mode === 'boost' ? 0x20 : s.mode === 'superboost' ? 0x40 : 0) },
    { label: 'Project status 2', source: '0x01c3', value: 0x1000 | (s.heater && Math.abs(goal() - s.current) < 1 ? 0x04 : 0) },
    { label: 'System status', source: '0x0083', value: 0x0001 },
    { label: 'Battery status', source: '0x0063', value: 0x0010 | (Math.floor(Date.now() / 10000) % 2 ? 0x40 : 0) },
    { label: 'Battery status 2', source: '0x0073', value: 0x0200 },
    { label: 'Battery', source: '0x0041', value: s.battery, unit: '%' },
    { label: 'Auto-off setting', source: '0x0061', value: 120, unit: 's' },
    { label: 'Auto-off left', source: '0x0071', value: 120, unit: 's', quiet: true },
  ];
  // Like the real CRAFTY+, the demo switches levels only with the (imaginary) device button.
  return kind === 'crafty' ? Object.assign(driver, { modeSwitchable: false as const, diagnostics }) : driver;
}
