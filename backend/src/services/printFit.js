// printFit — inline <script> ที่ย่อทั้งเอกสารให้จบ A4 หน้าเดียว ก่อน page.pdf()
// ใช้กับเอกสารแผ่นเดียว (Memo, ใบงานแอร์) ที่เนื้อหายาวแล้วช่องเซ็น/footer ตกหน้า 2.
// หลักการ: วัดความสูง rendered จริงจาก documentElement.scrollHeight แล้วปรับ
// body zoom ลงทีละรอบจนสูงไม่เกินพื้นที่พิมพ์ (iterate เพราะ zoom เปลี่ยน
// การตัดบรรทัด ความสูงจึงไม่สเกลเป็นเส้นตรง) พร้อมขยาย width ชดเชยให้เต็มหน้า.
// ทางออกทุกทางของ loop apply ค่า z ล่าสุดเสมอ (กัน state desync ตอนหมดโควต้ารอบ).
//
// budgetMm/widthMm ต้องสอดคล้องกับ margin ใน pdfRenderer (A4 297x210,
// margin 10/10/12/10mm → พิมพ์ได้ ~275x190mm; เผื่อปัดเศษเหลือ 273).
function fitOnePageScript({ budgetMm = 273, widthMm = 190, minZoom = 0.55 } = {}) {
  return `<script>(function(){
    var PX_PER_MM = 96 / 25.4;
    var budget = ${budgetMm} * PX_PER_MM;
    var body = document.body, root = document.documentElement;
    var z = 1;
    var apply = function (zoom) {
      body.style.zoom = zoom;
      // ล็อกความกว้างเท่าพื้นที่พิมพ์เสมอ (viewport จอ ≠ หน้ากระดาษ:
      // วัดที่ความกว้างจอแล้วข้อความ wrap น้อยกว่าตอนพิมพ์จริง → วัดต่ำไป)
      body.style.width = (${widthMm} / zoom) + 'mm';
    };
    apply(z);
    for (var i = 0; i < 6; i++) {
      var h = root.scrollHeight; // rendered height (หลัง zoom รอบก่อน)
      if (h <= budget || z <= ${minZoom}) break;
      z = Math.max(${minZoom}, z * (budget / h));
      apply(z);
    }
    apply(z);
    window.__printFitDone = 1;
  })();</scr` + `ipt>`;
}

module.exports = { fitOnePageScript };
