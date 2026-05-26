require('dotenv').config();
const pool = require('./pool');

async function migrate() {
  try {
    // 1. Add label column to ac_photos
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'ac_photos' AND column_name = 'label'
        ) THEN
          ALTER TABLE ac_photos ADD COLUMN label VARCHAR(150);
        END IF;
      END $$;
    `);

    // 2. Drop old phase check constraint, add new one with 'during'
    await pool.query(`
      DO $$
      DECLARE
        v_con text;
      BEGIN
        SELECT conname INTO v_con
        FROM pg_constraint
        WHERE conrelid = 'ac_photos'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%phase%';

        IF v_con IS NOT NULL THEN
          EXECUTE 'ALTER TABLE ac_photos DROP CONSTRAINT ' || v_con;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'ac_photos_phase_check'
        ) THEN
          ALTER TABLE ac_photos
            ADD CONSTRAINT ac_photos_phase_check
            CHECK (phase IN ('before', 'after', 'during'));
        END IF;
      END $$;
    `);

    console.log('Migration v3 success');
  } catch (err) {
    console.error(err.message);
  } finally {
    await pool.end();
  }
}
migrate();
