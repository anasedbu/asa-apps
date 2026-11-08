/* ASA cloud settings — shared by every ASA tool.
   Paste the Firebase web config here once (Firebase console → Project settings →
   Your apps → Web app → "firebaseConfig"). These values are not secret: access is
   controlled by the login and the Firestore rules, not by hiding this file.
   Passwords are NEVER written in this file — Firebase checks them. */
window.ASA_CONFIG = {
  firebase: {
    apiKey: "AIzaSyDRIz2JwwC5ocgkcifj4Xq1ta9Hrx3rPAQ",
    authDomain: "asa-apps-40469.firebaseapp.com",
    projectId: "asa-apps-40469",
    storageBucket: "asa-apps-40469.firebasestorage.app",
    messagingSenderId: "718124373393",
    appId: "1:718124373393:web:3b1898edaf10cd60ddf630"
  },

  // The one admin. Typing this username on the login screen signs in as admin.
  adminUser: 'Anas',
  // Login name of that admin account in Firebase → Authentication → Users.
  adminEmail: 'admin@asa-apps.local'
};
