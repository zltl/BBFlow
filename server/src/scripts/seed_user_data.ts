
import { pool } from '../db';

const TARGET_OPENID = 'oQd5S10uxgeCw2FY_mVDZ6aHZfTM';

const getRandomInt = (min: number, max: number) => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

const getRandomNormal = (mean: number, stdDev: number) => {
  let u = 0, v = 0;
  while(u === 0) u = Math.random(); //Converting [0,1) to (0,1)
  while(v === 0) v = Math.random();
  let num = Math.sqrt( -2.0 * Math.log( u ) ) * Math.cos( 2.0 * Math.PI * v );
  return Math.round(num * stdDev + mean);
};

const run = async () => {
  const client = await pool.connect();
  try {
    // 1. Ensure user exists
    const userCheck = await client.query('SELECT * FROM users WHERE openid = $1', [TARGET_OPENID]);
    if (userCheck.rows.length === 0) {
        console.log('User not found, creating user...');
        await client.query('INSERT INTO users (openid, nickname) VALUES ($1, $2)', [TARGET_OPENID, 'Generated User']);
    } else {
        console.log('User found.');
    }

    // 2. Generate data
    const records = [];
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 1);
    const endDate = new Date();

    let currentDate = new Date(startDate);
    let travelDaysRemaining = 0;

    console.log(`Generating data from ${startDate.toISOString()} to ${endDate.toISOString()}`);

    while (currentDate <= endDate) {
        // Morning measurement (6:00 - 9:59)
        if (Math.random() > 0.1) { // 10% chance to forget
            const morningTime = new Date(currentDate);
            morningTime.setHours(getRandomInt(6, 9), getRandomInt(0, 59));
            
            records.push({
                user_id: TARGET_OPENID,
                systolic: getRandomNormal(135, 10), // Mean 135, SD 10
                diastolic: getRandomNormal(85, 8),  // Mean 85, SD 8
                heart_rate: getRandomNormal(72, 5), // Mean 72, SD 5
                measured_at: morningTime,
                tags: JSON.stringify(['morning'])
            });
        }

        // Evening measurement (18:00 - 21:59)
        if (Math.random() > 0.1) { // 10% chance to forget
            const eveningTime = new Date(currentDate);
            eveningTime.setHours(getRandomInt(18, 21), getRandomInt(0, 59));
            
            records.push({
                user_id: TARGET_OPENID,
                systolic: getRandomNormal(138, 12), // Slightly higher/more variable in evening
                diastolic: getRandomNormal(88, 8),
                heart_rate: getRandomNormal(75, 5),
                measured_at: eveningTime,
                tags: JSON.stringify(['evening'])
            });
        }

        currentDate.setDate(currentDate.getDate() + 1);
    }

    console.log(`Generated ${records.length} records. Inserting...`);

    // Batch insert to be faster
    // Constructing a large INSERT statement or using a loop. Loop is safer for now to avoid query size limits, though slower.
    // For ~700 records it's fine.
    
    let insertedCount = 0;
    for (const record of records) {
        await client.query(
            `INSERT INTO bp_records (user_id, systolic, diastolic, heart_rate, measured_at, tags) 
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [record.user_id, record.systolic, record.diastolic, record.heart_rate, record.measured_at, record.tags]
        );
        insertedCount++;
        if (insertedCount % 100 === 0) process.stdout.write('.');
    }

    console.log('\nDone!');

  } catch (err) {
    console.error('Error seeding data:', err);
  } finally {
    client.release();
    await pool.end();
  }
};

run();
