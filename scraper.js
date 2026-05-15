const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const admin = require('firebase-admin');

// Stealth mode ON
puppeteer.use(StealthPlugin());

// Firebase Service Account from environment variable
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: "https://zenmail-1-default-rtdb.firebaseio.com/"
    });
}

const db = admin.database();

// ============================================
// MAIN SCRAPER FUNCTION - Scrapes tempmail.ninja
// ============================================
async function scrapeEmail() {
    console.log("🚀 Starting Ninja Mail scraper...");

    const browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-size=1920,1080'
        ]
    });

    try {
        const page = await browser.newPage();

        // Set user agent
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        );
        // Set viewport
        await page.setViewport({ width: 1920, height: 1080 });

        console.log("📧 Opening tempmail.ninja...");
        await page.goto('https://tempmail.ninja/', { 
            waitUntil: 'networkidle2', 
            timeout: 60000 
        });

        // Wait for email to appear
        console.log("⏳ Waiting for email...");
        await page.waitForSelector('.main-email', { timeout: 60000 });

        // Get the reversed email
        const reversedEmail = await page.$eval('.main-email', el => el.innerText);
        console.log("📝 Raw email (reversed):", reversedEmail);

        // Reverse it back
        const originalEmail = reversedEmail.split("").reverse().join("");
        console.log("✅ Original email:", originalEmail);

        await browser.close();

        return originalEmail;

    } catch (error) {
        console.error("❌ Scraper Error:", error.message);
        await browser.close();
        throw error;
    }
}

// ============================================
// CHECK OTP FROM INBOX
// ============================================
async function checkOTP(email) {
    console.log("🔍 Checking OTP for:", email);

    const browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
        );

        // Navigate to tempmail.ninja with the specific email
        // Note: We need to set the email first or navigate to it
        await page.goto('https://tempmail.ninja/', { 
            waitUntil: 'networkidle2', 
            timeout: 60000 
        });

        // Wait for messages list
        await page.waitForTimeout(3000);

        // Check for messages
        const messages = await page.evaluate(() => {
            const msgElements = document.querySelectorAll('.messages-list > div');
            const msgs = [];
            msgElements.forEach(el => {
                const from = el.querySelector('.truncate.text-xs');
                const subject = el.querySelector('.truncate');
                const time = el.querySelector('.text-sm.leading-none');
                if (from && subject) {
                    msgs.push({
                        from: from.innerText,
                        subject: subject.innerText,
                        time: time ? time.innerText : ''
                    });
                }
            });
            return msgs;
        });

        console.log("📨 Messages found:", messages.length);

        // Extract OTP from subject or content
        let otp = null;
        let otpFrom = null;
        let otpTime = null;

        for (const msg of messages) {
            // Look for OTP pattern in subject
            const otpMatch = msg.subject.match(/\b\d{4,8}\b/);
            if (otpMatch) {
                otp = otpMatch[0];
                otpFrom = msg.from;
                otpTime = new Date().toISOString();
                break;
            }
        }

        await browser.close();

        return { otp, otpFrom, otpTime, messages };

    } catch (error) {
        console.error("❌ OTP Check Error:", error.message);
        await browser.close();
        throw error;
    }
}

// ============================================
// CLEANUP OLD EMAILS (Auto-delete after 5 hours)
// ============================================
async function cleanupOldEmails() {
    console.log("🧹 Cleaning up old emails...");

    const fiveHoursAgo = Date.now() - (5 * 60 * 60 * 1000);
    const snapshot = await db.ref('current_email').once('value');
    const emails = snapshot.val();

    if (!emails) return;

    let deletedCount = 0;

    for (const [uid, data] of Object.entries(emails)) {
        // Delete if older than 5 hours
        if (data.createdAt && data.createdAt < fiveHoursAgo) {
            // Move to history before deleting
            if (data.email) {
                await db.ref('email_history/' + uid).push({
                    email: data.email,
                    otp: data.otp || null,
                    createdAt: data.createdAt,
                    expiredAt: Date.now()
                });
            }

            await db.ref('current_email/' + uid).remove();
            console.log(`🗑️ Deleted old email for user: ${uid}`);
            deletedCount++;
        }

        // Also delete if expiry time has passed
        if (data.expiry && data.expiry < Date.now()) {
            if (data.email) {
                await db.ref('email_history/' + uid).push({
                    email: data.email,
                    otp: data.otp || null,
                    createdAt: data.createdAt || Date.now(),
                    expiredAt: Date.now()
                });
            }

            await db.ref('current_email/' + uid).remove();
            console.log(`🗑️ Deleted expired email for user: ${uid}`);
            deletedCount++;
        }
    }

    console.log(`✅ Cleanup complete. Deleted ${deletedCount} old emails.`);
}

// ============================================
// PRE-SCRAPE AND STORE EMAILS IN DATABASE
// This runs every 5-8 minutes to pre-populate emails
// ============================================
async function preScrapeEmails() {
    console.log("🔄 Starting pre-scrape cycle...");

    try {
        // Scrape a fresh email
        const email = await scrapeEmail();

        // Store in pre-scraped pool
        const poolRef = db.ref('email_pool').push();
        await poolRef.set({
            email: email,
            createdAt: Date.now(),
            status: 'available',
            source: 'ninja_scraper'
        });

        console.log(`✅ Email stored in pool: ${email}`);

        // Keep only last 50 emails in pool
        const poolSnap = await db.ref('email_pool').orderByChild('createdAt').once('value');
        const pool = poolSnap.val();
        if (pool && Object.keys(pool).length > 50) {
            const keys = Object.keys(pool).sort((a, b) => pool[a].createdAt - pool[b].createdAt);
            const toDelete = keys.slice(0, keys.length - 50);
            for (const key of toDelete) {
                await db.ref('email_pool/' + key).remove();
            }
            console.log(`🧹 Cleaned ${toDelete.length} old pool entries`);
        }

    } catch (error) {
        console.error("❌ Pre-scrape failed:", error.message);
    }
}

// ============================================
// ASSIGN EMAIL FROM POOL TO USER
// ============================================
async function assignEmailToUser(userId) {
    console.log(`📧 Assigning email to user: ${userId}`);

    // Get available email from pool
    const poolSnap = await db.ref('email_pool')
        .orderByChild('status')
        .equalTo('available')
        .limitToFirst(1)
        .once('value');

    const pool = poolSnap.val();

    if (pool) {
        // Use pre-scraped email
        const poolKey = Object.keys(pool)[0];
        const emailData = pool[poolKey];

        // Mark as used
        await db.ref('email_pool/' + poolKey).update({ status: 'assigned', assignedTo: userId });

        // Assign to user
        const expiry = Date.now() + (20 * 60 * 1000); // 20 minutes
        await db.ref('current_email/' + userId).set({
            email: emailData.email,
            expiry: expiry,
            createdAt: Date.now(),
            otp: "Waiting for messages...",
            source: 'pool'
        });

        console.log(`✅ Assigned from pool: ${emailData.email}`);
        return emailData.email;

    } else {
        // Fallback: scrape fresh
        console.log("⚠️ No pool email available, scraping fresh...");
        const email = await scrapeEmail();

        const expiry = Date.now() + (20 * 60 * 1000);
        await db.ref('current_email/' + userId).set({
            email: email,
            expiry: expiry,
            createdAt: Date.now(),
            otp: "Waiting for messages...",
            source: 'fresh'
        });

        console.log(`✅ Assigned fresh: ${email}`);
        return email;
    }
}

// ============================================
// MAIN EXECUTION
// ============================================
async function main() {
    const args = process.argv.slice(2);
    const mode = args[0] || 'pre_scrape';

    console.log(`\n🎯 Mode: ${mode}`);
    console.log(`⏰ Time: ${new Date().toISOString()}\n`);

    try {
        if (mode === 'pre_scrape') {
            // Pre-scrape and store emails
            await preScrapeEmails();

        } else if (mode === 'cleanup') {
            // Clean old emails
            await cleanupOldEmails();

        } else if (mode === 'assign') {
            // Assign email to specific user
            const userId = args[1];
            if (!userId) {
                console.error("❌ User ID required for assign mode");
                process.exit(1);
            }
            await assignEmailToUser(userId);

        } else if (mode === 'check_otp') {
            // Check OTP for a user
            const userId = args[1];
            if (!userId) {
                console.error("❌ User ID required for check_otp mode");
                process.exit(1);
            }

            const emailSnap = await db.ref('current_email/' + userId).once('value');
            const emailData = emailSnap.val();

            if (emailData && emailData.email) {
                const result = await checkOTP(emailData.email);

                if (result.otp) {
                    await db.ref('current_email/' + userId).update({
                        otp: result.otp,
                        otpFrom: result.otpFrom,
                        otpTime: result.otpTime,
                        lastChecked: Date.now()
                    });
                    console.log(`✅ OTP found: ${result.otp}`);
                } else {
                    await db.ref('current_email/' + userId).update({
                        lastChecked: Date.now()
                    });
                    console.log("ℹ️ No OTP found yet");
                }
            }
        }

        console.log("\n✅ Job completed successfully!");
        process.exit(0);

    } catch (error) {
        console.error("\n❌ Job failed:", error);
        process.exit(1);
    }
}

// Run main
main();
