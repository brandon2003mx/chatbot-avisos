const {initializeApp} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");

initializeApp({
  projectId: "chatbot-de-difusion",
});

const db = getFirestore();

module.exports = {
  db,
};
