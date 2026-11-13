// role ที่เข้าหน้าได้ (route guard ใน App.jsx) — ต้องตรงกับสิทธิ์ฝั่ง backend ของหน้านั้น
// ไม่งั้นผู้ใช้เปิดหน้าได้แต่กดบันทึกแล้วโดน 403 (test/pageRoles.test.mjs เทียบกับ backend)

// รายการหักค่าบริการรายเดือน — backend/src/routes/deductions.js `canEdit`.
// หัวหน้าช่าง (checker) ไม่เข้า: ป้อมตัดสิน 13 พ.ย. 69 (เดิมหน้าเว็บให้เข้า แต่ backend ไม่ให้บันทึก)
export const DEDUCTIONS_ROLES = ['admin', 'approver', 'approve_building', 'approve_engineer']
