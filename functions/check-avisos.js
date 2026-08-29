const admin = require('firebase-admin');
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
admin.initializeApp({projectId: 'chatbot-de-difusion'});
const db = admin.firestore();

db.collection('avisos')
  .orderBy('createdAt', 'desc')
  .get()
  .then(snap => {
    console.log('Total de avisos:', snap.size);
    snap.docs.forEach((doc, i) => {
      const data = doc.data();
      console.log(`${i+1}. Titulo: ${data.title}`);
    });
    process.exit(0);
  })
  .catch(e => {
    console.error('Error:', e.message);
    process.exit(1);
  });
