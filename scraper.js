const puppeteer = require('puppeteer');
const admin = require('firebase-admin');

// 1. Firebase Initialization
if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: "https://zenmail-1-default-rtdb.firebaseio.com/"
    });
}
const db = admin.database();

async function runScraper() {
    console.log("Browser launch ho raha hai...");
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');

        console.log("Ninja Mail khul rahi hai...");
        await page.goto('https://tempmail.ninja/', { waitUntil: 'networkidle2', timeout: 60000 });

        // 2. Sahi Selector ka intezar (.main-email class jo tumne batayi)
        console.log("Email dhoond raha hoon...");
        await page.waitForSelector('.main-email', { timeout: 60000 });

        // 3. Ulta email uthao
        const reversedEmail = await page.$eval('.main-email', el => el.innerText);
        console.log("Ulta mila:", reversedEmail);

        // 4. Email seedha karo
        const originalEmail = reversedEmail.split("").reverse().join("");
        console.log("Dhamaka! Asli Email:", originalEmail);

        if (originalEmail.includes('@')) {
            // Firebase mein save (Database path check kar lena)
            await db.ref('current_email').set({
                email: originalEmail,
                timestamp: Date.now()
            });
            console.log("Database mein save ho gaya!");
        }

    } catch (err) {
        console.log("Script phatt gayi:", err.message);
    } finally {
        await browser.close();
        console.log("Browser band.");
        process.exit(0);
    }
}

// Function ko call karna zaroori hai
runScraper();
