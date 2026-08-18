import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAmhvwVSXwI3PQ4JhxEikoQpVge0-gIqR0",
  authDomain: "analise-apostas-35550.firebaseapp.com",
  projectId: "analise-apostas-35550",
  storageBucket: "analise-apostas-35550.firebasestorage.app",
  messagingSenderId: "144480988299",
  appId: "1:144480988299:web:cfea56ad961c4bec52f88e",
};

export const firebaseApp = initializeApp(firebaseConfig);
export const db = getFirestore(firebaseApp);
