import db from './db';

const checkUsers = async () => {
  try {
    // Wait a bit for db connection
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const res = await db.query('SELECT * FROM users ORDER BY created_at DESC LIMIT 5');
    console.log('Users found:', res.rows);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

checkUsers();
