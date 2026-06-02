const dayjs = require('dayjs');

// PM scheduling logic.
//
// AC cycle = 6 months: 1 major + 2 minors, one event every 2 months.
//   major (month 0) → minor (+2) → minor (+4) → major (+6) → ...
// The schedule for a unit is derived PER UNIT from its own last_major_clean_date
// so a machine cleaned mid-cycle resets independently of the rest.
//
// Fans are not on the 6-month AC cycle; they get a 'fan' event every 2 months
// from their next_pm_date (or next month if unset).

// Build the list of {scheduled_date, planned_type} due for one unit within `year`.
// `today` is a dayjs (injected so this stays pure/testable).
function buildUnitEvents(unit, year, today) {
  // skip units that are not serviceable (รื้อถอน/งดล้าง → status not active)
  if (unit.status && unit.status !== 'active') return [];

  const Y0 = dayjs(`${year}-01-01`);
  const Y1 = dayjs(`${year}-12-31`);
  const floor = today.subtract(1, 'day'); // don't schedule in the past
  const out = [];
  const push = (d, type) => {
    if (d.isAfter(Y1) || d.isBefore(Y0) || d.isBefore(floor)) return;
    out.push({ scheduled_date: d.format('YYYY-MM-DD'), planned_type: type });
  };

  if (unit.equipment_type === 'fan') {
    let d = unit.next_pm_date ? dayjs(unit.next_pm_date) : today.add(1, 'month').date(1);
    while (d.isBefore(Y0)) d = d.add(2, 'month');
    for (; !d.isAfter(Y1); d = d.add(2, 'month')) push(d, 'fan');
    return out;
  }

  // AC — never cleaned: first event is a major next month, then the cycle
  if (!unit.last_major_clean_date) {
    let d = today.add(1, 'month').date(1);
    for (let k = 0; !d.isAfter(Y1); d = d.add(2, 'month'), k++) {
      push(d, k % 3 === 0 ? 'major' : 'minor');
    }
    return out;
  }

  // AC with a known last major — step every 2 months; every 3rd step is a major
  const LM = dayjs(unit.last_major_clean_date);
  let k = 1;
  let d = LM.add(2, 'month');
  while (d.isBefore(Y0)) { d = d.add(2, 'month'); k++; }
  for (; !d.isAfter(Y1); d = d.add(2, 'month'), k++) {
    push(d, (2 * k) % 6 === 0 ? 'major' : 'minor');
  }
  return out;
}

module.exports = { buildUnitEvents };
