/* ASA cloud settings — shared by every ASA tool.
   Paste the Firebase web config here once (Firebase console → Project settings →
   Your apps → Web app → "firebaseConfig"). These values are not secret: access is
   controlled by the login and the Firestore rules, not by hiding this file.
   Passwords are NEVER written in this file — Firebase checks them. */
window.ASA_CONFIG = {
  firebase: null,
  // e.g. firebase: { apiKey:"...", authDomain:"...", projectId:"...", appId:"..." },

  // The one admin. Typing this username on the login screen signs in as admin.
  adminUser: 'Anas',
  // Login name of that admin account in Firebase → Authentication → Users.
  adminEmail: 'admin@asa-apps.local'
};
