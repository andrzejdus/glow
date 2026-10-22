// The only way a device driver talks to Bluetooth. The app supplies an
// implementation on top of @capacitor-community/bluetooth-le (native on
// Android, Web Bluetooth in a browser); tests supply a fake.
//
// UUIDs are full 128-bit lower-case strings
// ("10110001-5354-4f52-5a26-4249434b454c").

export interface BleTransport {
  read(service: string, characteristic: string): Promise<DataView>;
  /** Write with response. */
  write(service: string, characteristic: string, value: DataView): Promise<void>;
  writeWithoutResponse(service: string, characteristic: string, value: DataView): Promise<void>;
  startNotifications(
    service: string,
    characteristic: string,
    onValue: (value: DataView) => void,
  ): Promise<void>;
  stopNotifications(service: string, characteristic: string): Promise<void>;
}

/** Builds a DataView from bytes, e.g. bytes(0x01, 0x20). */
export function bytes(...values: number[]): DataView {
  return new DataView(Uint8Array.from(values).buffer);
}
