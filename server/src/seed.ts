import db from './db';

const seed = async () => {
  try {
    // Wait for DB connection
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 1. Get the first user
    const userRes = await db.query('SELECT openid FROM users LIMIT 1');
    if (userRes.rows.length === 0) {
      console.error('No users found. Please login via Mini Program first.');
      process.exit(1);
    }

    const openid = userRes.rows[0].openid;
    console.log(`Seeding data for user: ${openid}`);

    // 2. Generate records
    const records = [];
    const now = new Date();
    
    for (let i = 0; i < 30; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      
      // Morning
      date.setHours(8 + Math.floor(Math.random() * 2), Math.floor(Math.random() * 60));
      records.push(generateRecord(date, ['清晨空腹']));

      // Evening
      const eveningDate = new Date(date);
      eveningDate.setHours(20 + Math.floor(Math.random() * 2), Math.floor(Math.random() * 60));
      records.push(generateRecord(eveningDate, ['睡前']));
    }

    // 3. Insert
    let count = 0;
    for (const record of records) {
      await db.query(`
        INSERT INTO bp_records (user_id, systolic, diastolic, heart_rate, measured_at, tags, note)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        openid,
        record.systolic,
        record.diastolic,
        record.heartRate,
        record.measuredAt,
        JSON.stringify(record.tags),
        record.note
      ]);
      count++;
    }

    console.log(`Successfully inserted ${count} records.`);
    process.exit(0);

  } catch (err) {
    console.error('Seed failed:', err);
    process.exit(1);
  }
};

function generateRecord(date: Date, tags: string[]) {
  const systolic = 110 + Math.floor(Math.random() * 40); // 110-150
  const diastolic = 70 + Math.floor(Math.random() * 25); // 70-95
  const heartRate = 60 + Math.floor(Math.random() * 30); // 60-90

  return {
    systolic,
    diastolic,
    heartRate,
    measuredAt: date.toISOString(),
    tags,
    note: Math.random() > 0.8 ? '感觉还可以' : ''
  };
}

seed();
