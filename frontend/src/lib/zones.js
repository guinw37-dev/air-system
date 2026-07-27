import { useTenantStore } from '../store/tenant'

// โซน (PTS1/PTS2) เป็น concept ของศรีราชาเท่านั้น — ลูกค้าสั่ง (PDF 08-07 รอบ 2)
// ให้ตัด UI โซนออกจากทุกสาขาอื่น. สาขาที่มีโซนเพิ่มในอนาคต → เติม slug ที่นี่ที่เดียว.
export const ZONE_BRANCH_SLUGS = ['phayathai-sriracha']

export const useHasZones = () =>
  useTenantStore((s) => ZONE_BRANCH_SLUGS.includes(s.slug))

// ล้างย่อย: ช่องวัด ความเร็วลม (ft/m) + อุณหภูมิหลังล้าง (°C) + รูปที่ 4
// (รูปวัดค่า) — ลูกค้าสั่งเฉพาะศรีราชา (Request 22-07-2569 ข้อ 1).
export const MINOR_MEASURE_SLUGS = ['phayathai-sriracha']

export const useHasMinorMeasure = () =>
  useTenantStore((s) => MINOR_MEASURE_SLUGS.includes(s.slug))
