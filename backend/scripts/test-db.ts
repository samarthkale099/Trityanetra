import admin from '../src/db/firebase';

async function testConnection() {
  try {
    console.log('Attempting to read from Firestore...');
    const snapshot = await admin.firestore().collection('colleges').limit(1).get();
    console.log(`Successfully connected! Found ${snapshot.size} colleges.`);
    process.exit(0);
  } catch (error) {
    console.error('Failed to connect to Firestore:', error);
    process.exit(1);
  }
}

testConnection();
