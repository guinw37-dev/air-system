// Photo point definitions per work order type
// acTypes: AC unit types this point applies to (undefined = all types)
// required: false = optional (e.g., only if damage found)

const PHOTO_POINTS = {
  major: {
    before: [
      { point_no: 1, label: 'รูปพื้นที่หน้างาน (ก่อนล้าง)', required: true },
      { point_no: 2, label: 'อะไหล่เสียหาย #1', required: false },
      { point_no: 3, label: 'อะไหล่เสียหาย #2', required: false },
      { point_no: 4, label: 'Name plate', required: true },
      { point_no: 5, label: 'แรงดันไฟมอเตอร์คอยเย็น', required: true },
      { point_no: 6, label: 'ความเร็วลม/อุณหภูมิ #1', required: true },
      { point_no: 7, label: 'ความเร็วลม/อุณหภูมิ #2', required: true },
      { point_no: 8, label: 'ความเร็วลม/อุณหภูมิ #3', required: true },
      { point_no: 9, label: 'วัด CO2, PM2.5, เสียง', required: true },
      { point_no: 10, label: 'แรงดันไฟมอเตอร์คอยร้อน', required: false, acTypes: ['VRF', 'Split'] },
    ],
    after: [
      { point_no: 1, label: 'รูปพื้นที่หน้างาน (หลังล้าง)', required: true },
      { point_no: 2, label: 'ทีมช่างขณะล้าง #1', required: true },
      { point_no: 3, label: 'ทีมช่างขณะล้าง #2', required: true },
      { point_no: 4, label: 'แรงดันไฟมอเตอร์คอยเย็น', required: true },
      { point_no: 5, label: 'ความเร็วลม/อุณหภูมิ #1', required: true },
      { point_no: 6, label: 'ความเร็วลม/อุณหภูมิ #2', required: true },
      { point_no: 7, label: 'ความเร็วลม/อุณหภูมิ #3', required: true },
      { point_no: 8, label: 'วัด CO2, PM2.5, เสียง', required: true },
      { point_no: 9, label: 'แรงดันไฟมอเตอร์คอยร้อน', required: false, acTypes: ['VRF', 'Split'] },
      { point_no: 10, label: 'แรงดันสารทำความเย็น', required: false, acTypes: ['VRF', 'Split'] },
    ],
  },
  minor: {
    before: [
      { point_no: 1, label: 'ก่อนล้าง', required: true },
    ],
    during: [
      { point_no: 1, label: 'ขณะปฏิบัติงาน', required: true },
    ],
    after: [
      { point_no: 1, label: 'หลังล้าง', required: true },
    ],
  },
  fan: {
    before: [
      { point_no: 1, label: 'ก่อนล้าง', required: true },
    ],
    during: [
      { point_no: 1, label: 'ขณะปฏิบัติงาน', required: true },
    ],
    after: [
      { point_no: 1, label: 'หลังล้าง', required: true },
    ],
  },
};

module.exports = PHOTO_POINTS;
