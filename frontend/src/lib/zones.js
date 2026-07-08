import { useTenantStore } from '../store/tenant'

// โซน (PTS1/PTS2) เป็น concept ของศรีราชาเท่านั้น — ลูกค้าสั่ง (PDF 08-07 รอบ 2)
// ให้ตัด UI โซนออกจากทุกสาขาอื่น. สาขาที่มีโซนเพิ่มในอนาคต → เติม slug ที่นี่ที่เดียว.
export const ZONE_BRANCH_SLUGS = ['phayathai-sriracha']

export const useHasZones = () =>
  useTenantStore((s) => ZONE_BRANCH_SLUGS.includes(s.slug))
