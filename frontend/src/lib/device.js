// Per-browser device token. Generated once and persisted in localStorage, so a
// given phone/computer keeps the same id across logins. Used by attendance to
// flag when one device logs time for several technicians (ลงเวลาแทนกัน).
export function getDeviceId() {
  try {
    let id = localStorage.getItem('device-id');
    if (!id) {
      id = (window.crypto?.randomUUID?.() || `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      localStorage.setItem('device-id', id);
    }
    return id;
  } catch {
    return null; // private mode / storage blocked → device tracking simply off
  }
}
