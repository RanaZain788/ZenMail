const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const admin = require('firebase-admin');

puppeteer.use(StealthPlugin());

// Firebase Service Account Secret (GitHub Environment Se Ayega)
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: "https://zenmail-1.firebaseio.com" // APNA URL DALEIN
    });
}

const db = admin.database();

async function runZenmailBot() {
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    try {
        // 1. Check for Pending Orders
        const ordersSnap = await db.ref('orders').limitToFirst(1).once('value');
        const orders = ordersSnap.val();

        if (orders) {
            const uid = Object.keys(orders)[0];
            console.log(`Processing order for user: ${uid}`);

            // Go to Ninja
            await page.goto('https://tempmail.ninja/', { waitUntil: 'networkidle2' });
            await page.waitForSelector('#email_id');

            const email = await page.$eval('#email_id', el => el.value);
            
            // Extract Cookies (Bohat Zaroori!)
            const cookies = await page.cookies();
            
            // Save to Firebase
            const expiry = Date.now() + (20 * 60 * 1000); // 20 mins
            await db.ref(`active_mails/${uid}`).set({
                email: email,
                cookies: JSON.stringify(cookies),
                expiry: expiry,
                otp: "Waiting for messages..."
            });

            // Remove Order
            await db.ref('orders/' + uid).remove();
            console.log("Email Generated and Order Cleared.");
        }

        // 2. Check Active Mails for OTP (Update loop)
        const activeSnap = await db.ref('active_mails').once('value');
        const activeMails = activeSnap.val();

        if (activeMails) {
            for (const uid in activeMails) {
                const data = activeMails[uid];
                
                // Expiry Check
                if (Date.now() > data.expiry) {
                    await db.ref('active_mails/' + uid).remove();
                    continue;
                }

                // Restore Cookies to check Inbox
                const savedCookies = JSON.parse(data.cookies);
                await page.setCookie(...savedCookies);
                await page.goto('https://tempmail.ninja/', { waitUntil: 'networkidle2' });

                // Check Inbox Logic (Ninja specific)
                const messages = await page.evaluate(() => {
                    const rows = document.querySelectorAll('#messages_list tr');
                    return rows.length > 0 ? rows[0].innerText : null;
                });

                if (messages) {
                    await db.ref(`active_mails/${uid}/otp`).set(messages);
                }
            }
        }

    } catch (error) {
        console.error("Error:", error);
    } finally {
        await browser.close();
    }
}

runZenmailBot();