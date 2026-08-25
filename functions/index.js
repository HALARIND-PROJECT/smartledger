const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

initializeApp();
const db = getFirestore();
const auth = getAuth();

// ==========================================
// 🔐 SIMPLE PIN AUTHENTICATION
// ==========================================
exports.loginWithPin = onCall(async (request) => {
  try {
    const { username, pin } = request.data;
    
    console.log("Login attempt:", username); // Debug log
    
    if (!username || !pin) {
      throw new HttpsError("invalid-argument", "Username and PIN required");
    }
    
    if (!/^\d{4}$/.test(pin)) {
      throw new HttpsError("invalid-argument", "PIN must be exactly 4 digits");
    }

    // Find user by username
    const usersRef = db.collection("users");
    const snapshot = await usersRef.where("username", "==", username).limit(1).get();
    
    if (snapshot.empty) {
      console.log("User not found:", username);
      throw new HttpsError("not-found", "Invalid username or PIN");
    }

    const userDoc = snapshot.docs[0];
    const userData = userDoc.data();

    console.log("User found, checking PIN...");

    // Verify PIN
    if (userData.pin !== pin) {
      console.log("Wrong PIN for:", username);
      throw new HttpsError("unauthenticated", "Invalid username or PIN");
    }

    // Check if locked
    if (userData.locked === true) {
      throw new HttpsError("permission-denied", "Account is locked");
    }

    console.log("Login successful for:", username);

    // Generate Firebase Custom Token
    const customToken = await auth.createCustomToken(userDoc.id);

    return { 
      token: customToken,
      username: userData.username,
      role: userData.role
    };
    
  } catch (error) {
    console.error("Login function error:", error);
    
    if (error instanceof HttpsError) {
      throw error;
    }
    
    throw new HttpsError("internal", "Server error: " + error.message);
  }
});

// ==========================================
// 📊 VAT 3 GENERATOR (Keep your existing code)
// ==========================================
exports.generateVAT3 = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Login required");
  const { year, month } = request.data;

  const q = db.collection("ledger")
    .where("year", "==", year)
    .where("month", "==", month)
    .where("status", "==", "Confirmed");

  const snapshot = await q.get();
  let standardNet = 0, standardVat = 0, zeroRated = 0, cnVat = 0;

  snapshot.forEach(doc => {
    const d = doc.data();
    if (d.type === 'Invoice') {
      standardNet += d.net_amount_kes || 0;
      standardVat += d.vat_amount_kes || 0;
    } else if (d.type === 'Export') {
      zeroRated += d.net_amount_kes || 0;
    } else if (d.type === 'Credit Note') {
      cnVat += d.vat_amount_kes || 0;
    }
  });

  return {
    standardRatedSales: standardNet,
    outputVatStandard: standardVat,
    zeroRatedSales: zeroRated,
    totalOutputVat: standardVat - Math.abs(cnVat)
  };
});

// ==========================================
// 🔍 MISSING INVOICE TRACKER (Keep your existing code)
// ==========================================
exports.getMissingInvoices = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Login required");
  const { year, prefix } = request.data;

  const q = db.collection("ledger")
    .where("year", "==", year)
    .where("inv_prefix", "==", prefix || "INV-")
    .where("type", "in", ["Invoice", "Export"])
    .orderBy("inv_numeric", "asc");

  const snapshot = await q.get();
  const usedNumbers = snapshot.docs.map(doc => doc.data().inv_numeric);
  const missing = [];

  for (let i = 1; i < usedNumbers.length; i++) {
    if (usedNumbers[i] - usedNumbers[i - 1] > 1) {
      for (let j = usedNumbers[i - 1] + 1; j < usedNumbers[i]; j++) {
        missing.push(`${prefix || 'INV-'}${j}`);
      }
    }
  }
  return missing;
});
